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
    @Json(name = "transcriptionLanguage") val transcriptionLanguage: String? = null
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
    @Json(name = "aiFeatures") val aiFeatures: UpdateAiFeaturesDto? = null
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
    @Json(name = "position") val position: Int = 0,
    @Json(name = "createdAt") val createdAt: String? = null,
    @Json(name = "updatedAt") val updatedAt: String? = null,
    // Set while the note sits in the 30-day trash; null on live notes.
    @Json(name = "deletedAt") val deletedAt: String? = null,
    // Reminder trigger time (ISO 8601); null = no reminder.
    @Json(name = "remindAt") val remindAt: String? = null
) {
    fun resolvedId(): String = id.ifBlank { mongoId }
}

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

@JsonClass(generateAdapter = true)
data class TodoItemDto(
    @Json(name = "_id") val mongoId: String = "",
    @Json(name = "id") val id: String = "",
    @Json(name = "text") val text: String = "",
    @Json(name = "isCompleted") val isCompleted: Boolean = false,
    @Json(name = "position") val position: Int = 0
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
    @Json(name = "remindAt") val remindAt: String? = null
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
    @Json(name = "position") val position: Int? = null,
    // Optimistic locking: the updatedAt of the version the edit started from.
    // Server answers 409 with the current note when it was changed meanwhile.
    @Json(name = "baseUpdatedAt") val baseUpdatedAt: String? = null,
    // Reminder: the app always sends the full note state, so null here means
    // "delete the reminder". Moshi omits plain nullable fields, hence the
    // NullableString wrapper which writes an explicit JSON null.
    @Json(name = "remindAt") val remindAt: NullableString? = null
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
    @Json(name = "createdAt") val createdAt: String? = null
) {
    fun resolvedId(): String = id.ifBlank { mongoId }
}

@JsonClass(generateAdapter = true)
data class ApiKeysResponseDto(
    @Json(name = "data") val data: List<ApiKeyDto>? = null
)

@JsonClass(generateAdapter = true)
data class CreateApiKeyRequestDto(
    @Json(name = "name") val name: String,
    @Json(name = "expiresInDays") val expiresInDays: Int? = null
)
