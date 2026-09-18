package com.keeplocal.android.ui.components

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.keeplocal.android.domain.model.NoteImage
import com.keeplocal.android.domain.repository.MediaRepository
import com.keeplocal.android.util.FileLogger
import com.keeplocal.android.util.Result
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Gallery-save and share for viewed note images (v1.9.0 Nr. 4). Both actions
 * share one flow: download the full-size original into the cache dir via
 * [MediaRepository], then hand it to the system — MediaStore for saving
 * (minSdk 33, so the scoped-storage insert API is always available) and a
 * FileProvider URI for sharing.
 */
object ImageActions {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface ImageActionsEntryPoint {
        fun mediaRepository(): MediaRepository
        fun fileLogger(): FileLogger
    }

    /** Downloads the image; logs and returns null when anything fails. */
    suspend fun download(context: Context, image: NoteImage): File? {
        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext, ImageActionsEntryPoint::class.java
        )
        return when (val result = entryPoint.mediaRepository().downloadImageToCache(image.url)) {
            is Result.Success -> result.data
            is Result.Error -> {
                entryPoint.fileLogger().error("ImageActions", "download failed for ${image.filename}", null)
                null
            }
        }
    }

    /**
     * Saves the image into the system gallery ("Pictures/KeepLocal").
     * @return true on success — callers show a confirmation.
     */
    suspend fun saveToGallery(context: Context, image: NoteImage): Boolean = withContext(Dispatchers.IO) {
        val file = download(context, image) ?: return@withContext false
        val displayName = (image.originalName ?: image.filename).replace(Regex("[^A-Za-z0-9._ -]"), "_")
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Images.Media.MIME_TYPE, mimeFor(file.name))
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/KeepLocal")
            put(MediaStore.Images.Media.IS_PENDING, 1)
        }
        val resolver = context.contentResolver
        val collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = resolver.insert(collection, values) ?: return@withContext false
        try {
            resolver.openOutputStream(uri)?.use { out ->
                file.inputStream().use { it.copyTo(out) }
            } ?: return@withContext false
            values.clear()
            values.put(MediaStore.Images.Media.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            true
        } catch (e: Exception) {
            runCatching { resolver.delete(uri, null, null) }
            false
        }
    }

    /** Fires the system share sheet with the downloaded image. */
    suspend fun share(context: Context, image: NoteImage): Boolean = withContext(Dispatchers.IO) {
        val file = download(context, image) ?: return@withContext false
        val uri: Uri = FileProvider.getUriForFile(
            context, context.packageName + ".fileprovider", file
        )
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = mimeFor(file.name)
            putExtra(Intent.EXTRA_STREAM, uri)
            // The original name reads better in the share sheet than a hash.
            image.originalName?.let { putExtra(Intent.EXTRA_SUBJECT, it) }
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        runCatching {
            context.startActivity(Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        }.getOrDefault(false)
    }

    private fun mimeFor(fileName: String): String = when (fileName.substringAfterLast('.', "").lowercase()) {
        "png" -> "image/png"
        "gif" -> "image/gif"
        "webp" -> "image/webp"
        else -> "image/jpeg"
    }
}
