package com.keeplocal.android.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.BiometricManager
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.keeplocal.android.BuildConfig
import com.keeplocal.android.R
import com.keeplocal.android.data.api.dto.ApiKeyDto
import com.keeplocal.android.data.local.entity.OperationType
import com.keeplocal.android.domain.usecase.notes.ExportNotesUseCase
import com.keeplocal.android.ui.notes.NoteViewMode
import com.keeplocal.android.ui.theme.ThemeMode
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateBack: () -> Unit,
    onLogout: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var showThemeDialog by remember { mutableStateOf(false) }
    var showLanguageDialog by remember { mutableStateOf(false) }
    var showLogoutConfirm by remember { mutableStateOf(false) }
    var showCreateKeyDialog by remember { mutableStateOf(false) }
    var revokeTarget by remember { mutableStateOf<ApiKeyDto?>(null) }
    var showChangePasswordDialog by remember { mutableStateOf(false) }
    var showQueueDialog by remember { mutableStateOf(false) }
    var showBackupIntervalDialog by remember { mutableStateOf(false) }
    var showBackupRetentionDialog by remember { mutableStateOf(false) }

    val context = LocalContext.current
    // The lock only makes sense with something to authenticate with; without
    // hardware (or enrollment) the toggle stays off and explains why.
    val biometricAvailable = remember {
        BiometricManager.from(context).canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_WEAK or
                BiometricManager.Authenticators.DEVICE_CREDENTIAL
        ) == BiometricManager.BIOMETRIC_SUCCESS
    }

    // SAF documents for the two export flavors.
    val exportJsonLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri -> uri?.let { viewModel.writeExport(it, ExportNotesUseCase.Format.JSON) } }

    val exportMarkdownLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("text/markdown")
    ) { uri -> uri?.let { viewModel.writeExport(it, ExportNotesUseCase.Format.MARKDOWN) } }

    // JSON import (v1.8.0 Nr. 1), Google Keep import (v1.9.0 Nr. 1) and the
    // backup target folder (Nr. 7).
    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> uri?.let { viewModel.importFromUri(it) } }

    val importKeepLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris -> viewModel.importKeepFromUris(uris) }

    val backupFolderLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri -> uri?.let { viewModel.setBackupFolder(it) } }

    // Markdown round-trip (v1.10.0): a picked folder tree imports as folder
    // notes (Trilium/Obsidian export), the ZIP export mirrors the whole tree.
    val importMarkdownLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocumentTree()
    ) { uri -> uri?.let { viewModel.importMarkdownFromTree(it) } }

    val exportZipLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/zip")
    ) { uri -> uri?.let { viewModel.writeMarkdownExport(it) } }

    LaunchedEffect(Unit) {
        viewModel.logoutEvent.collect { onLogout() }
    }

    LaunchedEffect(uiState.message) {
        uiState.message?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }

    LaunchedEffect(Unit) {
        viewModel.loadApiKeys()
    }

    // Diagnostic log → Android share sheet as plain text.
    val shareLogTitle = stringResource(R.string.settings_share_log)
    LaunchedEffect(Unit) {
        viewModel.shareLogEvent.collect { content ->
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, "KeepLocal $shareLogTitle")
                putExtra(Intent.EXTRA_TEXT, content)
            }
            context.startActivity(Intent.createChooser(intent, null))
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.cd_back))
                    }
                }
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
        ) {
            // Server section
            Text(
                stringResource(R.string.settings_server),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_server_url)) },
                supportingContent = { Text(uiState.serverUrl.ifBlank { "-" }) },
                leadingContent = { Icon(Icons.Default.Cloud, contentDescription = null) }
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_connection_status)) },
                supportingContent = {
                    Text(
                        if (uiState.isConnected) stringResource(R.string.settings_connected)
                        else stringResource(R.string.settings_disconnected)
                    )
                },
                leadingContent = {
                    Icon(
                        if (uiState.isConnected) Icons.Default.CheckCircle else Icons.Default.Error,
                        contentDescription = null,
                        tint = if (uiState.isConnected) MaterialTheme.colorScheme.primary
                               else MaterialTheme.colorScheme.error
                    )
                }
            )

            // Periodic WorkManager sync; off = no background traffic at all.
            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_background_sync)) },
                supportingContent = { Text(stringResource(R.string.settings_background_sync_hint)) },
                leadingContent = { Icon(Icons.Default.Sync, contentDescription = null) },
                trailingContent = {
                    Switch(
                        checked = uiState.backgroundSync,
                        onCheckedChange = { viewModel.toggleBackgroundSync() }
                    )
                }
            )

            // Account-wide dictation switch — hides the editor mic on all
            // devices of this account when off.
            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_voice_transcription)) },
                supportingContent = { Text(stringResource(R.string.settings_voice_transcription_hint)) },
                leadingContent = { Icon(Icons.Default.Mic, contentDescription = null) },
                trailingContent = {
                    Switch(
                        checked = uiState.voiceTranscription,
                        onCheckedChange = { viewModel.toggleVoiceTranscription() }
                    )
                }
            )

            @Suppress("DEPRECATION")
            Divider(modifier = Modifier.padding(horizontal = 16.dp))

            // Appearance
            Text(
                stringResource(R.string.settings_theme),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_theme)) },
                supportingContent = {
                    Text(themeDisplayName(uiState.themeMode))
                },
                leadingContent = { Icon(Icons.Default.Palette, contentDescription = null) },
                modifier = Modifier.clickable { showThemeDialog = true }
            )

            // Material You (v1.7.0 design round): wallpaper-tinted light/dark
            // schemes. The special modes keep their fixed palettes.
            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_material_you)) },
                supportingContent = { Text(stringResource(R.string.settings_material_you_hint)) },
                leadingContent = { Icon(Icons.Default.Wallpaper, contentDescription = null) },
                trailingContent = {
                    Switch(
                        checked = uiState.materialYou,
                        onCheckedChange = { viewModel.toggleMaterialYou() }
                    )
                }
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_view_mode)) },
                supportingContent = {
                    Text(
                        stringResource(
                            if (uiState.noteViewMode == NoteViewMode.LIST) {
                                R.string.settings_view_mode_list
                            } else {
                                R.string.settings_view_mode_grid
                            }
                        )
                    )
                },
                leadingContent = { Icon(Icons.Default.ViewAgenda, contentDescription = null) },
                modifier = Modifier.clickable {
                    viewModel.updateNoteViewMode(
                        if (uiState.noteViewMode == NoteViewMode.LIST) NoteViewMode.GRID else NoteViewMode.LIST
                    )
                }
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_language)) },
                supportingContent = {
                    Text(
                        if (uiState.language == "de") stringResource(R.string.settings_language_de)
                        else stringResource(R.string.settings_language_en)
                    )
                },
                leadingContent = { Icon(Icons.Default.Language, contentDescription = null) },
                modifier = Modifier.clickable { showLanguageDialog = true }
            )

            @Suppress("DEPRECATION")
            Divider(modifier = Modifier.padding(horizontal = 16.dp))

            // Security
            Text(
                stringResource(R.string.settings_security),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_remember_credentials)) },
                leadingContent = { Icon(Icons.Default.Key, contentDescription = null) },
                trailingContent = {
                    Switch(
                        checked = uiState.rememberCredentials,
                        onCheckedChange = { viewModel.toggleRememberCredentials() }
                    )
                }
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_biometric_lock)) },
                supportingContent = {
                    if (!biometricAvailable) {
                        Text(stringResource(R.string.settings_biometric_unavailable))
                    }
                },
                leadingContent = { Icon(Icons.Default.Fingerprint, contentDescription = null) },
                trailingContent = {
                    Switch(
                        checked = uiState.biometricLock,
                        onCheckedChange = { viewModel.toggleBiometricLock() },
                        enabled = biometricAvailable
                    )
                }
            )

            // Account password change — previously WebUI-only.
            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_change_password)) },
                leadingContent = { Icon(Icons.Default.Password, contentDescription = null) },
                modifier = Modifier.clickable { showChangePasswordDialog = true }
            )

            @Suppress("DEPRECATION")
            Divider(modifier = Modifier.padding(horizontal = 16.dp))

            // API keys
            Text(
                stringResource(R.string.settings_api_keys),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )

            if (uiState.isLoadingApiKeys && uiState.apiKeys.isEmpty()) {
                ListItem(
                    headlineContent = { Text(stringResource(R.string.loading)) },
                    leadingContent = {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    }
                )
            } else if (uiState.apiKeys.isEmpty()) {
                ListItem(
                    headlineContent = { Text(stringResource(R.string.api_keys_empty)) },
                    leadingContent = { Icon(Icons.Default.VpnKey, contentDescription = null) }
                )
            } else {
                uiState.apiKeys.forEach { key ->
                    ListItem(
                        headlineContent = { Text(key.name) },
                        supportingContent = {
                            Column {
                                Text(stringResource(R.string.api_key_details, key.prefix, formatDate(key.createdAt)))
                                Text(
                                    stringResource(
                                        R.string.api_key_expires,
                                        key.expiresAt?.let { formatDate(it) }
                                            ?: stringResource(R.string.api_key_never_expires)
                                    )
                                )
                            }
                        },
                        leadingContent = { Icon(Icons.Default.VpnKey, contentDescription = null) },
                        trailingContent = {
                            IconButton(onClick = { revokeTarget = key }) {
                                Icon(
                                    Icons.Default.Delete,
                                    contentDescription = stringResource(R.string.api_key_revoke),
                                    tint = MaterialTheme.colorScheme.error
                                )
                            }
                        }
                    )
                }
            }

            ListItem(
                headlineContent = { Text(stringResource(R.string.api_key_create)) },
                leadingContent = { Icon(Icons.Default.Add, contentDescription = null) },
                modifier = Modifier.clickable { showCreateKeyDialog = true }
            )

            @Suppress("DEPRECATION")
            Divider(modifier = Modifier.padding(horizontal = 16.dp))

            // Data
            Text(
                stringResource(R.string.settings_data),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )

            // Offline queue: what is still waiting to reach the server.
            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_queue)) },
                supportingContent = { Text(stringResource(R.string.settings_queue_hint)) },
                leadingContent = { Icon(Icons.Default.CloudUpload, contentDescription = null) },
                modifier = Modifier.clickable {
                    viewModel.loadPendingOps()
                    showQueueDialog = true
                }
            )

            // Exports go through SAF so the user picks the destination.
            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_export_json)) },
                supportingContent = {
                    Text(
                        if (uiState.isExporting) stringResource(R.string.settings_exporting)
                        else stringResource(R.string.settings_export_json_hint)
                    )
                },
                leadingContent = { Icon(Icons.Default.DataObject, contentDescription = null) },
                modifier = Modifier.clickable(enabled = !uiState.isExporting) {
                    exportJsonLauncher.launch("KeepLocal-backup.json")
                }
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_export_markdown)) },
                supportingContent = { Text(stringResource(R.string.settings_export_markdown_hint)) },
                leadingContent = { Icon(Icons.Default.Article, contentDescription = null) },
                modifier = Modifier.clickable(enabled = !uiState.isExporting) {
                    exportMarkdownLauncher.launch("KeepLocal-notizen.md")
                }
            )

            // JSON import (v1.8.0 Nr. 1): every note in the export lands as a
            // new copy — nothing is merged onto existing notes.
            ListItem(
                headlineContent = { Text(stringResource(R.string.import_title)) },
                supportingContent = {
                    Text(
                        if (uiState.isImporting) stringResource(R.string.loading)
                        else stringResource(R.string.import_description)
                    )
                },
                leadingContent = {
                    if (uiState.isImporting) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.UploadFile, contentDescription = null)
                    }
                },
                modifier = Modifier.clickable(enabled = !uiState.isImporting) {
                    importLauncher.launch(arrayOf("application/json"))
                }
            )

            // Google Keep import (v1.9.0 Nr. 1): multi-select of the Takeout
            // JSON files; non-Keep files are skipped and reported.
            ListItem(
                headlineContent = { Text(stringResource(R.string.import_keep_title)) },
                supportingContent = {
                    Text(
                        if (uiState.isImporting) stringResource(R.string.loading)
                        else stringResource(R.string.import_keep_hint)
                    )
                },
                leadingContent = {
                    if (uiState.isImporting) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.MoveUp, contentDescription = null)
                    }
                },
                modifier = Modifier.clickable(enabled = !uiState.isImporting) {
                    importKeepLauncher.launch(arrayOf("application/json"))
                }
            )

            // Trilium/Markdown import (v1.10.0 Nr. 4): a folder tree of .md
            // files becomes folder notes with children — the tree survives.
            ListItem(
                headlineContent = { Text(stringResource(R.string.import_markdown_title)) },
                supportingContent = {
                    Text(
                        if (uiState.isTransferring) stringResource(R.string.loading)
                        else stringResource(R.string.import_markdown_hint)
                    )
                },
                leadingContent = {
                    if (uiState.isTransferring) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.AccountTree, contentDescription = null)
                    }
                },
                modifier = Modifier.clickable(enabled = !uiState.isTransferring) {
                    importMarkdownLauncher.launch(null)
                }
            )

            // Markdown ZIP export (v1.10.0 Nr. 5): one .zip with the whole
            // tree as folders of .md files — readable anywhere, re-importable.
            ListItem(
                headlineContent = { Text(stringResource(R.string.export_zip_title)) },
                supportingContent = {
                    Text(
                        if (uiState.isTransferring) stringResource(R.string.loading)
                        else stringResource(R.string.export_zip_hint)
                    )
                },
                leadingContent = {
                    if (uiState.isTransferring) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.FolderZip, contentDescription = null)
                    }
                },
                modifier = Modifier.clickable(enabled = !uiState.isTransferring) {
                    exportZipLauncher.launch("KeepLocal-notizen.zip")
                }
            )

            // Journal folder (v1.10.0 Nr. 6): where the sidebar's "Heute"
            // notes land; root level when nothing is picked.
            ListItem(
                headlineContent = { Text(stringResource(R.string.journal_folder_label)) },
                supportingContent = {
                    Text(
                        uiState.journalFolderTitle?.ifBlank { null }
                            ?: stringResource(R.string.journal_folder_root)
                    )
                },
                leadingContent = { Icon(Icons.Default.Today, contentDescription = null) },
                modifier = Modifier.clickable { viewModel.openJournalPicker() }
            )

            // Automatic backup (v1.8.0 Nr. 7): WorkManager writes JSON exports
            // into a SAF folder granted once; retention trims old files.
            Text(
                stringResource(R.string.backup_section_title),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.backup_interval_label)) },
                supportingContent = { Text(backupIntervalLabel(uiState.backupIntervalHours)) },
                leadingContent = { Icon(Icons.Default.Schedule, contentDescription = null) },
                modifier = Modifier.clickable { showBackupIntervalDialog = true }
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.backup_folder_label)) },
                supportingContent = {
                    Text(
                        if (uiState.backupTreeUri.isBlank()) stringResource(R.string.backup_choose_folder)
                        else Uri.parse(uiState.backupTreeUri).lastPathSegment
                            ?: uiState.backupTreeUri
                    )
                },
                leadingContent = { Icon(Icons.Default.Folder, contentDescription = null) },
                modifier = Modifier.clickable { backupFolderLauncher.launch(null) }
            )

            ListItem(
                headlineContent = {
                    Text(stringResource(R.string.backup_retention_label, uiState.backupRetention))
                },
                leadingContent = { Icon(Icons.Default.History, contentDescription = null) },
                modifier = Modifier.clickable { showBackupRetentionDialog = true }
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.backup_now)) },
                supportingContent = {
                    Text(
                        if (uiState.lastBackupAt == 0L) stringResource(R.string.backup_last_never)
                        else stringResource(R.string.backup_last_at, formatQueueTime(uiState.lastBackupAt))
                    )
                },
                leadingContent = { Icon(Icons.Default.Save, contentDescription = null) },
                modifier = Modifier.clickable { viewModel.backupNow() }
            )

            // Support bundle for bug reports: redacted diagnostic log as text.
            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_share_log)) },
                leadingContent = { Icon(Icons.Default.BugReport, contentDescription = null) },
                modifier = Modifier.clickable { viewModel.shareLog() }
            )

            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_clear_cache)) },
                leadingContent = { Icon(Icons.Default.DeleteSweep, contentDescription = null) },
                modifier = Modifier.clickable { viewModel.clearCache() }
            )

            ListItem(
                headlineContent = {
                    Text(stringResource(R.string.auth_logout), color = MaterialTheme.colorScheme.error)
                },
                leadingContent = {
                    Icon(Icons.AutoMirrored.Filled.Logout, contentDescription = null, tint = MaterialTheme.colorScheme.error)
                },
                modifier = Modifier.clickable { showLogoutConfirm = true }
            )

            // About
            @Suppress("DEPRECATION")
            Divider(modifier = Modifier.padding(horizontal = 16.dp))
            Text(
                stringResource(R.string.settings_about),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
            )
            ListItem(
                headlineContent = { Text(stringResource(R.string.settings_version, BuildConfig.VERSION_NAME)) },
                leadingContent = { Icon(Icons.Default.Info, contentDescription = null) }
            )

            Spacer(modifier = Modifier.height(32.dp))
        }
    }

    // Theme dialog
    if (showThemeDialog) {
        AlertDialog(
            onDismissRequest = { showThemeDialog = false },
            title = { Text(stringResource(R.string.settings_theme)) },
            text = {
                Column {
                    ThemeMode.entries.forEach { mode ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.updateThemeMode(mode)
                                    showThemeDialog = false
                                }
                                .padding(vertical = 12.dp, horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = uiState.themeMode == mode,
                                onClick = {
                                    viewModel.updateThemeMode(mode)
                                    showThemeDialog = false
                                }
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(themeDisplayName(mode))
                        }
                    }
                }
            },
            confirmButton = {}
        )
    }

    // Language dialog
    if (showLanguageDialog) {
        AlertDialog(
            onDismissRequest = { showLanguageDialog = false },
            title = { Text(stringResource(R.string.settings_language)) },
            text = {
                Column {
                    listOf("en" to R.string.settings_language_en, "de" to R.string.settings_language_de).forEach { (code, resId) ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.updateLanguage(code)
                                    showLanguageDialog = false
                                }
                                .padding(vertical = 12.dp, horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = uiState.language == code,
                                onClick = {
                                    viewModel.updateLanguage(code)
                                    showLanguageDialog = false
                                }
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(stringResource(resId))
                        }
                    }
                }
            },
            confirmButton = {}
        )
    }

    // API key creation dialog
    if (showCreateKeyDialog) {
        CreateApiKeyDialog(
            onCreate = { name, expiresInDays ->
                viewModel.createApiKey(name, expiresInDays)
                showCreateKeyDialog = false
            },
            onDismiss = { showCreateKeyDialog = false }
        )
    }

    // Password change dialog. The server bumps the session version on
    // success, which signs out OTHER devices — hinted below the fields.
    if (showChangePasswordDialog) {
        ChangePasswordDialog(
            isBusy = uiState.isChangingPassword,
            onSubmit = { current, new ->
                viewModel.changePassword(current, new)
                showChangePasswordDialog = false
            },
            onDismiss = { showChangePasswordDialog = false }
        )
    }

    // Offline sync queue: transparent view of everything not yet on the
    // server, with a per-op discard for entries that will never succeed.
    if (showQueueDialog) {
        AlertDialog(
            onDismissRequest = { showQueueDialog = false },
            title = { Text(stringResource(R.string.settings_queue)) },
            text = {
                Column {
                    Text(
                        stringResource(R.string.settings_queue_dialog_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    if (uiState.isLoadingPendingOps && uiState.pendingOps.isEmpty()) {
                        Row(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                            horizontalArrangement = Arrangement.Center
                        ) { CircularProgressIndicator() }
                    } else if (uiState.pendingOps.isEmpty()) {
                        Text(
                            stringResource(R.string.settings_queue_empty),
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(vertical = 8.dp)
                        )
                    } else {
                        LazyColumn(
                            modifier = Modifier.fillMaxWidth().heightIn(max = 320.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            items(uiState.pendingOps, key = { it.id }) { op ->
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            "${queueTypeLabel(op.operationType)} · ${op.noteTitle}",
                                            style = MaterialTheme.typography.bodyMedium,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text(
                                            formatQueueTime(op.createdAt),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                        )
                                    }
                                    IconButton(onClick = { viewModel.discardPendingOp(op.id) }) {
                                        Icon(
                                            Icons.Default.Close,
                                            contentDescription = stringResource(R.string.settings_queue_discard),
                                            tint = MaterialTheme.colorScheme.error
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showQueueDialog = false }) { Text(stringResource(R.string.ok)) }
            }
        )
    }

    // One-time display of the freshly created key
    uiState.newlyCreatedApiKey?.let { key ->
        val clipboard = LocalClipboardManager.current
        AlertDialog(
            onDismissRequest = { viewModel.dismissNewApiKey() },
            title = { Text(stringResource(R.string.api_key_created_title)) },
            text = {
                Column {
                    Text(
                        stringResource(R.string.api_key_created_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        key,
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    clipboard.setText(AnnotatedString(key))
                    viewModel.dismissNewApiKey()
                }) { Text(stringResource(R.string.api_key_copy)) }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.dismissNewApiKey() }) { Text(stringResource(R.string.ok)) }
            }
        )
    }

    // Revoke confirmation
    revokeTarget?.let { key ->
        AlertDialog(
            onDismissRequest = { revokeTarget = null },
            title = { Text(stringResource(R.string.api_key_revoke_title)) },
            text = { Text(stringResource(R.string.api_key_revoke_message, key.name)) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.revokeApiKey(key.resolvedId())
                    revokeTarget = null
                }) { Text(stringResource(R.string.api_key_revoke), color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { revokeTarget = null }) { Text(stringResource(R.string.cancel)) }
            }
        )
    }

    // Logout confirmation
    if (showLogoutConfirm) {
        AlertDialog(
            onDismissRequest = { showLogoutConfirm = false },
            title = { Text(stringResource(R.string.auth_logout)) },
            confirmButton = {
                TextButton(onClick = {
                    showLogoutConfirm = false
                    viewModel.logout()
                }) { Text(stringResource(R.string.auth_logout)) }
            },
            dismissButton = {
                TextButton(onClick = { showLogoutConfirm = false }) { Text(stringResource(R.string.cancel)) }
            }
        )
    }

    // Backup interval (v1.8.0 Nr. 7): 0 cancels the periodic work.
    if (showBackupIntervalDialog) {
        AlertDialog(
            onDismissRequest = { showBackupIntervalDialog = false },
            title = { Text(stringResource(R.string.backup_interval_label)) },
            text = {
                Column {
                    listOf(
                        0 to R.string.backup_interval_off,
                        24 to R.string.backup_interval_daily,
                        168 to R.string.backup_interval_weekly,
                        720 to R.string.backup_interval_monthly
                    ).forEach { (hours, labelRes) ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.setBackupInterval(hours)
                                    showBackupIntervalDialog = false
                                }
                                .padding(vertical = 12.dp, horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = uiState.backupIntervalHours == hours,
                                onClick = {
                                    viewModel.setBackupInterval(hours)
                                    showBackupIntervalDialog = false
                                }
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(stringResource(labelRes))
                        }
                    }
                }
            },
            confirmButton = {}
        )
    }

    // Backup retention: how many files to keep before the worker prunes.
    if (showBackupRetentionDialog) {
        AlertDialog(
            onDismissRequest = { showBackupRetentionDialog = false },
            title = { Text(stringResource(R.string.backup_retention_label, uiState.backupRetention)) },
            text = {
                Column {
                    listOf(3, 7, 14, 30).forEach { count ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.setBackupRetention(count)
                                    showBackupRetentionDialog = false
                                }
                                .padding(vertical = 12.dp, horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = uiState.backupRetention == count,
                                onClick = {
                                    viewModel.setBackupRetention(count)
                                    showBackupRetentionDialog = false
                                }
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(stringResource(R.string.backup_retention_label, count))
                        }
                    }
                }
            },
            confirmButton = {}
        )
    }

    // Journal folder picker (v1.10.0): root on top, then every folder note.
    if (uiState.journalPickerOpen) {
        AlertDialog(
            onDismissRequest = viewModel::closeJournalPicker,
            title = { Text(stringResource(R.string.journal_folder_label)) },
            text = {
                Column {
                    ListItem(
                        headlineContent = { Text(stringResource(R.string.journal_folder_root)) },
                        leadingContent = { Icon(Icons.Default.Home, contentDescription = null) },
                        modifier = Modifier.clickable { viewModel.setJournalFolder(null) }
                    )
                    if (uiState.folderCandidates.isEmpty()) {
                        Text(
                            stringResource(R.string.move_no_folders),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                        )
                    }
                    uiState.folderCandidates.forEach { folder ->
                        val selected = folder.id == uiState.journalFolderId
                        ListItem(
                            headlineContent = {
                                Text(
                                    folder.title.ifBlank { stringResource(R.string.editor_untitled) },
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            },
                            leadingContent = { Icon(Icons.Default.Folder, contentDescription = null) },
                            trailingContent = {
                                if (selected) {
                                    Icon(Icons.Default.Check, contentDescription = null)
                                }
                            },
                            modifier = Modifier.clickable { viewModel.setJournalFolder(folder.id) }
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = viewModel::closeJournalPicker) {
                    Text(stringResource(R.string.ok))
                }
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateApiKeyDialog(
    onCreate: (name: String, expiresInDays: Int?) -> Unit,
    onDismiss: () -> Unit
) {
    var keyName by remember { mutableStateOf("") }
    // null mirrors the API's "no expiry" default.
    var expiresInDays by remember { mutableStateOf<Int?>(null) }
    val expiryOptions = listOf(
        30 to R.string.api_key_expiry_30,
        90 to R.string.api_key_expiry_90,
        365 to R.string.api_key_expiry_365,
        null to R.string.api_key_expiry_never
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.api_key_create)) },
        text = {
            Column {
                OutlinedTextField(
                    value = keyName,
                    onValueChange = { keyName = it },
                    label = { Text(stringResource(R.string.api_key_name)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    stringResource(R.string.api_key_expiry),
                    style = MaterialTheme.typography.labelLarge
                )
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    expiryOptions.forEach { (days, labelRes) ->
                        FilterChip(
                            selected = expiresInDays == days,
                            onClick = { expiresInDays = days },
                            label = { Text(stringResource(labelRes)) }
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onCreate(keyName, expiresInDays) }) {
                Text(stringResource(R.string.api_key_create))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        }
    )
}

@Composable
private fun ChangePasswordDialog(
    isBusy: Boolean,
    onSubmit: (currentPassword: String, newPassword: String) -> Unit,
    onDismiss: () -> Unit
) {
    var currentPassword by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var confirmPassword by remember { mutableStateOf("") }

    val newPasswordValid = newPassword.length >= 8
    val passwordsMatch = newPassword == confirmPassword
    val canSubmit = !isBusy && currentPassword.isNotBlank() && newPasswordValid && passwordsMatch

    AlertDialog(
        onDismissRequest = { if (!isBusy) onDismiss() },
        title = { Text(stringResource(R.string.settings_change_password)) },
        text = {
            Column {
                OutlinedTextField(
                    value = currentPassword,
                    onValueChange = { currentPassword = it },
                    label = { Text(stringResource(R.string.settings_password_current)) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = newPassword,
                    onValueChange = { newPassword = it },
                    label = { Text(stringResource(R.string.settings_password_new)) },
                    supportingText = {
                        if (newPassword.isNotBlank() && !newPasswordValid) {
                            Text(stringResource(R.string.auth_password_too_short))
                        }
                    },
                    isError = newPassword.isNotBlank() && !newPasswordValid,
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = confirmPassword,
                    onValueChange = { confirmPassword = it },
                    label = { Text(stringResource(R.string.auth_confirm_password)) },
                    supportingText = {
                        if (confirmPassword.isNotBlank() && !passwordsMatch) {
                            Text(stringResource(R.string.auth_passwords_no_match))
                        }
                    },
                    isError = confirmPassword.isNotBlank() && !passwordsMatch,
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    stringResource(R.string.settings_password_signs_out_others),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSubmit(currentPassword, newPassword) }, enabled = canSubmit) {
                Text(stringResource(R.string.settings_change_password))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !isBusy) {
                Text(stringResource(R.string.cancel))
            }
        }
    )
}

@Composable
private fun themeDisplayName(mode: ThemeMode): String = when (mode) {
    ThemeMode.SYSTEM -> stringResource(R.string.settings_theme_system)
    ThemeMode.LIGHT -> stringResource(R.string.settings_theme_light)
    ThemeMode.DARK -> stringResource(R.string.settings_theme_dark)
    ThemeMode.OLED -> stringResource(R.string.settings_theme_oled)
    ThemeMode.E_INK -> stringResource(R.string.settings_theme_eink)
    ThemeMode.DOODLE -> stringResource(R.string.settings_theme_doodle)
}

/** Interval label; the three presets read cleaner than raw hour counts. */
@Composable
private fun backupIntervalLabel(hours: Int): String = when (hours) {
    0 -> stringResource(R.string.backup_interval_off)
    24 -> stringResource(R.string.backup_interval_daily)
    168 -> stringResource(R.string.backup_interval_weekly)
    720 -> stringResource(R.string.backup_interval_monthly)
    else -> stringResource(R.string.backup_interval_hours, hours)
}

/** Formats an ISO timestamp as a short local date; falls back to the raw value. */
private fun formatDate(isoDate: String?): String {
    if (isoDate.isNullOrBlank()) return "-"
    return try {
        val formatter = DateTimeFormatter.ofPattern("d.M.yyyy").withLocale(Locale.getDefault())
        Instant.parse(isoDate).atZone(ZoneId.systemDefault()).format(formatter)
    } catch (_: Exception) {
        isoDate
    }
}

/** Localized label for one queued operation type. */
@Composable
private fun queueTypeLabel(operationType: String): String = when (operationType) {
    OperationType.CREATE -> stringResource(R.string.settings_queue_type_create)
    OperationType.UPDATE -> stringResource(R.string.settings_queue_type_update)
    OperationType.DELETE -> stringResource(R.string.settings_queue_type_delete)
    OperationType.TOGGLE_PIN -> stringResource(R.string.settings_queue_type_pin)
    OperationType.TOGGLE_ARCHIVE -> stringResource(R.string.settings_queue_type_archive)
    OperationType.REORDER -> stringResource(R.string.settings_queue_type_reorder)
    else -> operationType
}

/** Queued-at time as a short local timestamp. */
private fun formatQueueTime(epochMillis: Long): String = try {
    DateTimeFormatter.ofPattern("d.M.yyyy HH:mm").withLocale(Locale.getDefault())
        .format(Instant.ofEpochMilli(epochMillis).atZone(ZoneId.systemDefault()))
} catch (_: Exception) {
    "-"
}
