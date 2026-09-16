package com.keeplocal.android.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
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
    }
}
