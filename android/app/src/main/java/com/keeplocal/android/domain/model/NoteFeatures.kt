package com.keeplocal.android.domain.model

import com.squareup.moshi.JsonClass

/** UTF-16 offsets match Kotlin String and browser selections. No HTML is stored. */
@JsonClass(generateAdapter = true)
data class TextMark(val type: String, val start: Int, val end: Int)

@JsonClass(generateAdapter = true)
data class DrawingStroke(val color: String = "#202124", val width: Float = 3f, val points: List<List<Float>> = emptyList())

@JsonClass(generateAdapter = true)
data class NoteDrawing(val width: Int = 800, val height: Int = 600, val strokes: List<DrawingStroke> = emptyList(), val imageFilename: String? = null)

@JsonClass(generateAdapter = true)
data class ChecklistOptions(val checkedToBottom: Boolean = true, val addToTop: Boolean = false, val collapseCompleted: Boolean = false)

@JsonClass(generateAdapter = true)
data class NoteFeatures(
    val format: String = "plain",
    val marks: List<TextMark> = emptyList(),
    val background: String = "none",
    val drawing: NoteDrawing? = null,
    val ocrText: String = "",
    val list: ChecklistOptions = ChecklistOptions()
)
