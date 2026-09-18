package com.keeplocal.android.ui.admin

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.keeplocal.android.R
import com.keeplocal.android.util.UiState

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(
    onNavigateBack: () -> Unit,
    viewModel: AdminViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.message) {
        uiState.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.admin_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.cd_back))
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(onClick = viewModel::showCreateUserDialog) {
                Icon(Icons.Default.PersonAdd, contentDescription = stringResource(R.string.admin_create_user))
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Stats
            item {
                Text(stringResource(R.string.admin_stats), style = MaterialTheme.typography.titleMedium)
            }
            item {
                when (val stats = uiState.stats) {
                    is UiState.Loading -> CircularProgressIndicator(modifier = Modifier.padding(16.dp))
                    is UiState.Success -> {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Card(modifier = Modifier.weight(1f)) {
                                Column(modifier = Modifier.padding(16.dp)) {
                                    Text(stringResource(R.string.admin_user_count), style = MaterialTheme.typography.labelMedium)
                                    Text("${stats.data.userCount}", style = MaterialTheme.typography.headlineMedium)
                                }
                            }
                            Card(modifier = Modifier.weight(1f)) {
                                Column(modifier = Modifier.padding(16.dp)) {
                                    Text(stringResource(R.string.admin_note_count), style = MaterialTheme.typography.labelMedium)
                                    Text("${stats.data.noteCount}", style = MaterialTheme.typography.headlineMedium)
                                }
                            }
                        }
                    }
                    is UiState.Error -> Text(stats.message, color = MaterialTheme.colorScheme.error)
                    is UiState.Empty -> {}
                }
            }

            // Settings
            item {
                Text(stringResource(R.string.admin_settings), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
            }
            uiState.settings?.let { settings ->
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(stringResource(R.string.admin_registration_enabled), modifier = Modifier.weight(1f))
                            Switch(
                                checked = settings.registrationEnabled,
                                onCheckedChange = { viewModel.toggleRegistration() }
                            )
                        }
                    }
                }
            }

            // Users
            item {
                Text(stringResource(R.string.admin_users), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp))
            }
            when (val users = uiState.users) {
                is UiState.Loading -> item { CircularProgressIndicator(modifier = Modifier.padding(16.dp)) }
                is UiState.Empty -> item { Text("No users", color = MaterialTheme.colorScheme.onSurfaceVariant) }
                is UiState.Error -> item { Text(users.message, color = MaterialTheme.colorScheme.error) }
                is UiState.Success -> {
                    items(users.data, key = { it.id }) { user ->
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(16.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    if (user.isAdmin) Icons.Default.AdminPanelSettings else Icons.Default.Person,
                                    contentDescription = null
                                )
                                Spacer(modifier = Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(user.username, style = MaterialTheme.typography.bodyLarge)
                                    if (user.isAdmin) {
                                        Text("Admin", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
                                    }
                                }
                                IconButton(onClick = { viewModel.createResetToken(user) }) {
                                    Icon(
                                        Icons.Default.Key,
                                        contentDescription = stringResource(R.string.admin_create_reset_token)
                                    )
                                }
                                IconButton(onClick = { viewModel.toggleAdmin(user.id) }) {
                                    Icon(Icons.Default.Shield, contentDescription = stringResource(R.string.admin_toggle_admin))
                                }
                                IconButton(onClick = { viewModel.deleteUser(user.id) }) {
                                    Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.admin_delete_user))
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // One-time reset token (v1.9.0 Nr. 6): select-all-able text, because the
    // token has to travel to the user through another channel.
    uiState.resetToken?.let { reset ->
        AlertDialog(
            onDismissRequest = viewModel::dismissResetToken,
            title = { Text(stringResource(R.string.admin_create_reset_token)) },
            text = {
                Column {
                    Text(stringResource(R.string.admin_reset_token_created))
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = reset.username,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    SelectionContainer {
                        Text(
                            reset.token,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.padding(vertical = 4.dp)
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = viewModel::dismissResetToken) { Text(stringResource(R.string.ok)) }
            }
        )
    }

    if (uiState.showCreateUserDialog) {
        AlertDialog(
            onDismissRequest = viewModel::hideCreateUserDialog,
            title = { Text(stringResource(R.string.admin_create_user)) },
            text = {
                Column {
                    OutlinedTextField(
                        value = uiState.newUsername,
                        onValueChange = viewModel::updateNewUsername,
                        label = { Text(stringResource(R.string.auth_username)) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = uiState.newPassword,
                        onValueChange = viewModel::updateNewPassword,
                        label = { Text(stringResource(R.string.auth_password)) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = viewModel::createUser) { Text(stringResource(R.string.save)) }
            },
            dismissButton = {
                TextButton(onClick = viewModel::hideCreateUserDialog) { Text(stringResource(R.string.cancel)) }
            }
        )
    }
}
