package com.keeplocal.android.data.api

import com.keeplocal.android.data.api.dto.NoteDto
import com.keeplocal.android.data.api.dto.TodoItemDto
import com.keeplocal.android.data.api.dto.UpdateNoteDto
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * v1.16.0 wire contract: the server note schema (and the web client, and the
 * v1 API) speak `completed`/`order` — for todo items and for the note-level
 * manual order. Until v1.15 this app serialized `isCompleted`/`position`:
 * server validation let the unknown keys pass (undefined is legal) and the
 * strict Mongoose schema stripped them, so check marks and item order were
 * silently lost on every sync — and server `order` never reached the note
 * position on the way back. These tests pin the field names in BOTH
 * directions so the contract cannot drift again.
 */
class TodoWireContractTest {

    private val moshi = Moshi.Builder()
        .add(KotlinJsonAdapterFactory())
        .build()

    private val todoAdapter = moshi.adapter(TodoItemDto::class.java)
    private val noteAdapter = moshi.adapter(NoteDto::class.java)
    private val updateAdapter = moshi.adapter(UpdateNoteDto::class.java)

    @Test
    fun `todo item parses the server wire shape`() {
        val item = todoAdapter.fromJson(
            """{"_id":"665f0a000000000000000001","text":"Milch","completed":true,"order":2}"""
        )!!

        assertEquals("Milch", item.text)
        assertTrue(item.isCompleted)
        assertEquals(2, item.position)
        assertEquals("665f0a000000000000000001", item.resolvedId())
    }

    @Test
    fun `todo item serializes to the server wire shape`() {
        val json = todoAdapter.toJson(
            TodoItemDto(id = "x", text = "Brot", isCompleted = true, position = 1)
        )

        assertTrue("expected \"completed\":true in $json", json.contains("\"completed\":true"))
        assertTrue("expected \"order\":1 in $json", json.contains("\"order\":1"))
        assertFalse("legacy field isCompleted must not be sent: $json", json.contains("isCompleted"))
        assertFalse("legacy field position must not be sent: $json", json.contains("\"position\""))
    }

    @Test
    fun `legacy wire names are no longer read`() {
        // Old payloads (pre-v1.16 server caches, imports) carry the legacy
        // names — they must fall back to defaults, not resurrect the drift.
        val item = todoAdapter.fromJson(
            """{"text":"Alt","isCompleted":true,"position":7}"""
        )!!

        assertFalse(item.isCompleted)
        assertEquals(0, item.position)
    }

    @Test
    fun `note parses the server order field`() {
        val note = noteAdapter.fromJson(
            """{"_id":"665f0a000000000000000002","title":"Manuell sortiert","order":5}"""
        )!!

        assertEquals(5, note.position)
    }

    @Test
    fun `update body sends order under its server name`() {
        val json = updateAdapter.toJson(UpdateNoteDto(title = "x", position = 3))

        assertTrue("expected \"order\":3 in $json", json.contains("\"order\":3"))
        assertFalse("legacy field position must not be sent: $json", json.contains("\"position\""))
    }

    @Test
    fun `update body with todos carries the server todo contract`() {
        val json = updateAdapter.toJson(
            UpdateNoteDto(
                title = "Einkauf",
                isTodoList = true,
                todoItems = listOf(
                    TodoItemDto(text = "Milch", isCompleted = false, position = 0),
                    TodoItemDto(text = "Brot", isCompleted = true, position = 1)
                )
            )
        )

        assertTrue(json.contains("\"completed\":false"))
        assertTrue(json.contains("\"completed\":true"))
        assertFalse(json.contains("isCompleted"))
        assertFalse(json.contains("\"position\""))
    }
}
