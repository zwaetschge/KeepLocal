package com.keeplocal.android.data.api.dto

import com.keeplocal.android.data.api.NullableString
import com.squareup.moshi.Json
import com.squareup.moshi.JsonClass

// The API authenticates by email, never by username (server/routes/auth.js
// validates body('email').isEmail()).
@JsonClass(generateAdapter = true)
data class LoginRequestDto(
    @Json(name = "email") val email: String,
    @Json(name = "password") val password: String
)

@JsonClass(generateAdapter = true)
data class RegisterRequestDto(
    @Json(name = "username") val username: String,
    @Json(name = "email") val email: String,
    @Json(name = "password") val password: String
)

@JsonClass(generateAdapter = true)
data class AuthResponseDto(
    @Json(name = "token") val token: String?,
    @Json(name = "user") val user: UserDto?
)

@JsonClass(generateAdapter = true)
data class UserDto(
    @Json(name = "_id") val mongoId: String = "",
    @Json(name = "id") val id: String = "",
    @Json(name = "username") val username: String,
    @Json(name = "isAdmin") val isAdmin: Boolean = false,
    @Json(name = "createdAt") val createdAt: String? = null,
    // Account-wide preferences (Top-30 Nr. 17): the server sends them with
    // the login response; theme/language follow the account, not the device.
    @Json(name = "preferences") val preferences: UserPreferencesDto? = null
) {
    fun resolvedId(): String = id.ifBlank { mongoId }
}

@JsonClass(generateAdapter = true)
data class UserPreferencesDto(
    @Json(name = "theme") val theme: String? = null,
    @Json(name = "language") val language: String? = null,
    @Json(name = "aiFeatures") val aiFeatures: AiFeaturesDto? = null,
    @Json(name = "transcriptionLanguage") val transcriptionLanguage: String? = null,
    // v1.10.0: tag colors (tag name -> hex from the note palette), saved
    // searches (smart folders) and the journal root note id — all synced
    // through the account so every device sees the same set.
    @Json(name = "tagColors") val tagColors: Map<String, String>? = null,
    @Json(name = "savedSearches") val savedSearches: List<SavedSearchDto>? = null,
    @Json(name = "journalFolderId") val journalFolderId: String? = null
)

/** One smart folder: a search pinned into the tree panel (server subdocument
 *  without the mongoose _id — the server strips it before sending). */
@JsonClass(generateAdapter = true)
data class SavedSearchDto(
    @Json(name = "id") val id: String,
    @Json(name = "name") val name: String,
    @Json(name = "query") val query: String = "",
    @Json(name = "typeFilter") val typeFilter: String = "all",
    @Json(name = "tag") val tag: String = ""
)

@JsonClass(generateAdapter = true)
data class AiFeaturesDto(
    @Json(name = "voiceTranscription") val voiceTranscription: Boolean? = null
)

/** Body for PUT /api/auth/preferences — Moshi omits null fields, and the
 *  server only applies the keys that are present. */
@JsonClass(generateAdapter = true)
data class UpdatePreferencesDto(
    @Json(name = "theme") val theme: String? = null,
    @Json(name = "language") val language: String? = null,
    @Json(name = "transcriptionLanguage") val transcriptionLanguage: String? = null,
    @Json(name = "aiFeatures") val aiFeatures: UpdateAiFeaturesDto? = null,
    // v1.10.0: null (absent) leaves each key untouched on the server, matching
    // the partial-update contract above. journalFolderId wraps NullableString:
    // an explicit JSON null is the only way to clear the journal root.
    @Json(name = "tagColors") val tagColors: Map<String, String>? = null,
    @Json(name = "savedSearches") val savedSearches: List<SavedSearchDto>? = null,
    @Json(name = "journalFolderId") val journalFolderId: NullableString? = null
)

/** AI feature switches inside the preferences body; mirrors AiFeaturesDto. */
@JsonClass(generateAdapter = true)
data class UpdateAiFeaturesDto(
    @Json(name = "voiceTranscription") val voiceTranscription: Boolean? = null
)

