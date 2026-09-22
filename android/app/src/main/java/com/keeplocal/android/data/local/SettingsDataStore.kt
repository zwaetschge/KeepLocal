package com.keeplocal.android.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.keeplocal.android.domain.model.SavedSearch
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

@Singleton
class SettingsDataStore @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val dataStore = context.dataStore

    val serverUrl: Flow<String> = dataStore.data.map { it[KEY_SERVER_URL] ?: "" }
    val themeMode: Flow<String> = dataStore.data.map { it[KEY_THEME] ?: "system" }
    val language: Flow<String> = dataStore.data.map { it[KEY_LANGUAGE] ?: "en" }

    /**
     * Whisper language hint, synced with the account (server key
     * `preferences.transcriptionLanguage`). "auto" (or empty before the first
     * login) means "let the AI detect it"; falls back to the UI language.
     */
    val transcriptionLanguage: Flow<String> = dataStore.data.map { it[KEY_TRANSCRIPTION_LANGUAGE] ?: "" }
    val rememberCredentials: Flow<Boolean> = dataStore.data.map { it[KEY_REMEMBER_CREDENTIALS] ?: false }
    val autheliaEnabled: Flow<Boolean> = dataStore.data.map { it[KEY_AUTHELIA_ENABLED] ?: false }
    val biometricLock: Flow<Boolean> = dataStore.data.map { it[KEY_BIOMETRIC_LOCK] ?: false }

    /** "grid" (staggered cards, WebUI default) or "list" (dense one-per-row rows). */
    val noteViewMode: Flow<String> = dataStore.data.map { it[KEY_NOTE_VIEW_MODE] ?: "grid" }

    /** Periodic WorkManager sync (every 15 min, only with network). */
    val backgroundSync: Flow<Boolean> = dataStore.data.map { it[KEY_BACKGROUND_SYNC] ?: true }

    /**
     * Account-wide dictation toggle (server key
     * `preferences.aiFeatures.voiceTranscription`). Default on; when off the
     * editor hides the mic button entirely — the account simply has no AI
     * budget for it.
     */
    val voiceTranscription: Flow<Boolean> = dataStore.data.map { it[KEY_VOICE_TRANSCRIPTION] ?: true }

    /**
     * Material You wallpaper colors (v1.7.0 design round). Off by default so
     * the KeepLocal paper palette stays the identity; re-tints light/dark
     * mode. E-ink and doodle keep their fixed schemes, OLED keeps its black
     * surfaces.
     */
    val materialYou: Flow<Boolean> = dataStore.data.map { it[KEY_MATERIAL_YOU] ?: false }

    /**
     * Recent search terms (v1.7.0 design round), most recent first, newest
     * duplicates moved to the front, capped at 8. Stored as one newline-joined
     * string because preferences have no ordered set.
     */
    val recentSearches: Flow<List<String>> = dataStore.data.map { prefs ->
        prefs[KEY_RECENT_SEARCHES]?.split('\n')?.filter { it.isNotBlank() } ?: emptyList()
    }

    // --- v1.8.0: sort order, sync status, automatic backup ---

    /** List sort order (SortMode.storageKey); MANUAL is the historical default. */
    val sortMode: Flow<String> = dataStore.data.map { it[KEY_SORT_MODE] ?: "manual" }

    /** Wall-clock millis of the last successful server sync (0 = never). */
    val lastSyncAt: Flow<Long> = dataStore.data.map { it[KEY_LAST_SYNC_AT] ?: 0L }

    // v1.14.0 Nr. 6: Pull-Hälfte des Hintergrund-Syncs. Die Signatur der
    // letzten Meta-Sonde ("active/archived/trash/maxUpdatedAt") entscheidet,
    // ob sich serverseitig überhaupt etwas tat; `since` ist der ISO-Zeitpunkt
    // des letzten erfolgreichen Delta-Pulls.
    /** Meta-Signatur des letzten erfolgreichen Pulls ("" = noch nie gezogen). */
    val syncSignature: Flow<String> = dataStore.data.map { it[KEY_SYNC_SIGNATURE] ?: "" }

    /** ISO-8601 des letzten Delta-Pulls ("" = noch kein Delta, nächster Pull komplett). */
    val syncSince: Flow<String> = dataStore.data.map { it[KEY_SYNC_SINCE] ?: "" }

    /** Automatic backup interval in hours; 0 = off. */
    val backupIntervalHours: Flow<Int> = dataStore.data.map { it[KEY_BACKUP_INTERVAL_HOURS] ?: 0 }

    /** SAF tree URI of the user-picked backup folder (DocumentProvider). */
    val backupTreeUri: Flow<String> = dataStore.data.map { it[KEY_BACKUP_TREE_URI] ?: "" }

    /** How many backup files to keep in the folder; older ones are deleted. */
    val backupRetention: Flow<Int> = dataStore.data.map { it[KEY_BACKUP_RETENTION] ?: 7 }

    /** Wall-clock millis of the last successful automatic backup (0 = never). */
    val lastBackupAt: Flow<Long> = dataStore.data.map { it[KEY_LAST_BACKUP_AT] ?: 0L }

    // --- v1.10.0: tag colors, saved searches, journal folder ---

    /**
     * Tag colors (tag name -> palette hex), synced with the account (server
     * key `preferences.tagColors`). Stored as one JSON object string because
     * preferences have no map type.
     */
    val tagColors: Flow<Map<String, String>> = dataStore.data.map { prefs ->
        prefs[KEY_TAG_COLORS]?.let { raw ->
            runCatching {
                val json = JSONObject(raw)
                buildMap { json.keys().forEach { key -> put(key, json.optString(key)) } }
            }.getOrNull()
        } ?: emptyMap()
    }

    /**
     * Saved searches / smart folders, synced with the account (server key
     * `preferences.savedSearches`). One JSON array string in the server's
     * subdocument shape.
     */
    val savedSearches: Flow<List<SavedSearch>> = dataStore.data.map { prefs ->
        prefs[KEY_SAVED_SEARCHES]?.let { raw ->
            runCatching {
                val array = JSONArray(raw)
                List(array.length()) { i ->
                    val entry = array.optJSONObject(i) ?: return@List null
                    SavedSearch(
                        id = entry.optString("id"),
                        name = entry.optString("name"),
                        query = entry.optString("query"),
                        typeFilter = entry.optString("typeFilter").ifEmpty { "all" },
                        tag = entry.optString("tag")
                    )
                }.filterNotNull()
            }.getOrNull()
        } ?: emptyList()
    }

    /**
     * Root note of the journal ("Heute"-Notizen land inside it); null = the
     * root level of the tree. Synced with the account.
     */
    val journalFolderId: Flow<String?> = dataStore.data.map { prefs ->
        prefs[KEY_JOURNAL_FOLDER_ID]?.takeIf { it.isNotBlank() }
    }

    suspend fun setServerUrl(url: String) {
        dataStore.edit { it[KEY_SERVER_URL] = url }
    }

    suspend fun setThemeMode(mode: String) {
        dataStore.edit { it[KEY_THEME] = mode }
    }

    suspend fun setLanguage(language: String) {
        dataStore.edit { it[KEY_LANGUAGE] = language }
    }

    suspend fun setTranscriptionLanguage(language: String) {
        dataStore.edit { it[KEY_TRANSCRIPTION_LANGUAGE] = language }
    }

    suspend fun setRememberCredentials(remember: Boolean) {
        dataStore.edit { it[KEY_REMEMBER_CREDENTIALS] = remember }
    }

    suspend fun setAutheliaEnabled(enabled: Boolean) {
        dataStore.edit { it[KEY_AUTHELIA_ENABLED] = enabled }
    }

    suspend fun setBiometricLock(enabled: Boolean) {
        dataStore.edit { it[KEY_BIOMETRIC_LOCK] = enabled }
    }

    suspend fun setNoteViewMode(mode: String) {
        dataStore.edit { it[KEY_NOTE_VIEW_MODE] = mode }
    }

    suspend fun setBackgroundSync(enabled: Boolean) {
        dataStore.edit { it[KEY_BACKGROUND_SYNC] = enabled }
    }

    suspend fun setVoiceTranscription(enabled: Boolean) {
        dataStore.edit { it[KEY_VOICE_TRANSCRIPTION] = enabled }
    }

    suspend fun setMaterialYou(enabled: Boolean) {
        dataStore.edit { it[KEY_MATERIAL_YOU] = enabled }
    }

    /** Adds [query] as the most recent search, deduplicated, capped at 8. */
    suspend fun addRecentSearch(query: String) {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return
        dataStore.edit { prefs ->
            val previous = prefs[KEY_RECENT_SEARCHES]
                ?.split('\n')
                ?.filter { it.isNotBlank() }
                .orEmpty()
            val next = (listOf(trimmed) + previous.filter { !it.equals(trimmed, ignoreCase = true) })
                .take(8)
            prefs[KEY_RECENT_SEARCHES] = next.joinToString("\n")
        }
    }

    suspend fun clearRecentSearches() {
        dataStore.edit { it.remove(KEY_RECENT_SEARCHES) }
    }

    suspend fun setSortMode(storageKey: String) {
        dataStore.edit { it[KEY_SORT_MODE] = storageKey }
    }

    suspend fun setLastSyncAt(epochMs: Long) {
        dataStore.edit { it[KEY_LAST_SYNC_AT] = epochMs }
    }

    suspend fun setSyncSignature(signature: String) {
        dataStore.edit { it[KEY_SYNC_SIGNATURE] = signature }
    }

    suspend fun setSyncSince(sinceIso: String) {
        dataStore.edit { it[KEY_SYNC_SINCE] = sinceIso }
    }

    suspend fun setBackupIntervalHours(hours: Int) {
        dataStore.edit { it[KEY_BACKUP_INTERVAL_HOURS] = hours }
    }

    suspend fun setBackupTreeUri(uri: String) {
        dataStore.edit { it[KEY_BACKUP_TREE_URI] = uri }
    }

    suspend fun setBackupRetention(count: Int) {
        dataStore.edit { it[KEY_BACKUP_RETENTION] = count }
    }

    suspend fun setLastBackupAt(epochMs: Long) {
        dataStore.edit { it[KEY_LAST_BACKUP_AT] = epochMs }
    }

    // --- v1.10.0 setters ---

    suspend fun setTagColors(colors: Map<String, String>) {
        val json = JSONObject()
        colors.forEach { (tag, hex) -> json.put(tag, hex) }
        dataStore.edit { it[KEY_TAG_COLORS] = json.toString() }
    }

    suspend fun setSavedSearches(searches: List<SavedSearch>) {
        val json = JSONArray()
        searches.forEach { search ->
            json.put(
                JSONObject()
                    .put("id", search.id)
                    .put("name", search.name)
                    .put("query", search.query)
                    .put("typeFilter", search.typeFilter)
                    .put("tag", search.tag)
            )
        }
        dataStore.edit { it[KEY_SAVED_SEARCHES] = json.toString() }
    }

    suspend fun setJournalFolderId(folderId: String?) {
        dataStore.edit {
            if (folderId.isNullOrBlank()) it.remove(KEY_JOURNAL_FOLDER_ID) else it[KEY_JOURNAL_FOLDER_ID] = folderId
        }
    }

    fun getServerUrlSync(): String? {
        return null // Use the Flow version instead
    }

    suspend fun clearAll() {
        dataStore.edit { it.clear() }
    }

    companion object {
        private val KEY_SERVER_URL = stringPreferencesKey("server_url")
        private val KEY_THEME = stringPreferencesKey("theme_mode")
        private val KEY_LANGUAGE = stringPreferencesKey("language")
        private val KEY_TRANSCRIPTION_LANGUAGE = stringPreferencesKey("transcription_language")
        private val KEY_REMEMBER_CREDENTIALS = booleanPreferencesKey("remember_credentials")
        private val KEY_AUTHELIA_ENABLED = booleanPreferencesKey("authelia_enabled")
        private val KEY_BIOMETRIC_LOCK = booleanPreferencesKey("biometric_lock")
        private val KEY_NOTE_VIEW_MODE = stringPreferencesKey("note_view_mode")
        private val KEY_BACKGROUND_SYNC = booleanPreferencesKey("background_sync")
        private val KEY_VOICE_TRANSCRIPTION = booleanPreferencesKey("voice_transcription")
        private val KEY_MATERIAL_YOU = booleanPreferencesKey("material_you")
        private val KEY_RECENT_SEARCHES = stringPreferencesKey("recent_searches")
        private val KEY_SORT_MODE = stringPreferencesKey("sort_mode")
        private val KEY_LAST_SYNC_AT = longPreferencesKey("last_sync_at")
        private val KEY_SYNC_SIGNATURE = stringPreferencesKey("sync_signature")
        private val KEY_SYNC_SINCE = stringPreferencesKey("sync_since")
        private val KEY_BACKUP_INTERVAL_HOURS = intPreferencesKey("backup_interval_hours")
        private val KEY_BACKUP_TREE_URI = stringPreferencesKey("backup_tree_uri")
        private val KEY_BACKUP_RETENTION = intPreferencesKey("backup_retention")
        private val KEY_LAST_BACKUP_AT = longPreferencesKey("last_backup_at")
        private val KEY_TAG_COLORS = stringPreferencesKey("tag_colors")
        private val KEY_SAVED_SEARCHES = stringPreferencesKey("saved_searches")
        private val KEY_JOURNAL_FOLDER_ID = stringPreferencesKey("journal_folder_id")
    }
}
