package com.keeplocal.android.ui.notes

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.keeplocal.android.R

/**
 * Detail half of the list-detail layout. Hosts a full note editor for the
 * selected note, or a placeholder while nothing is selected.
 *
 * Each [EditorRequest] gets its own [NoteEditorViewModel] instance (keyed by
 * note id and serial) so switching notes never shows the previous note's draft.
 */
@Composable
fun NoteDetailPane(
    request: EditorRequest?,
    onClose: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(modifier = modifier.fillMaxSize()) {
        if (request == null) {
            EmptyDetailPlaceholder()
        } else {
            val viewModelKey = "editor-${request.noteId ?: "new"}-${request.serial}"
            key(viewModelKey) {
                val viewModel: NoteEditorViewModel = hiltViewModel(key = viewModelKey)
                LaunchedEffect(viewModelKey) { viewModel.bindNoteId(request.noteId) }
                NoteEditorContent(
                    viewModel = viewModel,
                    onNavigateBack = onClose,
                    isEmbedded = true
                )
            }
        }
    }
}

@Composable
private fun EmptyDetailPlaceholder() {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(
                Icons.AutoMirrored.Filled.MenuBook,
                contentDescription = null,
                modifier = Modifier.size(56.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
            )
            Spacer(modifier = Modifier.height(12.dp))
            Text(
                text = stringResource(R.string.detail_empty_title),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = stringResource(R.string.detail_empty_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f)
            )
        }
    }
}
