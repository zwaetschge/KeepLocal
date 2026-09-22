package com.keeplocal.android.data.api.dto

import com.keeplocal.android.data.api.NullableString
import com.keeplocal.android.domain.model.*
import java.time.Instant

fun NoteDto.toDomain(): Note = Note(
    id = resolvedId(),
    title = title,
    content = content,
    color = NoteColor.fromHex(color),
    isPinned = isPinned,
    isArchived = isArchived,
    isTodoList = isTodoList,
    todoItems = todoItems?.map { it.toDomain() } ?: emptyList(),
    tags = tags ?: emptyList(),
    sharedWith = sharedWith?.map { it.toDomain() } ?: emptyList(),
    images = images?.map { it.toDomain() } ?: emptyList(),
    files = files?.map { it.toDomain() } ?: emptyList(),
    owner = owner,
    position = position,
    createdAt = createdAt?.let { parseInstant(it) } ?: Instant.now(),
    updatedAt = updatedAt?.let { parseInstant(it) } ?: Instant.now(),
    deletedAt = deletedAt?.let { parseInstant(it) },
    remindAt = remindAt?.let { parseInstantOrNull(it) },
    parentId = parentId,
    isCode = isCode
)

fun TodoItemDto.toDomain(): TodoItem = TodoItem(
    id = resolvedId(),
    text = text,
    isCompleted = isCompleted,
    position = position
)

fun SharedUserDto.toDomain(): SharedUser = SharedUser(
    userId = userId,
    username = username
)

fun NoteImageDto.toDomain(): NoteImage = NoteImage(
    filename = filename,
    url = url,
    thumbnailUrl = thumbnailUrl?.takeIf { it.isNotBlank() },
    originalName = originalName
)

fun NoteFileDto.toDomain(): NoteFile = NoteFile(
    filename = filename,
    url = url,
    originalName = originalName,
    mimeType = mimetype,
    sizeBytes = size,
    uploadedAt = uploadedAt?.let { parseInstantOrNull(it) }
)

fun UserDto.toDomain(): User = User(
    id = resolvedId(),
    username = username,
    isAdmin = isAdmin,
    createdAt = createdAt?.let { parseInstant(it) } ?: Instant.now()
)

fun FriendDto.toDomain(): Friend = Friend(
    id = resolvedId(),
    username = username
)

fun FriendRequestDto.toDomain(currentUserId: String): FriendRequest = FriendRequest(
    id = resolvedId(),
    fromUser = from.resolvedId(),
    fromUsername = from.username,
    toUser = to.resolvedId(),
    toUsername = to.username,
    isIncoming = to.resolvedId() == currentUserId
)

fun AdminStatsDto.toDomain(): AdminStats = AdminStats(
    userCount = userCount,
    noteCount = noteCount
)

fun AdminSettingsDto.toDomain(): AdminSettings = AdminSettings(
    registrationEnabled = registrationEnabled
)

fun AdminSettings.toDto(): AdminSettingsDto = AdminSettingsDto(
    registrationEnabled = registrationEnabled
)

fun LinkPreviewDto.toDomain(): LinkPreview = LinkPreview(
    url = url,
    title = title,
    description = description,
    image = image
)

fun SavedSearchDto.toDomain(): SavedSearch = SavedSearch(
    id = id,
    name = name,
    query = query,
    typeFilter = typeFilter,
    tag = tag
)

fun SavedSearch.toDto(): SavedSearchDto = SavedSearchDto(
    id = id,
    name = name,
    query = query,
    typeFilter = typeFilter,
    tag = tag
)

fun Note.toCreateDto(): CreateNoteDto = CreateNoteDto(
    title = title,
    content = content,
    color = color.hex,
    isPinned = isPinned,
    isTodoList = isTodoList,
    todoItems = if (isTodoList) todoItems.map { it.toDto() } else null,
    tags = tags.ifEmpty { null },
    remindAt = remindAt?.toString(),
    parentId = parentId,
    isCode = isCode
)

fun Note.toUpdateDto(): UpdateNoteDto = UpdateNoteDto(
    title = title,
    content = content,
    color = color.hex,
    isPinned = isPinned,
    isTodoList = isTodoList,
    todoItems = if (isTodoList) todoItems.map { it.toDto() } else null,
    tags = tags,
    position = position,
    // Always sent (full-state semantics): null clears the server-side reminder.
    remindAt = NullableString(remindAt?.toString()),
    // Same full-state contract for the tree position and the code flag.
    parentId = NullableString(parentId),
    isCode = isCode
)

fun TodoItem.toDto(): TodoItemDto = TodoItemDto(
    id = id,
    text = text,
    isCompleted = isCompleted,
    position = position
)

private fun parseInstant(dateString: String): Instant {
    return try {
        Instant.parse(dateString)
    } catch (_: Exception) {
        Instant.now()
    }
}

/** Strict parse for reminder times: an unparseable value means "no reminder"
 *  (null), never a fabricated now() that would fire a bogus notification. */
private fun parseInstantOrNull(dateString: String): Instant? =
    runCatching { Instant.parse(dateString) }.getOrNull()
