package com.keeplocal.android.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass
import com.squareup.moshi.Moshi
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

private val Context.draftDataStore: DataStore<Preferences> by preferencesDataStore(name = "note_draft")

/**
 * One editor draft at a time (v1.6.0 Nr. 9): the debounced editor state is
 * persisted here so a process death mid-edit (OS kills the app under memory
 * pressure, battery runs out) doesn't silently eat half-written content.
 * The draft travels as a single JSON string in its own Preferences DataStore
 * — corrupt or unreadable entries read back as "no draft".
 */
@JsonClass(generateAdapter = true)
data class NoteDraft(
    /** Note being edited; null while the editor is on a brand-new note. */
    @Json(name = "noteId") val noteId: String? = null,
    @Json(name = "title") val title: String = "",
    @Json(name = "content") val content: String = "",
    @Json(name = "color") val colorHex: String = "#ffffff",
    @Json(name = "isTodoList") val isTodoList: Boolean = false,
    @Json(name = "todoItems") val todoItems: List<DraftTodoItem> = emptyList(),
    @Json(name = "tags") val tags: List<String> = emptyList(),
    @Json(name = "savedAt") val savedAt: Long = 0L
) {
    companion object {
        /** A draft nobody touched for a week is a leftover, not a lifeline. */
        const val MAX_AGE_MS: Long = 7L * 24 * 60 * 60 * 1000

        /** Pure freshness check (unit-tested): false for null and stale drafts. */
        fun isFresh(draft: NoteDraft?, now: Long): Boolean =
            draft != null && now - draft.savedAt in 0 until MAX_AGE_MS
    }
}

@JsonClass(generateAdapter = true)
data class DraftTodoItem(
    @Json(name = "text") val text: String = "",
    @Json(name = "isCompleted") val isCompleted: Boolean = false
)

@Singleton
class NoteDraftStore @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val dataStore = context.draftDataStore
    private val adapter = Moshi.Builder().build().adapter(NoteDraft::class.java)

    /** Best-effort persist; a DataStore hiccup must never crash the editor. */
    suspend fun save(draft: NoteDraft) {
        runCatching {
            dataStore.edit { prefs -> prefs[KEY_DRAFT] = adapter.toJson(draft) }
        }
    }

    /** The stored draft, or null when absent/corrupt. */
    suspend fun load(): NoteDraft? = runCatching {
        dataStore.data.first()[KEY_DRAFT]?.let { adapter.fromJson(it) }
    }.getOrNull()

    /** Called after a successful save — the draft has become the note. */
    suspend fun clear() {
        runCatching { dataStore.edit { it.remove(KEY_DRAFT) } }
    }

    private companion object {
        val KEY_DRAFT = stringPreferencesKey("draft_json")
    }
}
