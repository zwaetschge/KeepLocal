package com.keeplocal.android.ui.settings

import android.app.LocaleManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.LocaleList
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keeplocal.android.R
import com.keeplocal.android.data.api.dto.ApiKeyDto
import com.keeplocal.android.data.backup.BackupScheduler
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.TokenManager
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.data.local.entity.OperationType
import com.keeplocal.android.data.repository.ApiKeyRepository
import com.keeplocal.android.data.sync.BackgroundSync
import com.keeplocal.android.domain.repository.AuthRepository
import com.keeplocal.android.domain.usecase.auth.ChangePasswordUseCase
import com.keeplocal.android.domain.usecase.notes.ExportNotesUseCase
import com.keeplocal.android.domain.usecase.notes.ImportNotesUseCase
import com.keeplocal.android.ui.notes.NoteViewMode
import com.keeplocal.android.ui.theme.ThemeMode
import com.keeplocal.android.util.FileLogger
import com.keeplocal.android.util.NoteImportParser
import com.keeplocal.android.util.Result
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException
import javax.inject.Inject

/** One row of the offline sync queue view (v1.6.0 Nr. 6). */
data class PendingOpItem(
    val id: Long,
    val operationType: String,
    /** Note title for display; falls back to the raw id (offline/reorder). */
    val noteTitle: String,
    val createdAt: Long
)

