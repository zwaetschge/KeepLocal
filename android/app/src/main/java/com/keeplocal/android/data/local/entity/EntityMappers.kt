package com.keeplocal.android.data.local.entity

import com.keeplocal.android.domain.model.*
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.time.Instant

private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
private val todoListType = Types.newParameterizedType(List::class.java, TodoItemData::class.java)
private val stringListType = Types.newParameterizedType(List::class.java, String::class.java)
private val sharedUserListType = Types.newParameterizedType(List::class.java, SharedUserData::class.java)
private val noteImageListType = Types.newParameterizedType(List::class.java, NoteImageData::class.java)

private data class TodoItemData(val id: String, val text: String, val isCompleted: Boolean, val position: Int)
private data class SharedUserData(val userId: String, val username: String)
private data class NoteImageData(
    val filename: String,
    val url: String,
    val thumbnailUrl: String? = null,
    val originalName: String? = null
)

fun NoteEntity.toDomain(): Note = Note(
    id = id,
    title = title,
    content = content,
    color = try { NoteColor.valueOf(color.uppercase()) } catch (_: Exception) { NoteColor.DEFAULT },
    isPinned = isPinned,
    isArchived = isArchived,
    isTodoList = isTodoList,
    todoItems = parseTodoItems(todoItemsJson),
    tags = parseStringList(tagsJson),
    sharedWith = parseSharedUsers(sharedWithJson),
    images = parseNoteImages(imagesJson),
    owner = owner,
    position = position,
    createdAt = Instant.ofEpochMilli(createdAt),
    updatedAt = Instant.ofEpochMilli(updatedAt),
    baseUpdatedAt = baseUpdatedAt?.let { raw -> runCatching { Instant.parse(raw) }.getOrNull() },
    remindAt = remindAtEpochMs?.let { Instant.ofEpochMilli(it) },
    parentId = parentId,
    isCode = isCode
)

fun Note.toEntity(): NoteEntity = NoteEntity(
    id = id,
    title = title,
    content = content,
    color = color.name.lowercase(),
    isPinned = isPinned,
    isArchived = isArchived,
    isTodoList = isTodoList,
    todoItemsJson = serializeTodoItems(todoItems),
    tagsJson = serializeStringList(tags),
    sharedWithJson = serializeSharedUsers(sharedWith),
    imagesJson = serializeNoteImages(images),
    owner = owner,
    position = position,
    createdAt = createdAt.toEpochMilli(),
    updatedAt = updatedAt.toEpochMilli(),
    baseUpdatedAt = baseUpdatedAt?.toString(),
    remindAtEpochMs = remindAt?.toEpochMilli(),
    parentId = parentId,
    isCode = isCode
)

private fun parseTodoItems(json: String): List<TodoItem> {
    return try {
        val adapter = moshi.adapter<List<TodoItemData>>(todoListType)
        adapter.fromJson(json)?.map { TodoItem(it.id, it.text, it.isCompleted, it.position) } ?: emptyList()
    } catch (_: Exception) { emptyList() }
}

private fun serializeTodoItems(items: List<TodoItem>): String {
    val adapter = moshi.adapter<List<TodoItemData>>(todoListType)
    return adapter.toJson(items.map { TodoItemData(it.id, it.text, it.isCompleted, it.position) })
}

private fun parseStringList(json: String): List<String> {
    return try {
        val adapter = moshi.adapter<List<String>>(stringListType)
        adapter.fromJson(json) ?: emptyList()
    } catch (_: Exception) { emptyList() }
}

private fun serializeStringList(list: List<String>): String {
    val adapter = moshi.adapter<List<String>>(stringListType)
    return adapter.toJson(list)
}

private fun parseSharedUsers(json: String): List<SharedUser> {
    return try {
        val adapter = moshi.adapter<List<SharedUserData>>(sharedUserListType)
        adapter.fromJson(json)?.map { SharedUser(it.userId, it.username) } ?: emptyList()
    } catch (_: Exception) { emptyList() }
}

private fun serializeSharedUsers(users: List<SharedUser>): String {
    val adapter = moshi.adapter<List<SharedUserData>>(sharedUserListType)
    return adapter.toJson(users.map { SharedUserData(it.userId, it.username) })
}

// --- Image attachments (kept as their own block, mirroring the helpers above) ---

private fun parseNoteImages(json: String): List<NoteImage> {
    return try {
        val adapter = moshi.adapter<List<NoteImageData>>(noteImageListType)
        adapter.fromJson(json)?.map {
            NoteImage(
                filename = it.filename,
                url = it.url,
                thumbnailUrl = it.thumbnailUrl?.takeIf { t -> t.isNotBlank() },
                originalName = it.originalName
            )
        } ?: emptyList()
    } catch (_: Exception) { emptyList() }
}

private fun serializeNoteImages(images: List<NoteImage>): String {
    val adapter = moshi.adapter<List<NoteImageData>>(noteImageListType)
    return adapter.toJson(
        images.map {
            NoteImageData(
                filename = it.filename,
                url = it.url,
                thumbnailUrl = it.thumbnailUrl,
                originalName = it.originalName
            )
        }
    )
}