@JsonClass(generateAdapter = true)
data class NotesResponseDto(
    @Json(name = "notes") val notes: List<NoteDto>? = null,
    @Json(name = "data") val data: List<NoteDto>? = null,
    @Json(name = "total") val total: Int? = null,
    @Json(name = "page") val page: Int? = null,
    // Total page count the server computed (notesService.js getAllNotes) —
    // the export walks pages 1..pages for each archive state.
    @Json(name = "pages") val pages: Int? = null
) {
    fun getNotesList(): List<NoteDto> = notes ?: data ?: emptyList()
}

/** Response of DELETE /api/notes/trash — how many notes were purged. */
@JsonClass(generateAdapter = true)
data class EmptyTrashResponseDto(
    @Json(name = "message") val message: String? = null,
    @Json(name = "removed") val removed: Int? = null
)

@JsonClass(generateAdapter = true)
data class CsrfTokenDto(
    @Json(name = "csrfToken") val csrfToken: String
)

@JsonClass(generateAdapter = true)
data class NoteDto(
    @Json(name = "_id") val mongoId: String = "",
    @Json(name = "id") val id: String = "",
    @Json(name = "title") val title: String = "",
    @Json(name = "content") val content: String = "",
    @Json(name = "color") val color: String = "default",
    @Json(name = "isPinned") val isPinned: Boolean = false,
    @Json(name = "isArchived") val isArchived: Boolean = false,
    @Json(name = "isTodoList") val isTodoList: Boolean = false,
    @Json(name = "todoItems") val todoItems: List<TodoItemDto>? = null,
    @Json(name = "tags") val tags: List<String>? = null,
    @Json(name = "images") val images: List<NoteImageDto>? = null,
    @Json(name = "sharedWith") val sharedWith: List<SharedUserDto>? = null,
    @Json(name = "owner") val owner: String = "",
    // v1.16.0 wire fix: the server field is `order` (Note schema, web client,
    // v1 API). `position` was never sent by the server and never understood in
    // a PUT — manual order silently round-tripped as 0 in both directions.
    @Json(name = "order") val position: Int = 0,
    @Json(name = "createdAt") val createdAt: String? = null,
    @Json(name = "updatedAt") val updatedAt: String? = null,
    // Set while the note sits in the 30-day trash; null on live notes.
    @Json(name = "deletedAt") val deletedAt: String? = null,
    // Reminder trigger time (ISO 8601); null = no reminder.
    @Json(name = "remindAt") val remindAt: String? = null,
    // Tree (v1.10.0): parent note id; null = root level.
    @Json(name = "parentId") val parentId: String? = null,
    // Code note (v1.10.0): render content monospaced.
    @Json(name = "isCode") val isCode: Boolean = false,
    // PDF attachments (v1.14.0 Nr. 5): server-managed like images; uploads
    // and deletions go through their own endpoints, never through the note
    // update payload.
    @Json(name = "files") val files: List<NoteFileDto>? = null
) {
    fun resolvedId(): String = id.ifBlank { mongoId }
}

/** One PDF attachment of a note (POST /api/notes/{id}/files, max 25 per note,
 *  5 per request, 25 MB each — the server magic-byte-checks %PDF-). */
@JsonClass(generateAdapter = true)
data class NoteFileDto(
    @Json(name = "filename") val filename: String = "",
    @Json(name = "url") val url: String = "",
    @Json(name = "originalName") val originalName: String? = null,
    @Json(name = "mimetype") val mimetype: String? = null,
    @Json(name = "size") val size: Long? = null,
    @Json(name = "uploadedAt") val uploadedAt: String? = null
)

/** GET /api/notes/meta (v1.14.0 Nr. 6): counts + max(updatedAt) as the cheap
 *  change probe for the background sync — one aggregation instead of pulling
 *  the whole list every 15 minutes. */
