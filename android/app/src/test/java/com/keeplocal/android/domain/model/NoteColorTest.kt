package com.keeplocal.android.domain.model

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The server validates color as /^#[0-9A-Fa-f]{6}$/ and whitelists exactly
 * these twelve values (NOTE_COLORS in notesService.js). A wrong wire format
 * makes every note create/update fail with 400 — which once left a note
 * stuck in the offline queue forever.
 */
class NoteColorTest {

    @Test
    fun `every enum value maps to a server-whitelisted hex`() {
        val whitelisted = setOf(
            "#ffffff", "#f28b82", "#fbbc04", "#fff475", "#ccff90", "#a7ffeb",
            "#cbf0f8", "#aecbfa", "#d7aefb", "#fdcfe8", "#e6c9a8", "#e8eaed"
        )
        NoteColor.entries.forEach { color ->
            assertEquals("hex for $color must match the server whitelist", color.hex, color.hex.lowercase())
            assert(whitelisted.contains(color.hex)) { "${color.hex} ($color) is not whitelisted" }
        }
        assertEquals(whitelisted.size, NoteColor.entries.size)
    }

    @Test
    fun `fromHex is the inverse of hex`() {
        NoteColor.entries.forEach { color ->
            assertEquals(color, NoteColor.fromHex(color.hex))
        }
    }

    @Test
    fun `fromHex is case insensitive`() {
        assertEquals(NoteColor.RED, NoteColor.fromHex("#F28B82"))
    }

    @Test
    fun `fromHex falls back to DEFAULT for unknown values`() {
        assertEquals(NoteColor.DEFAULT, NoteColor.fromHex(null))
        assertEquals(NoteColor.DEFAULT, NoteColor.fromHex("default"))
        assertEquals(NoteColor.DEFAULT, NoteColor.fromHex("#12345"))
    }
}
