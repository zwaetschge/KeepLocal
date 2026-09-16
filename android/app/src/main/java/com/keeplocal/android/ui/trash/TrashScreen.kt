package com.keeplocal.android.ui.trash

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Restore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.ui.components.EmptyState
import com.keeplocal.android.ui.components.EmptyStateVariant
import com.keeplocal.android.util.TrashRetention
import com.keeplocal.android.util.UiState
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Trash (WebUI parity, Top-30 batch 8): lists the notes the server keeps for
 * 30 days after deletion, newest first. Restore brings a note back, the broom
 * empties everything — both with the confirmations the WebUI asks for too,
 * because "empty trash" destroys the files immediately.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrashScreen(
    onNavigateBack: () -> Unit,
    viewModel: TrashViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var notePendingPurge by remember { mutableStateOf<Note?>(null) }
    var showEmptyConfirm by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.message) {
        uiState.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.trash_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.cd_back))
                    }
                },
                actions = {
                    val hasNotes = uiState.notes is UiState.Success
                    if (hasNotes) {
                        IconButton(
                            onClick = { showEmptyConfirm = true },
                            enabled = !uiState.isMutating
                        ) {
                            Icon(
                                Icons.Default.DeleteSweep,
                                contentDescription = stringResource(R.string.trash_empty_action)
                            )
                        }
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        when (val state = uiState.notes) {
            is UiState.Loading -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) { CircularProgressIndicator() }

            is UiState.Error -> Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        stringResource(R.string.trash_load_failed),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.error
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(onClick = { viewModel.loadTrash() }) {
                        Text(stringResource(R.string.trash_retry_load))
                    }
                }
            }

            is UiState.Empty -> Box(modifier = Modifier.fillMaxSize().padding(padding)) {
                // Line-art trash scene (v1.7.0 Nr. 9) instead of a lone label.
                EmptyState(
                    variant = EmptyStateVariant.TRASH,
                    title = stringResource(R.string.trash_empty_state_title),
                    subtitle = stringResource(R.string.trash_empty_state_subtitle),
                    modifier = Modifier.fillMaxSize()
                )
            }

            is UiState.Success -> Column(
                modifier = Modifier.fillMaxSize().padding(padding)
            ) {
                Text(
                    stringResource(R.string.trash_retention_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                )
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(state.data, key = { it.id }) { note ->
                        TrashedNoteCard(
                            note = note,
                            enabled = !uiState.isMutating,
                            onRestore = { viewModel.restoreNote(note.id) },
                            onPurge = { notePendingPurge = note }
                        )
                    }
                }
            }
        }
    }

    if (notePendingPurge != null) {
        val note = notePendingPurge!!
        AlertDialog(
            onDismissRequest = { notePendingPurge = null },
            title = { Text(stringResource(R.string.trash_delete_forever_title)) },
            text = {
                Text(
                    stringResource(
                        R.string.trash_delete_forever_text,
                        note.title.ifBlank { note.content.take(40).ifBlank { "?" } }
                    )
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        notePendingPurge = null
                        viewModel.purgeNote(note.id)
                    }
                ) { Text(stringResource(R.string.trash_delete_forever_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { notePendingPurge = null }) {
                    Text(stringResource(R.string.action_cancel))
                }
            }
        )
    }

    if (showEmptyConfirm) {
        AlertDialog(
            onDismissRequest = { showEmptyConfirm = false },
            title = { Text(stringResource(R.string.trash_empty_title)) },
            text = { Text(stringResource(R.string.trash_empty_text)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showEmptyConfirm = false
                        viewModel.emptyTrash()
                    }
                ) { Text(stringResource(R.string.trash_empty_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = { showEmptyConfirm = false }) {
                    Text(stringResource(R.string.action_cancel))
                }
            }
        )
    }
}

@Composable
private fun TrashedNoteCard(
    note: Note,
    enabled: Boolean,
    onRestore: () -> Unit,
    onPurge: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                val preview = note.title.ifBlank {
                    note.content.replace('\n', ' ').trim()
                }
                Text(
                    text = preview.ifBlank { stringResource(R.string.trash_untitled) },
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                note.deletedAt?.let { deleted ->
                    Spacer(modifier = Modifier.height(2.dp))
                    // "noch X Tage": the server's 30-day TTL is silent — this
                    // is the only warning before a note vanishes for good.
                    val daysLeft = TrashRetention.daysRemaining(deleted)
                    val daysSuffix = daysLeft?.let { days ->
                        " · " + stringResource(R.plurals.trash_days_remaining, days, days)
                    }.orEmpty()
                    Text(
                        text = stringResource(R.string.trash_deleted_at, formatDeletedAt(deleted)) + daysSuffix,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (daysLeft != null && daysLeft <= 3) {
                            MaterialTheme.colorScheme.error
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )
                }
            }
            IconButton(onClick = onRestore, enabled = enabled) {
                Icon(
                    Icons.Default.Restore,
                    contentDescription = stringResource(R.string.trash_restore)
                )
            }
            IconButton(onClick = onPurge, enabled = enabled) {
                Icon(
                    Icons.Default.DeleteForever,
                    contentDescription = stringResource(R.string.trash_delete_forever_confirm),
                    tint = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

private val TrashDateFormatter: DateTimeFormatter =
    DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(Locale.getDefault())

private fun formatDeletedAt(instant: Instant): String =
    TrashDateFormatter.format(instant.atZone(java.time.ZoneId.systemDefault()))
