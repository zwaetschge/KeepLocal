package com.keeplocal.android.data.api.dto

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
    owner = owner,
    position = position,
    createdAt = createdAt?.let { parseInstant(it) } ?: Instant.now(),
    updatedAt = updatedAt?.let { parseInstant(it) } ?: Instant.now(),
    deletedAt = deletedAt?.let { parseInstant(it) }
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

fun Note.toCreateDto(): CreateNoteDto = CreateNoteDto(
    title = title,
    content = content,
    color = color.hex,
    isPinned = isPinned,
    isTodoList = isTodoList,
    todoItems = if (isTodoList) todoItems.map { it.toDto() } else null,
    tags = tags.ifEmpty { null }
)

fun Note.toUpdateDto(): UpdateNoteDto = UpdateNoteDto(
    title = title,
    content = content,
    color = color.hex,
    isPinned = isPinned,
    isTodoList = isTodoList,
    todoItems = if (isTodoList) todoItems.map { it.toDto() } else null,
    tags = tags,
    position = position
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
