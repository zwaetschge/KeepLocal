package com.keeplocal.android.util

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import com.keeplocal.android.domain.model.Note
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * Renders a note into a PDF document (v1.9.0 Nr. 8) — "share as PDF" and
 * "print" in the editor overflow menu. Text assembly lives in the pure
 * [PdfNoteFormatter]; this class only measures (StaticLayout) and draws
 * (PdfDocument) what that produced, A4 portrait with generous margins.
 *
 * Line breaking is delegated to StaticLayout so the PDF wraps exactly like
 * the measured text — no character-count guessing that overflows the page.
 * The body is emitted line-band by line-band: each page clips the layout to
 * the lines that fit under the title (page 1) or a full column (rest).
 */
object PdfNoteRenderer {

    // A4 in PostScript points.
    private const val PAGE_WIDTH = 595
    private const val PAGE_HEIGHT = 842
    private const val MARGIN = 48f
    private val USABLE_WIDTH = (PAGE_WIDTH - 2 * MARGIN).toInt()

    private const val TITLE_SIZE = 16f
    private const val BODY_SIZE = 11f

    /** Renders the note; the caller owns the returned file (cache dir). */
    fun renderToCacheFile(context: Context, note: Note): File {
        val bytes = render(note.title.ifBlank { "Notiz" }, PdfNoteFormatter.documentText(note))
        val dir = File(context.cacheDir, "shared").apply { mkdirs() }
        // Stale exports accumulate otherwise — one file per note id, and the
        // OS clears the whole cache dir itself under storage pressure.
        val safeId = note.id.replace(Regex("[^A-Za-z0-9_-]"), "").take(40).ifBlank { "note" }
        val file = File(dir, "keeplocal-$safeId.pdf")
        file.writeBytes(bytes)
        return file
    }

    /** Renders [body] under the bold [title] and returns the PDF bytes. */
    fun render(title: String, body: String): ByteArray {
        val document = PdfDocument()

        val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.BLACK
            textSize = TITLE_SIZE
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        val bodyPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.DKGRAY
            textSize = BODY_SIZE
            typeface = Typeface.SANS_SERIF
        }

        val titleLayout = staticLayout(title, titlePaint)
        val bodyLayout = staticLayout(body, bodyPaint)
        val lineHeight = bodyLayout.getLineBottom(0) - bodyLayout.getLineTop(0)

        var pageNumber = 0
        var lineCursor = 0 // first body line not yet drawn
        while (lineCursor < bodyLayout.lineCount) {
            pageNumber++
            val page = document.startPage(
                PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, pageNumber).create()
            )
            val canvas = page.canvas

            if (pageNumber == 1) {
                canvas.drawText(title, 0, title.length, MARGIN, MARGIN + TITLE_SIZE, titlePaint)
            }

            // Page 1 shares its space with the title block; the rest are
            // full text columns.
            val bodyTop = if (pageNumber == 1) MARGIN + titleLayout.height + BODY_SIZE else MARGIN
            val available = (PAGE_HEIGHT - MARGIN - bodyTop).toInt()
            val linesOnPage = if (lineHeight <= 0) 0 else available / lineHeight
            if (linesOnPage <= 0) {
                // Cannot happen with these margins, but a guaranteed stop
                // beats a potential endless page loop.
                document.finishPage(page)
                break
            }
            val lastLine = (lineCursor + linesOnPage).coerceAtMost(bodyLayout.lineCount)

            canvas.save()
            canvas.translate(MARGIN, bodyTop - bodyLayout.getLineTop(lineCursor))
            canvas.clipRect(
                0f,
                bodyLayout.getLineTop(lineCursor).toFloat(),
                USABLE_WIDTH.toFloat(),
                bodyLayout.getLineBottom(lastLine - 1).toFloat()
            )
            bodyLayout.draw(canvas)
            canvas.restore()

            lineCursor = lastLine
            document.finishPage(page)
        }

        if (document.pages.isEmpty()) {
            // Degenerate empty note — emit one blank page so every share
            // target receives a valid PDF.
            val page = document.startPage(PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, 1).create())
            document.finishPage(page)
        }

        return try {
            val out = ByteArrayOutputStream()
            document.writeTo(out)
            out.toByteArray()
        } finally {
            document.close()
        }
    }

    private fun staticLayout(text: String, paint: TextPaint): StaticLayout =
        StaticLayout.Builder.obtain(text, 0, text.length, paint, USABLE_WIDTH)
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .setLineSpacing(2f, 1f)
            .build()
}
