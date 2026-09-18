package com.keeplocal.android.ui.tags

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Label
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DriveFileRenameOutline
import androidx.compose.material.icons.filled.MergeType
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.keeplocal.android.R
import com.keeplocal.android.util.UiState

/**
 * Tag management (v1.9.0 Nr. 3): every tag in the library with its note
 * count, plus rename, merge and delete. Tags live on the notes themselves, so
 * every action here rewrites the affected notes — through the offline-capable
 * update path, so it also works on a train.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TagScreen(
    onNavigateBack: () -> Unit,
    viewModel: TagViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val renamedTemplate = stringResource(R.string.tag_renamed)
    val errorPrefix = stringResource(R.string.error_generic)

    LaunchedEffect(Unit) {
        viewModel.message.collect { done ->
            snackbarHostState.showSnackbar(renamedTemplate.format(done.count))
        }
    }
    LaunchedEffect(Unit) {
        viewModel.error.collect { error ->
            snackbarHostState.showSnackbar(error.ifBlank { errorPrefix })
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.tags_title)) },
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
        when (val tags = uiState.tags) {
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
                    tags.message,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(24.dp)
                )
            }
            is UiState.Empty -> Column(
                modifier = Modifier.fillMaxSize().padding(padding)
            ) {
                Text(
                    stringResource(R.string.tags_empty),
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
                items(tags.data, key = { it.tag }) { overview ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.Label,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    overview.tag,
                                    style = MaterialTheme.typography.bodyLarge,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    stringResource(R.string.tag_notes_count, overview.noteCount),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            IconButton(onClick = { viewModel.openRename(overview.tag) }) {
                                Icon(
                                    Icons.Default.DriveFileRenameOutline,
                                    contentDescription = stringResource(R.string.tag_rename)
                                )
                            }
                            IconButton(onClick = { viewModel.openMerge(overview.tag) }) {
                                Icon(
                                    Icons.Default.MergeType,
                                    contentDescription = stringResource(R.string.tag_merge)
                                )
                            }
                            IconButton(onClick = { viewModel.openDelete(overview.tag) }) {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = stringResource(R.string.tag_delete)
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    when (val dialog = uiState.dialog) {
        is TagDialog.Rename -> AlertDialog(
            onDismissRequest = viewModel::closeDialog,
            title = { Text(stringResource(R.string.tag_rename)) },
            text = {
                OutlinedTextField(
                    value = uiState.renameInput,
                    onValueChange = viewModel::updateRenameInput,
                    label = { Text(stringResource(R.string.tag_new_name)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
            },
            confirmButton = {
                TextButton(
                    onClick = viewModel::submitRename,
                    enabled = !uiState.isWorking &&
                        uiState.renameInput.isNotBlank() &&
                        uiState.renameInput.trim() != dialog.tag
                ) { Text(stringResource(R.string.tag_rename_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = viewModel::closeDialog) { Text(stringResource(R.string.cancel)) }
            }
        )
        is TagDialog.Merge -> {
            val targets = viewModel.mergeTargets(dialog.tag)
            AlertDialog(
                onDismissRequest = viewModel::closeDialog,
                title = { Text(stringResource(R.string.tag_merge)) },
                text = {
                    if (targets.isEmpty()) {
                        // Only tag in the library — merging needs somewhere to go.
                        Text(stringResource(R.string.tags_empty))
                    } else {
                        MergeTargetPicker(
                            source = dialog.tag,
                            targets = targets,
                            selected = uiState.mergeTarget,
                            onSelect = viewModel::updateMergeTarget
                        )
                    }
                },
                confirmButton = {
                    TextButton(
                        onClick = viewModel::submitMerge,
                        enabled = !uiState.isWorking && uiState.mergeTarget.isNotBlank()
                    ) { Text(stringResource(R.string.tag_merge_confirm)) }
                },
                dismissButton = {
                    TextButton(onClick = viewModel::closeDialog) { Text(stringResource(R.string.cancel)) }
                }
            )
        }
        is TagDialog.Delete -> AlertDialog(
            onDismissRequest = viewModel::closeDialog,
            title = { Text(stringResource(R.string.tag_delete_confirm_title)) },
            text = { Text(stringResource(R.string.tag_delete_confirm_text)) },
            confirmButton = {
                TextButton(
                    onClick = viewModel::submitDelete,
                    enabled = !uiState.isWorking
                ) { Text(stringResource(R.string.tag_delete)) }
            },
            dismissButton = {
                TextButton(onClick = viewModel::closeDialog) { Text(stringResource(R.string.cancel)) }
            }
        )
        TagDialog.None -> Unit
    }
}

/** Dropdown of the library's other tags; free text is not allowed — merging
 *  into a typo would just create a new tag nobody sees. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MergeTargetPicker(
    source: String,
    targets: List<String>,
    selected: String,
    onSelect: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        ExposedDropdownMenuBox(
            expanded = expanded,
            onExpandedChange = { expanded = it }
        ) {
            OutlinedTextField(
                value = selected,
                onValueChange = {},
                readOnly = true,
                label = { Text(stringResource(R.string.tag_merge_target)) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                modifier = Modifier.fillMaxWidth().menuAnchor()
            )
            ExposedDropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false }
            ) {
                targets.forEach { target ->
                    androidx.compose.material3.DropdownMenuItem(
                        text = { Text(target) },
                        onClick = {
                            onSelect(target)
                            expanded = false
                        }
                    )
                }
            }
        }
    }
}
