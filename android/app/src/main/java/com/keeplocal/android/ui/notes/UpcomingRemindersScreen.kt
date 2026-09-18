package com.keeplocal.android.ui.notes

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.util.UiState
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Reminder overview (v1.9.0 Nr. 5): all notes whose reminder is still ahead,
 * soonest first. One tap opens the note, "Morgen 9 Uhr" pushes the reminder a
 * day, the check mark clears it. The 5-minute/1-hour snoozes stay on the
 * notification itself, where the thumb already is.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpcomingRemindersScreen(
    onNavigateBack: () -> Unit,
    onOpenNote: (String) -> Unit,
    viewModel: UpcomingRemindersViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        viewModel.message.collect { snackbarHostState.showSnackbar(it) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.upcoming_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.cd_back)
                        )
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        when (val notes = uiState.notes) {
            is UiState.Loading -> Column(
                modifier = Modifier.fillMaxSize().padding(padding),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                CircularProgressIndicator(modifier = Modifier.padding(24.dp))
            }
            is UiState.Error -> Column(
                modifier = Modifier.fillMaxSize().padding(padding)
            ) {
                Text(
                    notes.message,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(24.dp)
                )
            }
            is UiState.Empty -> Column(
                modifier = Modifier.fillMaxSize().padding(padding)
            ) {
                Text(
                    stringResource(R.string.upcoming_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(24.dp)
                )
            }
            is UiState.Success -> LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(notes.data, key = { it.id }) { note ->
                    UpcomingReminderRow(
                        note = note,
                        isWorking = uiState.workingNoteId == note.id,
                        onOpenNote = { onOpenNote(note.id) },
                        onSnoozeMorning = { viewModel.snoozeUntilMorning(note) },
                        onDone = { viewModel.markDone(note) }
                    )
                }
            }
        }
    }
}

@Composable
private fun UpcomingReminderRow(
    note: Note,
    isWorking: Boolean,
    onOpenNote: () -> Unit,
    onSnoozeMorning: () -> Unit,
    onDone: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onOpenNote)
                .padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Alarm,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    note.title.ifBlank { note.content }.ifBlank {
                        note.todoItems.firstOrNull { it.text.isNotBlank() }?.text ?: ""
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                note.remindAt?.let { at ->
                    Text(
                        formatUpcoming(at),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
            if (isWorking) {
                CircularProgressIndicator(
                    modifier = Modifier.padding(horizontal = 12.dp).size(20.dp),
                    strokeWidth = 2.dp
                )
            } else {
                AssistChip(
                    onClick = onSnoozeMorning,
                    label = { Text(stringResource(R.string.upcoming_snooze_morning), maxLines = 1) },
                    leadingIcon = {
                        Icon(
                            Icons.Default.Schedule,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                    }
                )
                IconButton(onClick = onDone) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = stringResource(R.string.reminder_done),
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }
    }
}

/** "18.9.2026 09:00" in the device clock — same shape as the editor chip. */
private fun formatUpcoming(at: Instant): String = try {
    DateTimeFormatter.ofPattern("d.M.yyyy HH:mm").withLocale(Locale.getDefault())
        .format(at.atZone(ZoneId.systemDefault()))
} catch (_: Exception) {
    at.toString()
}
