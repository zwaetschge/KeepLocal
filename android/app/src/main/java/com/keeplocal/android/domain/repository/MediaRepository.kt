package com.keeplocal.android.domain.repository

import android.net.Uri
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteFile
import com.keeplocal.android.util.Result
import java.io.File

/**
 * Server-side media features for notes: image attachments and audio
 * transcription. Both require the note to exist on the server already
 * (offline_/unsaved notes must be saved first), and both are online-only —
 * there is no offline queue for media operations.
 *
 * Note: the interface deliberately uses [Uri] because the upload input is
 * Android photo-picker output that must be copied promptly before its grant
 * lapses; hiding that behind Strings would misrepresent the contract.
 */
interface MediaRepository {
    /**
     * Uploads the picked images to the note and returns the updated note.
     * More than [MediaLimits.MAX_IMAGES_PER_REQUEST] images are split into
     * sequential requests. Fails (Result.Error) when offline or when the
     * server rejects the files.
     */
    suspend fun uploadImages(noteId: String, uris: List<Uri>): Result<Note>

    /** Deletes one image attachment and returns the updated note. */
    suspend fun deleteImage(noteId: String, filename: String): Result<Note>

    /**
     * Uploads the picked PDFs to the note and returns the updated note
     * (v1.14.0 Nr. 5). Chunks to the server's 5-per-request limit; rejects
     * non-PDF picks client-side before wasting an upload.
     */
    suspend fun uploadFiles(noteId: String, uris: List<Uri>): Result<Note>

    /** Deletes one PDF attachment and returns the updated note. */
    suspend fun deleteFile(noteId: String, filename: String): Result<Note>

    /**
     * Downloads a PDF attachment into the cache dir so it can be opened in a
     * viewer — the files route sits behind the session cookie, so an external
     * viewer cannot fetch the URL itself (same lesson as the image viewer).
     */
    suspend fun downloadFileToCache(file: NoteFile): Result<File>

    /**
     * Uploads the recorded audio file (M4A/AAC) and returns the transcription.
     * The server does NOT append the text to the note — the caller does.
     */
    suspend fun transcribeAudio(noteId: String, audioFile: File): Result<TranscriptionResult>

    /**
     * Resolves a server-relative media path ("/uploads/images/x.webp") into an
     * absolute URL using the currently configured server. Returns null while
     * the base URL is not (yet) known.
     */
    fun resolveImageUrl(path: String?): String?

    /**
     * Suspends until the server base URL is known (max ~2s), then resolves
     * like [resolveImageUrl]. Compose fallback for the cold-start window.
     */
    suspend fun awaitImageUrl(path: String?): String?

    /**
     * Downloads a server image into the cache dir (v1.9.0 image viewer) so it
     * can be saved to the gallery or shared. One file per filename; a repeat
     * download overwrites it. Online-only like every media operation.
     */
    suspend fun downloadImageToCache(path: String): Result<File>
}

/** Whisper transcription result for a recorded audio file. */
data class TranscriptionResult(
    val text: String,
    val language: String? = null
)

/**
 * Pure server upload policies, mirrored client-side so the UI can clamp
 * selections before wasting a request.
 */
object MediaLimits {
    /** Server accepts at most 5 images per single upload request. */
    const val MAX_IMAGES_PER_REQUEST: Int = 5

    /** Server accepts at most 5 PDF attachments per single upload request. */
    const val MAX_FILES_PER_REQUEST: Int = 5

    /** Server accepts at most 25 PDF attachments per note in total. */
    const val MAX_FILES_PER_NOTE: Int = 25

    /** Server accepts at most 25 images per note in total. */
    const val MAX_IMAGES_PER_NOTE: Int = 25

    /**
     * How many of [picked] images may still be attached to a note that
     * already has [currentCount] images. Never negative, never above picked.
     * A negative input is an impossible state (corrupt count) and allows
     * nothing rather than inflating the budget.
     */
    fun allowedPickCount(currentCount: Int, picked: Int): Int {
        if (currentCount < 0 || picked < 0) return 0
        val remaining = (MAX_IMAGES_PER_NOTE - currentCount).coerceAtLeast(0)
        return picked.coerceAtMost(remaining)
    }

    /**
     * Same budget logic for PDF attachments (v1.14.0 Nr. 5): how many of
     * [picked] files may still be attached to a note that already has
     * [currentCount] attachments.
     */
    fun allowedFilePickCount(currentCount: Int, picked: Int): Int {
        if (currentCount < 0 || picked < 0) return 0
        val remaining = (MAX_FILES_PER_NOTE - currentCount).coerceAtLeast(0)
        return picked.coerceAtMost(remaining)
    }
}
