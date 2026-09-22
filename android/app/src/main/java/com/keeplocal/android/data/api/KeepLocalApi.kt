package com.keeplocal.android.data.api

import com.keeplocal.android.data.api.dto.*
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.Response
import retrofit2.http.*

interface KeepLocalApi {
    // Auth
    // There is no POST /api/auth/setup: like the WebUI, initial setup goes
    // through register — the server flags the first account as admin.
    @POST("api/auth/register")
    suspend fun register(@Body request: RegisterRequestDto): Response<AuthResponseDto>

    @POST("api/auth/login")
    suspend fun login(@Body request: LoginRequestDto): Response<AuthResponseDto>

    @POST("api/auth/logout")
    suspend fun logout(): Response<Unit>

    @GET("api/auth/me")
    suspend fun getCurrentUser(): Response<UserDto>

    @GET("api/csrf-token")
    suspend fun getCsrfToken(): Response<CsrfTokenDto>

    // Account-wide preferences (theme, language, transcription language)
    @PUT("api/auth/preferences")
    suspend fun updatePreferences(@Body preferences: UpdatePreferencesDto): Response<Unit>

    // Which OAuth providers the deployment has configured (empty client
    // IDs disable both — the app only shows buttons that can work).
    @GET("api/auth/providers")
    suspend fun getOAuthProviders(): Response<OAuthProvidersResponseDto>

    // Raises sessionVersion: all other sessions are invalidated, this one
    // immediately gets a fresh cookie.
    @POST("api/auth/change-password")
    suspend fun changePassword(@Body request: ChangePasswordDto): Response<Unit>

    // Redeems an admin-issued one-time token (15 min validity). Works without
    // a session — that is the point: the login is lost with the password.
    @POST("api/auth/reset-password")
    suspend fun resetPassword(@Body request: ResetPasswordDto): Response<Unit>

    // Public demo account session. 404 when the server runs without
    // DEMO_MODE — the login screen keeps the button and explains it.
    @POST("api/auth/demo")
    suspend fun demoLogin(): Response<AuthResponseDto>

    // Notes
    @GET("api/notes")
    suspend fun getNotes(
        @Query("search") search: String? = null,
        @Query("tag") tag: String? = null,
        @Query("archived") archived: Boolean? = null,
        @Query("deleted") deleted: Boolean? = null,
        @Query("page") page: Int? = null,
        @Query("limit") limit: Int? = null,
        // Delta-Sync (v1.14.0 Nr. 6): ISO-8601 — only notes with
        // updatedAt > since come back (list AND pagination total).
        @Query("since") since: String? = null
    ): Response<NotesResponseDto>

    // Change probe (v1.14.0 Nr. 6): counts + max(updatedAt) in one
    // aggregation. The background sync compares the signature and skips
    // pulling entirely when nothing changed since the last pass.
    @GET("api/notes/meta")
    suspend fun getNotesMeta(): Response<NotesMetaDto>

    // Tree (v1.10.0): light sidebar projection; the client nests the flat
    // list itself. Registered before /{id} on the server, so no escaping
    // needed for the literal path segment.
    @GET("api/notes/tree")
    suspend fun getNoteTree(): Response<List<NoteTreeNodeDto>>

    // Markdown export (v1.10.0): the whole tree as a ZIP built server-side
    // (folders become _index.md directories) — streamed, not buffered.
    @Streaming
    @GET("api/notes/export/markdown")
    suspend fun exportMarkdown(): Response<okhttp3.ResponseBody>

    @GET("api/notes/{id}")
    suspend fun getNote(@Path("id") id: String): Response<NoteDto>

    @POST("api/notes")
    suspend fun createNote(@Body note: CreateNoteDto): Response<NoteDto>

    @PUT("api/notes/{id}")
    suspend fun updateNote(@Path("id") id: String, @Body note: UpdateNoteDto): Response<NoteDto>

    @DELETE("api/notes/{id}")
    suspend fun deleteNote(
        @Path("id") id: String,
        @Query("permanent") permanent: Boolean? = null
    ): Response<Unit>

    // Trash (30-day retention; janitor purges expired files first)
    @GET("api/notes")
    suspend fun getTrashedNotes(
        @Query("deleted") deleted: Boolean = true,
        @Query("limit") limit: Int? = null
    ): Response<NotesResponseDto>

    @POST("api/notes/{id}/restore")
    suspend fun restoreNote(@Path("id") id: String): Response<NoteDto>

    @DELETE("api/notes/trash")
    suspend fun emptyTrash(): Response<EmptyTrashResponseDto>

    @POST("api/notes/{id}/pin")
    suspend fun togglePin(@Path("id") id: String): Response<NoteDto>

    @POST("api/notes/{id}/archive")
    suspend fun toggleArchive(@Path("id") id: String): Response<NoteDto>

    // Manual ordering (drag & drop). The server validates orderedIds as an
    // array of MongoIds (max 200) — offline ids must be filtered out and the
    // list chunked before sending.
    @PATCH("api/notes/reorder")
    suspend fun reorderNotes(@Body request: ReorderNotesDto): Response<Unit>

