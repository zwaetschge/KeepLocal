package com.keeplocal.android.ui.components

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.keeplocal.android.domain.model.NoteFile
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
 * PDF attachments on notes (v1.14.0 Nr. 5): the server had the files[]
 * array since v1.12.0, but the Android app dropped it in every mapping —
 * PDFs attached in the web UI were invisible on the phone. Opening goes
 * through the same cache-download as image viewing: the file route sits
 * behind the session cookie, an external viewer cannot fetch the URL itself.
 */
object FileActions {

    @EntryPoint
    @InstallIn(SingletonComponent::class)
    interface FileActionsEntryPoint {
        fun mediaRepository(): MediaRepository
        fun fileLogger(): FileLogger
    }

    /**
     * Downloads the attachment into the cache dir and hands it to the system
     * PDF viewer via FileProvider.
     * @return false when download or viewer start failed — callers toast.
     */
    suspend fun openInViewer(context: Context, file: NoteFile): Boolean = withContext(Dispatchers.IO) {
        val entryPoint = EntryPointAccessors.fromApplication(
            context.applicationContext, FileActionsEntryPoint::class.java
        )
        val downloaded: File = when (val result = entryPoint.mediaRepository().downloadFileToCache(file)) {
            is Result.Success -> result.data
            is Result.Error -> {
                entryPoint.fileLogger().error("FileActions", "download failed for ${file.filename}", null)
                return@withContext false
            }
        }
        val uri = FileProvider.getUriForFile(
            context, context.packageName + ".fileprovider", downloaded
        )
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, file.mimeType?.ifBlank { "application/pdf" } ?: "application/pdf")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        if (intent.resolveActivity(context.packageManager) == null) {
            entryPoint.fileLogger().log("FileActions", "no PDF viewer installed")
        }
        // resolveActivity is only a hint on Android 11+ (package visibility);
        // start regardless and catch the ActivityNotFoundException.
        try {
            context.startActivity(
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            true
        } catch (_: Exception) {
            false
        }
    }
}

/**
 * Horizontally scrolling attachment chips: tap opens the PDF, the trailing
 * X deletes it (mirrors the interaction model of [NoteImageGrid]).
 */
@Composable
fun FileAttachmentRow(
    files: List<NoteFile>,
    uploadingCount: Int,
    onOpenFile: (NoteFile) -> Unit,
    onDeleteFile: (NoteFile) -> Unit,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier.horizontalScroll(rememberScrollState()),
        verticalAlignment = Alignment.CenterVertically
    ) {
        files.forEach { file ->
            InputChip(
                selected = false,
                onClick = { onOpenFile(file) },
                label = {
                    Icon(
                        Icons.Default.Description,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        file.displayName(),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                trailingIcon = {
                    IconButton(
                        onClick = { onDeleteFile(file) },
                        modifier = Modifier.size(InputChipDefaults.IconSize)
                    ) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = null,
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            )
            Spacer(modifier = Modifier.width(8.dp))
        }
        // Uploads render as disabled placeholder chips, same contract as the
        // image grid's uploading cells.
        repeat(uploadingCount) {
            InputChip(
                selected = false,
                onClick = {},
                enabled = false,
                label = {
                    CircularProgressIndicator(
                        modifier = Modifier.size(14.dp),
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("PDF …", maxLines = 1)
                }
            )
            Spacer(modifier = Modifier.width(8.dp))
        }
    }
}