@JsonClass(generateAdapter = true)
data class NotesMetaDto(
    @Json(name = "active") val active: Int = 0,
    @Json(name = "archived") val archived: Int = 0,
    @Json(name = "trash") val trash: Int = 0,
    @Json(name = "maxUpdatedAt") val maxUpdatedAt: String? = null
) {
    /** Compact comparison key; identical values mean "nothing changed". */
    fun signature(): String = "$active/$archived/$trash/${maxUpdatedAt ?: "-"}"
}

/** Body for PATCH /api/notes/tags (v1.11.0; used by Android since v1.14.0
 *  Nr. 4): one server-side updateMany instead of one update per note. The
 *  server lowercases from/to — the target is stored lowercase. */
@JsonClass(generateAdapter = true)
data class TagOperationRequestDto(
    @Json(name = "action") val action: String, // rename | merge | delete
    @Json(name = "from") val from: List<String>,
    @Json(name = "to") val to: String? = null
)

@JsonClass(generateAdapter = true)
data class TagOperationResponseDto(
    @Json(name = "action") val action: String? = null,
    @Json(name = "modified") val modified: Int = 0
)

/** Entry of GET /api/notes/tree — the light sidebar projection without
 *  content or images; the client nests the flat list itself. */
@JsonClass(generateAdapter = true)
data class NoteTreeNodeDto(
    @Json(name = "id") val id: String = "",
    @Json(name = "parentId") val parentId: String? = null,
    @Json(name = "title") val title: String = "",
    @Json(name = "order") val order: Int = 0,
    @Json(name = "isPinned") val isPinned: Boolean = false,
    @Json(name = "isCode") val isCode: Boolean = false,
    @Json(name = "isArchived") val isArchived: Boolean = false,
    @Json(name = "isTodoList") val isTodoList: Boolean = false,
    @Json(name = "remindAt") val remindAt: String? = null,
    @Json(name = "updatedAt") val updatedAt: String? = null
)

@JsonClass(generateAdapter = true)
data class NoteImageDto(
    @Json(name = "filename") val filename: String = "",
    @Json(name = "url") val url: String = "",
    @Json(name = "thumbnailUrl") val thumbnailUrl: String? = null,
    @Json(name = "originalName") val originalName: String? = null,
    @Json(name = "uploadedAt") val uploadedAt: String? = null
) {
    fun bestUrl(): String = if (!thumbnailUrl.isNullOrBlank()) thumbnailUrl else url
}

@JsonClass(generateAdapter = true)
data class TranscriptionResultDto(
    @Json(name = "message") val message: String? = null,
    @Json(name = "text") val text: String = "",
    @Json(name = "language") val language: String? = null
)

// v1.16.0 wire fix: the server todo contract is completed/order (Note schema
// + validateNoteFields), exactly what the web client sends. isCompleted/position
// passed server validation (undefined is allowed) but the strict Mongoose schema
// stripped them — check marks and item order were silently lost on every sync.
@JsonClass(generateAdapter = true)
data class TodoItemDto(
    @Json(name = "_id") val mongoId: String = "",
    @Json(name = "id") val id: String = "",
    @Json(name = "text") val text: String = "",
    @Json(name = "completed") val isCompleted: Boolean = false,
    @Json(name = "order") val position: Int = 0
) {
    fun resolvedId(): String = id.ifBlank { mongoId }
}

@JsonClass(generateAdapter = true)
data class SharedUserDto(
    @Json(name = "userId") val userId: String = "",
    @Json(name = "username") val username: String = ""
)

@JsonClass(generateAdapter = true)
data class CreateNoteDto(
    @Json(name = "title") val title: String,
    @Json(name = "content") val content: String,
    @Json(name = "color") val color: String = "default",
    @Json(name = "isPinned") val isPinned: Boolean = false,
    @Json(name = "isTodoList") val isTodoList: Boolean = false,
    @Json(name = "todoItems") val todoItems: List<TodoItemDto>? = null,
    @Json(name = "tags") val tags: List<String>? = null,
    // Reminder for the new note; null is simply omitted (nothing to clear).
    @Json(name = "remindAt") val remindAt: String? = null,
    // Tree (v1.10.0): create the note inside a folder note.
    @Json(name = "parentId") val parentId: String? = null,
    @Json(name = "isCode") val isCode: Boolean = false
)

