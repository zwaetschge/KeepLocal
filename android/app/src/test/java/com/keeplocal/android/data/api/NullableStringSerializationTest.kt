package com.keeplocal.android.data.api

import com.keeplocal.android.data.api.dto.UpdateNoteDto
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The reminder delete relies on a JSON nuance: Moshi omits nullable fields,
 * so clearing remindAt needs a wrapped value that writes an explicit null.
 */
class NullableStringSerializationTest {

    private val moshi = Moshi.Builder()
        .add(NullableString::class.java, NullableStringAdapter)
        .add(KotlinJsonAdapterFactory())
        .build()

    private val adapter = moshi.adapter(UpdateNoteDto::class.java)

    @Test
    fun `wrapped null writes an explicit remindAt null`() {
        val json = adapter.toJson(UpdateNoteDto(title = "x", remindAt = NullableString(null)))

        assertTrue("expected \"remindAt\":null in $json", json.contains("\"remindAt\":null"))
    }

    @Test
    fun `wrapped value writes the reminder timestamp`() {
        val json = adapter.toJson(
            UpdateNoteDto(title = "x", remindAt = NullableString("2026-12-24T08:00:00Z"))
        )

        assertTrue(json.contains("\"remindAt\":\"2026-12-24T08:00:00Z\""))
    }

    @Test
    fun `absent wrapper leaves the field out entirely`() {
        val json = adapter.toJson(UpdateNoteDto(title = "x"))

        assertFalse("remindAt must be omitted when the wrapper is null: $json", json.contains("remindAt"))
    }

    @Test
    fun `round trip restores the wrapper state`() {
        val original = UpdateNoteDto(title = "x", remindAt = NullableString(null))

        val parsed = adapter.fromJson(adapter.toJson(original))

        assertEquals(original, parsed)
    }
}
