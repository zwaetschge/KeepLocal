package com.keeplocal.android.data.repository

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.provider.OpenableColumns
import androidx.exifinterface.media.ExifInterface
import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.dto.toDomain
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.entity.toEntity
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.TranscriptionException
import com.keeplocal.android.domain.repository.MediaLimits
import com.keeplocal.android.domain.repository.MediaRepository
import com.keeplocal.android.domain.repository.TranscriptionResult
import com.keeplocal.android.util.FileLogger
import com.keeplocal.android.util.ImageCompression
import com.keeplocal.android.util.Result
import com.squareup.moshi.Moshi
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Maps a content MIME type to the file extension the server expects.
 * Mirrors middleware/upload.js (used for temp file names); the server
 * ultimately renames uploads itself, so this is cosmetic.
 */
internal fun mimeToImageExtension(mime: String?): String = when (mime?.lowercase()) {
    "image/png" -> "png"
    "image/gif" -> "gif"
    "image/webp" -> "webp"
    else -> "jpg" // covers image/jpeg, unknown and missing types
}

/**
 * Validates the app language setting against the ISO code the transcription
 * endpoint accepts (`^[a-z]{2,3}(-[A-Z]{2})?$` — lowercase language, optional
 * uppercase region); anything else means "let the AI auto-detect".
 */
internal fun transcriptionLanguageFor(languageSetting: String?): String? {
    val setting = languageSetting?.trim()
    if (setting.isNullOrBlank()) return null
    // Normalize casing: "EN" -> "en", "pt-br" -> "pt-BR".
    val parts = setting.split("-")
    val normalized = when (parts.size) {
        2 -> "${parts[0].lowercase()}-${parts[1].uppercase()}"
        else -> setting.lowercase()
    }
    return if (Regex("^[a-z]{2,3}(?:-[A-Z]{2})?$").matches(normalized)) normalized else null
}

/**
 * Media features straight against the API. Uses its own Retrofit instance
 * built on a derived OkHttpClient (same auth interceptors and cookie jar as
 * the app client) with a raised read timeout: transcription jobs run 30-60s
 * server-side and would trip the default 30s read timeout.
 */