@JsonClass(generateAdapter = true)
data class UpdateNoteDto(
    @Json(name = "title") val title: String? = null,
    @Json(name = "content") val content: String? = null,
    @Json(name = "color") val color: String? = null,
    @Json(name = "isPinned") val isPinned: Boolean? = null,
    @Json(name = "isTodoList") val isTodoList: Boolean? = null,
    @Json(name = "todoItems") val todoItems: List<TodoItemDto>? = null,
    @Json(name = "tags") val tags: List<String>? = null,
    // v1.16.0: sends the note order under its server name (see NoteDto).
    @Json(name = "order") val position: Int? = null,
    // Optimistic locking: the updatedAt of the version the edit started from.
    // Server answers 409 with the current note when it was changed meanwhile.
    @Json(name = "baseUpdatedAt") val baseUpdatedAt: String? = null,
    // Reminder: the app always sends the full note state, so null here means
    // "delete the reminder". Moshi omits plain nullable fields, hence the
    // NullableString wrapper which writes an explicit JSON null.
    @Json(name = "remindAt") val remindAt: NullableString? = null,
    // Tree (v1.10.0): same full-state semantics — an explicit JSON null moves
    // the note back to the root level, absent would leave it untouched.
    @Json(name = "parentId") val parentId: NullableString? = null,
    @Json(name = "isCode") val isCode: Boolean? = null
)

@JsonClass(generateAdapter = true)
data class ShareNoteDto(
    @Json(name = "userId") val userId: String
)

/** Body for PATCH /api/notes/reorder — full display order, max 200 per call. */
@JsonClass(generateAdapter = true)
data class ReorderNotesDto(
    @Json(name = "orderedIds") val orderedIds: List<String>
)

/** One parsed .md entry for POST /api/notes/import/markdown (v1.16.0): the
 *  server builds the tree from the paths, folders come across as
 *  `<ordner>/_index.md` + isFolderIndex — same wire format the web client
 *  sends, instead of one createNote request per file. */
@JsonClass(generateAdapter = true)
data class ImportMarkdownItemDto(
    @Json(name = "path") val path: String,
    @Json(name = "title") val title: String? = null,
    @Json(name = "content") val content: String? = null,
    @Json(name = "tags") val tags: List<String>? = null,
    @Json(name = "isFolderIndex") val isFolderIndex: Boolean? = null
)

@JsonClass(generateAdapter = true)
data class ImportMarkdownRequestDto(
    @Json(name = "items") val items: List<ImportMarkdownItemDto>
)

/** Answer of /import/markdown: how many notes/folders the server created. */
@JsonClass(generateAdapter = true)
data class ImportMarkdownResultDto(
    @Json(name = "created") val created: Int = 0,
    @Json(name = "foldersCreated") val foldersCreated: Int = 0
)

/** GET /api/auth/providers — only configured providers are offered. */
@JsonClass(generateAdapter = true)
data class OAuthProvidersResponseDto(
    @Json(name = "providers") val providers: OAuthProvidersDto? = null
)

@JsonClass(generateAdapter = true)
data class OAuthProvidersDto(
    @Json(name = "google") val google: Boolean = false,
    @Json(name = "github") val github: Boolean = false,
    @Json(name = "demo") val demo: Boolean = false
)

/** Body for POST /api/auth/change-password. */
@JsonClass(generateAdapter = true)
data class ChangePasswordDto(
    @Json(name = "currentPassword") val currentPassword: String,
    @Json(name = "newPassword") val newPassword: String
)

/** Body for POST /api/auth/reset-password — redeems an admin-issued one-time
 *  token (15 min validity, no session required). */
@JsonClass(generateAdapter = true)
data class ResetPasswordDto(
    @Json(name = "token") val token: String,
    @Json(name = "newPassword") val newPassword: String
)

/** Response of POST /api/admin/users/:id/password-reset. The token is shown
 *  once and never stored anywhere on the device. */