data class SettingsUiState(
    val serverUrl: String = "",
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val noteViewMode: NoteViewMode = NoteViewMode.GRID,
    val language: String = "en",
    val rememberCredentials: Boolean = false,
    val autheliaEnabled: Boolean = false,
    val biometricLock: Boolean = false,
    val backgroundSync: Boolean = true,
    val isConnected: Boolean = false,
    /** Account-wide dictation switch; hides the editor mic when off. */
    val voiceTranscription: Boolean = true,

    /** Material You wallpaper tint (v1.7.0 design round), light/dark only. */
    val materialYou: Boolean = false,
    /** Rows of the offline sync-queue dialog; loaded on demand. */
    val pendingOps: List<PendingOpItem> = emptyList(),
    val isLoadingPendingOps: Boolean = false,
    /** Export/render in flight (SAF write happens after this). */
    val isExporting: Boolean = false,
    val apiKeys: List<ApiKeyDto> = emptyList(),
    val isLoadingApiKeys: Boolean = false,
    /** Plaintext key of a just-created API key; shown exactly once. */
    val newlyCreatedApiKey: String? = null,
    /** Change-password request in flight (dialog keeps its button disabled). */
    val isChangingPassword: Boolean = false,

    // v1.8.0: import + automatic backup.
    /** JSON import in flight (SAF read + create loop). */
    val isImporting: Boolean = false,
    /** Backup interval in hours; 0 = off. */
    val backupIntervalHours: Int = 0,
    /** SAF tree uri of the backup folder; blank = none chosen yet. */
    val backupTreeUri: String = "",
    /** How many backup files to keep. */
    val backupRetention: Int = 7,
    /** Wall-clock of the last written backup; 0 = never. */
    val lastBackupAt: Long = 0L,
    val message: String? = null
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val settingsDataStore: SettingsDataStore,
    private val authRepository: AuthRepository,
    private val tokenManager: TokenManager,
    private val noteDao: NoteDao,
    private val pendingOperationDao: PendingOperationDao,
    private val apiKeyRepository: ApiKeyRepository,
    private val changePasswordUseCase: ChangePasswordUseCase,
    private val exportNotesUseCase: ExportNotesUseCase,
    private val importNotesUseCase: ImportNotesUseCase,
    private val fileLogger: FileLogger
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState = _uiState.asStateFlow()

    private val _logoutEvent = MutableSharedFlow<Unit>()
    val logoutEvent = _logoutEvent.asSharedFlow()

    /** Diagnostic log as text, emitted for the screen's ACTION_SEND sheet. */
    private val _shareLogEvent = MutableSharedFlow<String>()
    val shareLogEvent = _shareLogEvent.asSharedFlow()

    init {
        loadSettings()
        // Backup state as flows: lastBackupAt moves while the screen is open
        // when a "back up now" worker finishes — one-shot reads would miss it.
        viewModelScope.launch {
            settingsDataStore.backupIntervalHours.collect { hours ->
                _uiState.update { it.copy(backupIntervalHours = hours) }
            }
        }
        viewModelScope.launch {
            settingsDataStore.backupTreeUri.collect { uri ->
                _uiState.update { it.copy(backupTreeUri = uri) }
            }
        }
        viewModelScope.launch {
            settingsDataStore.backupRetention.collect { count ->
                _uiState.update { it.copy(backupRetention = count) }
            }
        }
        viewModelScope.launch {
            settingsDataStore.lastBackupAt.collect { at ->
                _uiState.update { it.copy(lastBackupAt = at) }
            }
        }
    }

    private fun loadSettings() {
        viewModelScope.launch {
            val url = settingsDataStore.serverUrl.first()
            val theme = settingsDataStore.themeMode.first()
            val lang = settingsDataStore.language.first()
            val remember = settingsDataStore.rememberCredentials.first()
            val authelia = settingsDataStore.autheliaEnabled.first()
            val biometric = settingsDataStore.biometricLock.first()
            val sync = settingsDataStore.backgroundSync.first()
            val viewMode = settingsDataStore.noteViewMode.first()
            val voice = settingsDataStore.voiceTranscription.first()
            val materialYou = settingsDataStore.materialYou.first()

            _uiState.update {
                it.copy(
                    serverUrl = url,
                    themeMode = ThemeMode.fromKey(theme),
                    noteViewMode = NoteViewMode.fromKey(viewMode),
                    language = lang,
                    rememberCredentials = remember,
                    autheliaEnabled = authelia,
                    biometricLock = biometric,
                    backgroundSync = sync,
                    voiceTranscription = voice,
                    materialYou = materialYou
                )
            }

            // Check connection
            if (url.isNotBlank()) {
                val result = authRepository.checkServerConnection(url)
                _uiState.update { it.copy(isConnected = result.isSuccess && result.getOrNull() == true) }
            }
        }
    }

    fun updateServerUrl(url: String) {
        _uiState.update { it.copy(serverUrl = url) }
        viewModelScope.launch { settingsDataStore.setServerUrl(url) }
    }

    fun updateThemeMode(mode: ThemeMode) {
        _uiState.update { it.copy(themeMode = mode) }
        viewModelScope.launch { settingsDataStore.setThemeMode(mode.key) }
        // Account-wide preferences (Top-30 Nr. 17): "system" is a local-only
        // choice; the explicit themes travel with the account.
        val serverTheme = when (mode) {
            ThemeMode.SYSTEM -> null
            ThemeMode.E_INK -> "eink"
            else -> mode.key
        }
        viewModelScope.launch {
            authRepository.pushPreferences(theme = serverTheme)
                .takeIf { it.isError }
                ?.let { fileLogger.error("Settings", "theme push failed: ${(it as Result.Error).message}") }
        }
    }

    fun updateNoteViewMode(mode: NoteViewMode) {
        _uiState.update { it.copy(noteViewMode = mode) }
        viewModelScope.launch { settingsDataStore.setNoteViewMode(mode.key) }
    }

    fun updateLanguage(language: String) {
        _uiState.update { it.copy(language = language) }
        viewModelScope.launch { settingsDataStore.setLanguage(language) }
        applyAppLocale(language)
        // The UI language follows the account (Top-30 Nr. 17) — the WebUI
        // picks it up on the next login.
        viewModelScope.launch {
            authRepository.pushPreferences(language = language)
                .takeIf { it.isError }
                ?.let { fileLogger.error("Settings", "language push failed: ${(it as Result.Error).message}") }
        }
    }

    /**
     * Applies the picked language immediately, the way the WebUI language
     * selector does. Per-app locales are persisted by the system (API 33+,
     * which matches minSdk), so nothing has to be re-applied at startup.
     */
    private fun applyAppLocale(languageTag: String) {
        context.getSystemService(LocaleManager::class.java)?.applicationLocales =
            LocaleList.forLanguageTags(languageTag)
    }

    fun toggleRememberCredentials() {
        val newValue = !_uiState.value.rememberCredentials
        _uiState.update { it.copy(rememberCredentials = newValue) }
        viewModelScope.launch {
            settingsDataStore.setRememberCredentials(newValue)
            if (!newValue) {
                tokenManager.clearCredentials()
            }
        }
    }

    fun toggleBiometricLock() {
        val newValue = !_uiState.value.biometricLock
        _uiState.update { it.copy(biometricLock = newValue) }
        viewModelScope.launch { settingsDataStore.setBiometricLock(newValue) }
    }

    /**
     * Periodic background sync (WorkManager, every ~15 min on network).
     * Turning it off cancels the queued work immediately; turning it on
     * schedules it for the next window.
     */
    fun toggleBackgroundSync() {
        val newValue = !_uiState.value.backgroundSync
        _uiState.update { it.copy(backgroundSync = newValue) }
        viewModelScope.launch {
            settingsDataStore.setBackgroundSync(newValue)
            runCatching {
                if (newValue) BackgroundSync.schedule(context) else BackgroundSync.cancel(context)
            }.onFailure { fileLogger.error("Settings", "background sync toggle failed", it) }
        }
    }

    /**
     * Account-wide dictation switch (v1.6.0 Nr. 3): stored locally first
     * (the editor reacts instantly), then pushed via PUT /api/auth/preferences
     * so every device of the account hides the mic. Push failures are logged,
     * not surfaced — the next login pull re-syncs the value anyway.
     */
    fun toggleVoiceTranscription() {
        val newValue = !_uiState.value.voiceTranscription
        _uiState.update { it.copy(voiceTranscription = newValue) }
        viewModelScope.launch {
            settingsDataStore.setVoiceTranscription(newValue)
            authRepository.pushPreferences(voiceTranscription = newValue)
                .takeIf { it.isError }
                ?.let { fileLogger.error("Settings", "voiceTranscription push failed: ${(it as Result.Error).message}") }
        }
    }

    /**
     * Material You tint (v1.7.0 design round): local-only — wallpaper colors
     * are a device preference, not an account one. Applies to light/dark
     * mode; e-ink/doodle keep their fixed schemes, OLED its black surfaces.
     */
    fun toggleMaterialYou() {
        val newValue = !_uiState.value.materialYou
        _uiState.update { it.copy(materialYou = newValue) }
        viewModelScope.launch { settingsDataStore.setMaterialYou(newValue) }
    }

    // --- Offline sync queue (v1.6.0 Nr. 6) ---

    /** Lists every queued offline operation with its note title. */
    fun loadPendingOps() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingPendingOps = true) }
            val items = try {
                pendingOperationDao.getAllOperations().map { op ->
                    val title = when {
                        op.noteId == OperationType.REORDER_SENTINEL_NOTE_ID -> null
                        else -> runCatching { noteDao.getNoteById(op.noteId)?.title }.getOrNull()
                    }
                    PendingOpItem(
                        id = op.id,
                        operationType = op.operationType,
                        noteTitle = title?.ifBlank { op.noteId } ?: op.noteId,
                        createdAt = op.createdAt
                    )
                }
            } catch (e: Exception) {
                fileLogger.error("Settings", "loadPendingOps failed", e)
                emptyList()
            }
            _uiState.update { it.copy(pendingOps = items, isLoadingPendingOps = false) }
        }
    }

    /** Discards one queued operation without touching the cached note. */
    fun discardPendingOp(id: Long) {
        viewModelScope.launch {
            try {
                pendingOperationDao.deleteById(id)
            } catch (e: Exception) {
                fileLogger.error("Settings", "discardPendingOp failed", e)
            }
            loadPendingOps()
        }
    }

    // --- Import & automatic backup (v1.8.0 Nr. 1 + 7) ---

    /**
     * Reads a picked JSON export and creates every note in it as a new copy.
     * Nothing is merged onto existing notes; offline the creates queue like
     * any other edit.
     */
    fun importFromUri(uri: Uri) {
        viewModelScope.launch {
            _uiState.update { it.copy(isImporting = true) }
            val text = withContext(Dispatchers.IO) {
                runCatching {
                    context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                }.getOrNull()
            }
            if (text == null) {
                _uiState.update {
                    it.copy(isImporting = false, message = context.getString(R.string.import_read_failed))
                }
                return@launch
            }
            when (val parsed = NoteImportParser.parse(text)) {
                is NoteImportParser.Result.Invalid -> _uiState.update {
                    it.copy(isImporting = false, message = context.getString(R.string.import_invalid_file))
                }
                is NoteImportParser.Result.Success -> {
                    fileLogger.log("Settings", "importing ${parsed.notes.size} notes")
                    when (val result = importNotesUseCase(parsed.notes)) {
                        is Result.Success -> _uiState.update {
                            it.copy(
                                isImporting = false,
                                message = context.getString(R.string.import_success, result.data)
                            )
                        }
                        is Result.Error -> _uiState.update {
                            it.copy(
                                isImporting = false,
                                message = context.getString(R.string.import_failed, result.message)
                            )
                        }
                    }
                }
            }
        }
    }

    /** Interval hours; 0 cancels the periodic backup. */
    fun setBackupInterval(hours: Int) {
        _uiState.update { it.copy(backupIntervalHours = hours) }
        viewModelScope.launch {
            settingsDataStore.setBackupIntervalHours(hours)
            runCatching { BackupScheduler.schedule(context, hours) }
                .onFailure { fileLogger.error("Settings", "backup schedule failed", it) }
        }
    }

    /**
     * Remembers the picked SAF folder. The persistable grant outlives reboots,
     * which is what makes unattended background backups legal.
     */
    fun setBackupFolder(uri: Uri) {
        runCatching {
            context.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            )
        }.onFailure { fileLogger.error("Settings", "persistable uri grant failed", it) }
        _uiState.update { it.copy(backupTreeUri = uri.toString()) }
        viewModelScope.launch { settingsDataStore.setBackupTreeUri(uri.toString()) }
    }

    fun setBackupRetention(count: Int) {
        _uiState.update { it.copy(backupRetention = count) }
        viewModelScope.launch { settingsDataStore.setBackupRetention(count) }
    }

    /** One-shot backup through WorkManager; result lands via lastBackupAt. */
    fun backupNow() {
        runCatching { BackupScheduler.runNow(context) }
            .onFailure { fileLogger.error("Settings", "backup enqueue failed", it) }
        _uiState.update { it.copy(message = context.getString(R.string.backup_started)) }
    }

    // --- Export (v1.6.0 Nr. 7) & diagnostics (Nr. 8) ---

    /**
     * Renders the export and writes it into the SAF document the user
     * picked. Runs on IO; message confirms the count/bytes on success.
     */
    fun writeExport(uri: Uri, format: ExportNotesUseCase.Format) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExporting = true) }
            val result = exportNotesUseCase(format)
            when (result) {
                is Result.Success -> {
                    val written = withContext(Dispatchers.IO) {
                        runCatching {
                            context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use { writer ->
                                writer.write(result.data)
                            } ?: throw IOException("Stream closed")
                            result.data.length
                        }
                    }
                    _uiState.update { it.copy(isExporting = false) }
                    if (written.isSuccess) {
                        _uiState.update {
                            it.copy(message = context.getString(R.string.settings_export_written, written.getOrNull() ?: 0))
                        }
                    } else {
                        fileLogger.error("Settings", "export write failed", written.exceptionOrNull())
                        _uiState.update {
                            it.copy(message = context.getString(R.string.settings_export_failed))
                        }
                    }
                }
                is Result.Error -> {
                    fileLogger.error("Settings", "export failed: ${result.message}")
                    _uiState.update {
                        it.copy(isExporting = false, message = context.getString(R.string.settings_export_failed))
                    }
                }
            }
        }
    }

    /** Emits the redacted diagnostic log for the screen's share sheet. */
    fun shareLog() {
        viewModelScope.launch {
            val content = withContext(Dispatchers.IO) { runCatching { fileLogger.getLogContent() }.getOrNull() }
            if (content.isNullOrBlank()) {
                _uiState.update { it.copy(message = context.getString(R.string.settings_log_empty)) }
            } else {
                // Binder transactions cap extras at ~1 MB; keep the tail,
                // which is where the current problem lives.
                _shareLogEvent.emit(
                    if (content.length > MAX_LOG_SHARE_CHARS) content.takeLast(MAX_LOG_SHARE_CHARS) else content
                )
            }
        }
    }

    /**
     * Changes the account password. The server bumps the session version,
     * which invalidates OTHER sessions — this one keeps working.
     */
    fun changePassword(currentPassword: String, newPassword: String) {
        if (currentPassword.isBlank() || newPassword.length < 8) {
            _uiState.update { it.copy(message = context.getString(R.string.auth_password_too_short)) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isChangingPassword = true) }
            when (val result = changePasswordUseCase(currentPassword, newPassword)) {
                is Result.Success -> _uiState.update {
                    it.copy(
                        isChangingPassword = false,
                        message = context.getString(R.string.settings_password_changed)
                    )
                }
                is Result.Error -> {
                    fileLogger.error("Settings", "change password failed: ${result.message}")
                    _uiState.update {
                        it.copy(
                            isChangingPassword = false,
                            message = context.getString(R.string.settings_password_change_failed, result.message)
                        )
                    }
                }
            }
        }
    }

    /**
     * Clears the local note cache and the debug log. Notes still referenced
     * by an open pending operation — i.e. not yet synced — are kept, so
     * "clear cache" can never eat offline work.
     */
    fun clearCache() {
        viewModelScope.launch {
            try {
                val keptNotes = noteDao.countPendingNoteIds()
                noteDao.deleteSyncedNotes()
                fileLogger.clear()
                _uiState.update {
                    it.copy(message = context.getString(R.string.settings_cache_cleared_kept, keptNotes))
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(message = context.getString(R.string.error_generic)) }
            }
        }
    }

    // --- API keys ---

    fun loadApiKeys() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingApiKeys = true) }
            when (val result = apiKeyRepository.getApiKeys()) {
                is Result.Success -> _uiState.update { it.copy(isLoadingApiKeys = false, apiKeys = result.data) }
                is Result.Error -> _uiState.update { it.copy(isLoadingApiKeys = false, message = result.message) }
            }
        }
    }

    fun createApiKey(name: String, expiresInDays: Int?) {
        val trimmedName = name.trim()
        if (trimmedName.isBlank()) {
            _uiState.update { it.copy(message = context.getString(R.string.api_key_name_required)) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingApiKeys = true) }
            when (val result = apiKeyRepository.createApiKey(trimmedName, expiresInDays)) {
                is Result.Success -> {
                    // The plaintext key exists only in this response; surface
                    // it once, then it is gone forever.
                    _uiState.update { it.copy(isLoadingApiKeys = false, newlyCreatedApiKey = result.data.key) }
                    loadApiKeys()
                }
                is Result.Error -> _uiState.update { it.copy(isLoadingApiKeys = false, message = result.message) }
            }
        }
    }

    fun revokeApiKey(id: String) {
        viewModelScope.launch {
            when (val result = apiKeyRepository.revokeApiKey(id)) {
                is Result.Success -> {
                    _uiState.update { it.copy(message = context.getString(R.string.api_key_revoked)) }
                    loadApiKeys()
                }
                is Result.Error -> _uiState.update { it.copy(isLoadingApiKeys = false, message = result.message) }
            }
        }
    }

    fun dismissNewApiKey() {
        _uiState.update { it.copy(newlyCreatedApiKey = null) }
    }

    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
            tokenManager.clearAll()
            _logoutEvent.emit(Unit)
        }
    }

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }

    private companion object {
        /** Keeps the shared log comfortably below the binder transaction cap. */
        const val MAX_LOG_SHARE_CHARS = 400_000
    }
}