@Singleton
class MediaRepositoryImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val settingsDataStore: SettingsDataStore,
    okHttpClient: OkHttpClient,
    moshi: Moshi,
    private val noteDao: NoteDao,
    private val fileLogger: FileLogger
) : MediaRepository {

    /** Coil loads /uploads files through this so session cookies are sent. */
    val mediaCallFactory: OkHttpClient = okHttpClient.newBuilder()
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .build()

    private val api: KeepLocalApi = Retrofit.Builder()
        // Placeholder base URL — DynamicBaseUrlInterceptor rewrites host per request.
        .baseUrl("http://localhost/")
        .client(mediaCallFactory)
        .addConverterFactory(MoshiConverterFactory.create(moshi))
        .build()
        .create(KeepLocalApi::class.java)

    // Same pattern as DynamicBaseUrlInterceptor: keep the last emitted server
    // URL around for synchronous media URL resolution.
    @Volatile
    private var serverBaseUrl: String = ""

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        settingsDataStore.serverUrl
            .onEach { serverBaseUrl = it }
            .catch { /* DataStore read failure - keep empty URL */ }
            .launchIn(scope)
    }

    override suspend fun uploadImages(noteId: String, uris: List<Uri>): Result<Note> =
        withContext(Dispatchers.IO) {
            Result.catching {
                if (uris.isEmpty()) throw IllegalArgumentException("Keine Bilder ausgewählt")

                val note = try {
                    var latest: Note? = null
                    // Server accepts at most 5 images per request; send the rest
                    // as follow-up requests against the same note.
                    uris.chunked(MediaLimits.MAX_IMAGES_PER_REQUEST).forEach { chunk ->
                        val parts = chunk.mapIndexedNotNull { index, uri -> buildImagePart(uri, index) }
                        if (parts.isEmpty()) throw IOException("Bilder konnten nicht gelesen werden")

                        fileLogger.log("MediaRepo", "uploadImages: note=$noteId parts=${parts.size}")
                        val response = api.uploadImages(noteId, parts)
                        if (!response.isSuccessful) {
                            throw failure(response)
                        }
                        latest = response.body()?.toDomain() ?: throw Exception("Upload ohne Antwort")
                    }
                    latest!!
                } finally {
                    cleanupUploadTempFiles()
                }

                cacheNote(note)
                note
            }
        }

    override suspend fun deleteImage(noteId: String, filename: String): Result<Note> =
        withContext(Dispatchers.IO) {
            Result.catching {
                fileLogger.log("MediaRepo", "deleteImage: note=$noteId file=$filename")
                val response = api.deleteImage(noteId, filename)
                if (!response.isSuccessful) throw failure(response)
                val note = response.body()?.toDomain() ?: throw Exception("Löschen ohne Antwort")
                cacheNote(note)
                note
            }
        }

    override suspend fun transcribeAudio(noteId: String, audioFile: File): Result<TranscriptionResult> =
        withContext(Dispatchers.IO) {
            Result.catching {
                val audioPart = MultipartBody.Part.createFormData(
                    "audio",
                    audioFile.name,
                    audioFile.asRequestBody("audio/mp4".toMediaTypeOrNull())
                )
                val language = transcriptionLanguageFor(currentLanguageSetting())
                // The API signature declares the form field non-null, but the
                // server treats an empty value as absent ("req.body.language
                // || null") — so "" means "let the AI auto-detect".
                val languagePart = (language ?: "").toRequestBody("text/plain".toMediaTypeOrNull())

                fileLogger.log(
                    "MediaRepo",
                    "transcribeAudio: note=$noteId file=${audioFile.name} size=${audioFile.length()} language=${language ?: "auto"}"
                )
                val response = api.transcribeAudio(noteId, audioPart, languagePart)
                if (!response.isSuccessful) {
                    if (response.code() == 503) {
                        // TODO-STR: string resource (transcribe_service_unavailable)
                        throw Exception("Transkriptionsdienst nicht erreichbar. Bitte später erneut versuchen.")
                    }
                    throw transcriptionFailure(response)
                }
                val result = response.body() ?: throw Exception("Transkription ohne Antwort")
                TranscriptionResult(text = result.text, language = result.language)
            }
        }

    override fun resolveImageUrl(path: String?): String? {
        if (path.isNullOrBlank()) return null
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        if (serverBaseUrl.isBlank()) return null
        return serverBaseUrl.trimEnd('/') + path
    }

    override suspend fun awaitImageUrl(path: String?): String? {
        resolveImageUrl(path)?.let { return it }
        if (path.isNullOrBlank()) return null
        // Cold-start window: base URL not emitted yet — wait briefly for it.
        val url = withTimeoutOrNull(2_000) {
            runCatching { settingsDataStore.serverUrl.first { it.isNotBlank() } }.getOrNull()
        }
        if (!url.isNullOrBlank()) serverBaseUrl = url
        return resolveImageUrl(path)
    }

    // --- helpers ---

    /** Best-effort: keep the Room cache in sync so list previews show new
     *  images without waiting for the next full getNotes(). */
    private suspend fun cacheNote(note: Note) {
        runCatching { noteDao.insertNote(note.toEntity()) }
            .onFailure { fileLogger.error("MediaRepo", "Failed to cache note after media change", it) }
    }

    /** Builds a readable exception from an error response. */
    private fun failure(response: Response<*>): Exception {
        val body = try { response.errorBody()?.string()?.take(300) } catch (_: Exception) { null }
        fileLogger.error("MediaRepo", "request failed: code=${response.code()} body=$body")
        val detail = body?.let {
            Regex("\"error\"\\s*:\\s*\"([^\"]+)\"").find(it)?.groupValues?.getOrNull(1)
                ?: Regex("\"msg\"\\s*:\\s*\"([^\"]+)\"").find(it)?.groupValues?.getOrNull(1)
        }
        return Exception(detail ?: "Serverfehler (HTTP ${response.code()})")
    }

    /**
     * Transcription budget refusals carry a stable `code` (Top-30 Nr. 18):
     * 429 TRANSCRIPTION_RATE_LIMITED / _DAILY_LIMIT / _MINUTE_LIMIT / _BUSY
     * keep the recording worth retrying, 413 AUDIO_TOO_LONG (and everything
     * else) does not. The server messages are already user-facing German.
     */
    private fun transcriptionFailure(response: Response<*>): Exception {
        val body = try { response.errorBody()?.string()?.take(300) } catch (_: Exception) { null }
        fileLogger.error("MediaRepo", "transcribe failed: code=${response.code()} body=$body")
        fun field(name: String): String? = body?.let {
            Regex("\"$name\"\\s*:\\s*\"([^\"]+)\"").find(it)?.groupValues?.getOrNull(1)
        }
        val code = field("code")
        val retryable = response.code() == 429 || code in TranscriptionException.RETRYABLE_CODES
        return TranscriptionException(
            code = code,
            message = field("error") ?: field("msg") ?: "Serverfehler (HTTP ${response.code()})",
            retryable = retryable
        )
    }

    /** File + MIME that uploadImages should send — either the compressed
     *  rewrite or the untouched original. */
    private data class PreparedUpload(val file: File, val mime: String)

    private fun buildImagePart(uri: Uri, index: Int): MultipartBody.Part? {
        return try {
            val resolver = context.contentResolver
            val mime = resolver.getType(uri) ?: "image/jpeg"
            val extension = mimeToImageExtension(mime)
            val displayName = queryDisplayName(uri) ?: "image_${System.currentTimeMillis()}_$index.$extension"
            val temp = File(context.cacheDir, "upload_${UUID.randomUUID()}.$extension")
            resolver.openInputStream(uri)?.use { input ->
                temp.outputStream().use { output -> input.copyTo(output) }
            } ?: run {
                temp.delete()
                return null
            }
            if (temp.length() == 0L) {
                temp.delete()
                return null
            }
            val prepared = prepareForUpload(temp, mime)
            MultipartBody.Part.createFormData(
                "images",
                alignExtension(displayName, prepared.mime),
                prepared.file.asRequestBody(prepared.mime.toMediaTypeOrNull() ?: "image/jpeg".toMediaTypeOrNull())
            )
        } catch (e: Exception) {
            fileLogger.error("MediaRepo", "Failed to read picked image", e)
            null
        }
    }

    /**
     * Upload-side compression (v1.6.0 Nr. 2): camera photos from a tablet are
     * routinely 3–8 MB while the app never renders more than a thumbnail plus
     * a detail view. Two-pass decode to at most [ImageCompression.MAX_DIMENSION]
     * on the long edge, EXIF rotation baked in, JPEG q85 — falling back to the
     * original whenever the rewrite comes out empty or bigger.
     */
    private fun prepareForUpload(original: File, mime: String): PreparedUpload {
        val originalBytes = original.length()
        if (!ImageCompression.shouldCompress(mime, originalBytes)) return PreparedUpload(original, mime)

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(original.absolutePath, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
            fileLogger.log("MediaRepo", "compress: undecodable image, uploading original")
            return PreparedUpload(original, mime)
        }

        val sample = ImageCompression.computeSampleSize(bounds.outWidth, bounds.outHeight)
        val decoded = BitmapFactory.decodeFile(
            original.absolutePath,
            BitmapFactory.Options().apply { inSampleSize = sample }
        ) ?: return PreparedUpload(original, mime)

        val rotation = exifRotationDegrees(original.absolutePath)
        // Rotation by 90/270 swaps the axes the target size is computed against.
        val rotatedWidth = if (rotation == 90 || rotation == 270) decoded.height else decoded.width
        val rotatedHeight = if (rotation == 90 || rotation == 270) decoded.width else decoded.height
        val (targetWidth, targetHeight) = ImageCompression.targetSize(rotatedWidth, rotatedHeight)
        val matrix = Matrix().apply {
            if (rotation != 0) postRotate(rotation.toFloat())
            if (targetWidth != rotatedWidth || targetHeight != rotatedHeight) {
                postScale(targetWidth.toFloat() / rotatedWidth, targetHeight.toFloat() / rotatedHeight)
            }
        }
        // Transparent PNGs keep their alpha by staying PNG (downscale savings
        // only); everything else re-encodes as JPEG q85.
        val format = if (decoded.hasAlpha()) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
        val outputExtension = if (format == Bitmap.CompressFormat.JPEG) "jpg" else "png"

        return try {
            val transformed = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
            val compressed = File(context.cacheDir, "upload_${UUID.randomUUID()}.$outputExtension")
            compressed.outputStream().use { transformed.compress(format, ImageCompression.JPEG_QUALITY, it) }
            if (compressed.length() in 1 until originalBytes) {
                original.delete()
                fileLogger.log(
                    "MediaRepo",
                    "compress: ${originalBytes / 1024}KB ${bounds.outWidth}x${bounds.outHeight}" +
                        " -> ${compressed.length() / 1024}KB ${transformed.width}x${transformed.height} rot=$rotation"
                )
                PreparedUpload(compressed, "image/" + outputExtension)
            } else {
                compressed.delete()
                PreparedUpload(original, mime)
            }
        } catch (e: Exception) {
            fileLogger.error("MediaRepo", "compress failed, uploading original", e)
            PreparedUpload(original, mime)
        }
    }

    /** Portrait photos store their orientation here, not in the pixels. */
    private fun exifRotationDegrees(path: String): Int = runCatching {
        when (ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90
            ExifInterface.ORIENTATION_ROTATE_180 -> 180
            ExifInterface.ORIENTATION_ROTATE_270 -> 270
            else -> 0
        }
    }.getOrDefault(0)

    /** Keeps the form-field filename honest after a JPEG/PNG re-encode. */
    private fun alignExtension(displayName: String, mime: String): String {
        val expected = mimeToImageExtension(mime)
        val current = displayName.substringAfterLast('.', "")
        return if (current.equals(expected, ignoreCase = true)) displayName
        else displayName.substringBeforeLast('.') + "." + expected
    }

    private fun queryDisplayName(uri: Uri): String? = runCatching {
        context.contentResolver.query(
            uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null
        )?.use { cursor ->
            val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (nameIndex >= 0 && cursor.moveToFirst()) cursor.getString(nameIndex) else null
        }
    }.getOrNull()

    private fun cleanupUploadTempFiles() {
        context.cacheDir.listFiles { file -> file.name.startsWith("upload_") }
            ?.forEach { runCatching { it.delete() } }
    }

    private suspend fun currentLanguageSetting(): String? {
        // Account-synced Whisper hint first ("auto" = detect), UI language as
        // the pre-login fallback.
        val synced = runCatching { settingsDataStore.transcriptionLanguage.first() }.getOrNull()
        if (!synced.isNullOrBlank()) return synced.takeIf { it != "auto" }
        return runCatching { settingsDataStore.language.first() }.getOrNull()
    }
}
