package com.keeplocal.android.data.api

import com.squareup.moshi.JsonAdapter
import com.squareup.moshi.JsonReader
import com.squareup.moshi.JsonWriter

/**
 * A string field that is written to JSON even when it is null.
 *
 * Moshi omits nullable fields by default (JsonWriter.serializeNulls is false),
 * but the KeepLocal API distinguishes "field absent" (leave the stored value
 * alone) from "field null" (clear it) — deleting a reminder via
 * PUT /api/notes/:id needs `"remindAt": null` in the body. Wrapping the value
 * in this class keeps the field itself non-null while the adapter temporarily
 * enables serializeNulls for exactly this one value.
 */
data class NullableString(val value: String?)

/** Writes the inner value even when null; registered in NetworkModule's Moshi. */
object NullableStringAdapter : JsonAdapter<NullableString>() {
    override fun fromJson(reader: JsonReader): NullableString? =
        if (reader.peek() == JsonReader.Token.NULL) {
            reader.nextNull<Any>() // generic in Java; the value is discarded anyway
            NullableString(null)
        } else {
            NullableString(reader.nextString())
        }

    override fun toJson(writer: JsonWriter, value: NullableString?) {
        // A null wrapper is the "field absent" case — hand the null to the
        // writer under its default policy so it is OMITTED, not written.
        // Only a present wrapper with a null inner value is the explicit
        // `"remindAt":null` that clears a reminder on the server.
        if (value == null) {
            writer.nullValue()
            return
        }
        val previous = writer.serializeNulls
        writer.serializeNulls = true
        try {
            if (value.value == null) writer.nullValue() else writer.value(value.value)
        } finally {
            writer.serializeNulls = previous
        }
    }
}