    // Tag management (v1.14.0 Nr. 4): rename/merge/delete as ONE server-side
    // updateMany over all affected notes instead of one PUT per note.
    @PATCH("api/notes/tags")
    suspend fun tagOperation(@Body request: TagOperationRequestDto): Response<TagOperationResponseDto>

    @POST("api/notes/{id}/share")
    suspend fun shareNote(@Path("id") id: String, @Body request: ShareNoteDto): Response<Unit>

    @DELETE("api/notes/{id}/share/{userId}")
    suspend fun unshareNote(@Path("id") id: String, @Path("userId") userId: String): Response<Unit>

    // Images (multipart field name "images", max 5 per request / 25 per note,
    // responses return the updated note)
    @Multipart
    @POST("api/notes/{id}/images")
    suspend fun uploadImages(
        @Path("id") id: String,
        @Part images: List<MultipartBody.Part>
    ): Response<NoteDto>

    @DELETE("api/notes/{id}/images/{filename}")
    suspend fun deleteImage(
        @Path("id") id: String,
        @Path("filename") filename: String
    ): Response<NoteDto>

    // PDF attachments (v1.14.0 Nr. 5): multipart field name "files", max 5
    // per request / 25 per note / 25 MB each; the response returns the
    // updated note like the image upload does.
    @Multipart
    @POST("api/notes/{id}/files")
    suspend fun uploadFiles(
        @Path("id") id: String,
        @Part files: List<MultipartBody.Part>
    ): Response<NoteDto>

    @DELETE("api/notes/{id}/files/{filename}")
    suspend fun deleteFile(
        @Path("id") id: String,
        @Path("filename") filename: String
    ): Response<NoteDto>

    // Audio transcription (multipart field "audio", optional "language")
    @Multipart
    @POST("api/notes/{id}/transcribe")
    suspend fun transcribeAudio(
        @Path("id") id: String,
        @Part audio: MultipartBody.Part,
        @Part("language") language: RequestBody
    ): Response<TranscriptionResultDto>

    // Friends
    @GET("api/friends")
    suspend fun getFriends(): Response<List<FriendDto>>

    @GET("api/friends/requests")
    suspend fun getFriendRequests(): Response<List<FriendRequestDto>>

    @POST("api/friends/request")
    suspend fun sendFriendRequest(@Body request: FriendRequestBody): Response<Unit>

    @POST("api/friends/accept/{id}")
    suspend fun acceptFriendRequest(@Path("id") id: String): Response<Unit>

    @POST("api/friends/reject/{id}")
    suspend fun rejectFriendRequest(@Path("id") id: String): Response<Unit>

    @DELETE("api/friends/{id}")
    suspend fun removeFriend(@Path("id") id: String): Response<Unit>

    @GET("api/friends/search")
    suspend fun searchUsers(@Query("q") query: String): Response<List<FriendDto>>

    // Admin
    @GET("api/admin/stats")
    suspend fun getAdminStats(): Response<AdminStatsDto>

    @GET("api/admin/users")
    suspend fun getAdminUsers(): Response<List<UserDto>>

    @POST("api/admin/users")
    suspend fun createUser(@Body request: LoginRequestDto): Response<UserDto>

    @DELETE("api/admin/users/{id}")
    suspend fun deleteUser(@Path("id") id: String): Response<Unit>

    @POST("api/admin/users/{id}/toggle-admin")
    suspend fun toggleAdmin(@Path("id") id: String): Response<Unit>

    // Issues a one-time password-reset token for another user (15 min).
    // The token is returned exactly once — show + copy, never persist.
    @POST("api/admin/users/{id}/password-reset")
    suspend fun createPasswordResetToken(@Path("id") id: String): Response<PasswordResetTokenDto>

    @GET("api/admin/settings")
    suspend fun getAdminSettings(): Response<AdminSettingsDto>

    @PUT("api/admin/settings")
    suspend fun updateAdminSettings(@Body settings: AdminSettingsDto): Response<Unit>

    // Link Preview: POST /api/notes/link-preview mit JSON-Body (v1.13.0) —
    // der alte GET-Endpoint existiert serverseitig nicht mehr.
    @POST("api/notes/link-preview")
    suspend fun getLinkPreview(@Body request: LinkPreviewRequestDto): Response<LinkPreviewDto>

    // API Keys — the server mounts /api/api-keys (server.js); the previous
    // api/keys paths 404'd, so the whole Android key screen never worked.
    @GET("api/api-keys")
    suspend fun getApiKeys(): Response<ApiKeysResponseDto>

    @POST("api/api-keys")
    suspend fun createApiKey(@Body request: CreateApiKeyRequestDto): Response<ApiKeyDto>

    @DELETE("api/api-keys/{id}")
    suspend fun revokeApiKey(@Path("id") id: String): Response<Unit>
}