@JsonClass(generateAdapter = true)
data class PasswordResetTokenDto(
    @Json(name = "resetToken") val resetToken: String,
    @Json(name = "expiresAt") val expiresAt: String? = null
)

@JsonClass(generateAdapter = true)
data class FriendDto(
    @Json(name = "_id") val mongoId: String = "",
    @Json(name = "id") val id: String = "",
    @Json(name = "username") val username: String
) {
    fun resolvedId(): String = id.ifBlank { mongoId }
}

@JsonClass(generateAdapter = true)
data class FriendRequestDto(
    @Json(name = "_id") val mongoId: String = "",
    @Json(name = "id") val id: String = "",
    @Json(name = "from") val from: UserDto,
    @Json(name = "to") val to: UserDto
) {
    fun resolvedId(): String = id.ifBlank { mongoId }
}

@JsonClass(generateAdapter = true)
data class FriendRequestBody(
    @Json(name = "username") val username: String
)

@JsonClass(generateAdapter = true)
data class AdminStatsDto(
    @Json(name = "userCount") val userCount: Int = 0,
    @Json(name = "noteCount") val noteCount: Int = 0
)

@JsonClass(generateAdapter = true)
data class AdminSettingsDto(
    @Json(name = "registrationEnabled") val registrationEnabled: Boolean = false
)

// POST /api/notes/link-preview — die URL reist im JSON-Body, nicht mehr als
// Query-Parameter (lange URLs sprengten Server-Logzeilen und Proxys).
@JsonClass(generateAdapter = true)
data class LinkPreviewRequestDto(
    @Json(name = "url") val url: String
)

@JsonClass(generateAdapter = true)
data class LinkPreviewDto(
    @Json(name = "url") val url: String,
    @Json(name = "title") val title: String? = null,
    @Json(name = "description") val description: String? = null,
    @Json(name = "image") val image: String? = null
)

@JsonClass(generateAdapter = true)
data class ApiKeyDto(
    @Json(name = "_id") val mongoId: String = "",
    @Json(name = "id") val id: String = "",
    @Json(name = "name") val name: String = "",
    @Json(name = "key") val key: String? = null, // only set directly after creation
    @Json(name = "prefix") val prefix: String = "",
    @Json(name = "expiresAt") val expiresAt: String? = null,
    @Json(name = "createdAt") val createdAt: String? = null,
    // v1.14.0 Nr. 10: null = legacy key created before scopes existed — the
    // server grants those full access; ['read'] is the read-only default.
    @Json(name = "scopes") val scopes: List<String>? = null,
    @Json(name = "lastUsedAt") val lastUsedAt: String? = null
) {
    fun resolvedId(): String = id.ifBlank { mongoId }

    fun canWrite(): Boolean = scopes?.contains("write") == true
}

@JsonClass(generateAdapter = true)
data class ApiKeysResponseDto(
    @Json(name = "data") val data: List<ApiKeyDto>? = null
)

/**
 * Body of POST /api/api-keys: the server wraps the created key in
 * {success, data, message} — same convention as the list endpoint. Parsing
 * the wrapper as a bare ApiKeyDto silently produced an all-null key
 * (review v1.14.0), hiding the one-time plaintext key for good.
 */
@JsonClass(generateAdapter = true)
data class ApiKeyCreatedResponseDto(
    @Json(name = "success") val success: Boolean? = null,
    @Json(name = "data") val data: ApiKeyDto? = null,
    @Json(name = "message") val message: String? = null
)

/**
 * Body for POST /api/api-keys. The server expects expiresIn as '30d'/'90d'/
 * '365d'/'never' (v1.14.0 fix: the app used to send expiresInDays as a bare
 * number, which the server rejects with 400). Scopes: ['read'] is the
 * default; write access must be requested explicitly.
 */
@JsonClass(generateAdapter = true)
data class CreateApiKeyRequestDto(
    @Json(name = "name") val name: String,
    @Json(name = "expiresIn") val expiresIn: String = "never",
    @Json(name = "scopes") val scopes: List<String> = listOf("read")
)
