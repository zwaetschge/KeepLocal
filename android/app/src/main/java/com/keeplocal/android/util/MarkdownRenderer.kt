package com.keeplocal.android.util

import androidx.compose.foundation.text.ClickableText
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em

/**
 * Hand-rolled markdown renderer (v1.18.0): the WebUI renders note content
 * through marked + DOMPurify (client/src/utils/markdown.mjs), the Android
 * editor showed raw `#`/`*` source. No markdown library is on the classpath,
 * so the web feature set is mirrored by hand:
 *
 *  - ATX headings `#`–`######` (trailing hashes stripped)
 *  - `**bold**` / `__bold__`, `*italic*` / `_italic_`, `***both***`
 *  - `~~strikethrough~~` (GFM), `` `inline code` ``, fenced ``` blocks
 *  - `-`/`*`/`+` unordered and `1.`/`1)` ordered lists, GFM task checkboxes
 *  - `>` quotes (parsed recursively), horizontal rules `---`/`***`/`___`
 *  - `[text](url)` links, `![alt](url)` images (alt text, tappable),
 *    `<https://autolinks>`, `[[Wiki Links]]`
 *  - paragraphs with GFM `breaks: true` — a single newline stays a newline
 *
 * Split in two so the parsing stays unit-testable without Robolectric:
 * [MarkdownRenderer.parseMarkdown] is pure Kotlin and produces a span tree;
 * [markdownToAnnotatedString] / [MarkdownText] are the Compose half turning
 * the spans into a clickable AnnotatedString.
 *
 * Known simplifications versus marked: no setext headings, no reference
 * links, list nesting is flattened, `\*`-style escapes are inline-only and
 * lose their backslash inside code spans.
 */
object MarkdownRenderer {

    // --- span tree (pure data, no Compose dependencies) ---

    sealed interface MarkdownBlock {
        /** Runs of text; a `\n` inside a span renders as a line break. */
        data class Paragraph(val spans: List<InlineSpan>) : MarkdownBlock
        data class Heading(val level: Int, val spans: List<InlineSpan>) : MarkdownBlock

        /** `>` quote with the markers stripped; the inner content is re-parsed. */
        data class Quote(val children: List<MarkdownBlock>) : MarkdownBlock
        data class MarkdownList(val items: List<ListItem>) : MarkdownBlock
        data class CodeBlock(val text: String, val language: String) : MarkdownBlock
        data object Rule : MarkdownBlock
    }

    /** One list entry; [number] keeps the value the author wrote. */
    data class ListItem(
        val ordered: Boolean,
        /** Written number ("1", "2") for ordered items; null for bullets. */
        val number: String?,
        /** GFM task list: false = `[ ]`, true = `[x]`; null = no checkbox. */
        val checked: Boolean?,
        val spans: List<InlineSpan>
    )

    data class InlineSpan(
        val text: String,
        val bold: Boolean = false,
        val italic: Boolean = false,
        val strikethrough: Boolean = false,
        val code: Boolean = false,
        /** Markdown link / image / autolink target — rendered tappable. */
        val url: String? = null,
        /** Wiki link target (`[[Titel]]`); openable when a note carries it. */
        val wikiTitle: String? = null
    )

    // --- block parsing ---

    private val FENCE_OPEN = Regex("""^ {0,3}(`{3,}|~{3,})[ \t]*(\S*)""")
    private val HEADING = Regex("""^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$""")
    private val HORIZONTAL_RULE = Regex("""^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$""")
    private val QUOTE = Regex("""^ {0,3}> ?(.*)$""")
    private val LIST_ITEM = Regex("""^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$""")
    private val CHECKBOX = Regex("""^\[([ xX])][ \t]*(.*)$""")

    fun parseMarkdown(source: String): List<MarkdownBlock> {
        if (source.isEmpty()) return emptyList()
        val lines = source.replace("\r\n", "\n").replace('\r', '\n').split('\n')
        return parseLines(lines)
    }

    private fun parseLines(lines: List<String>): List<MarkdownBlock> {
        val blocks = mutableListOf<MarkdownBlock>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            when {
                line.isBlank() -> i++

                else -> {
                    val fence = FENCE_OPEN.find(line)
                    val heading = HEADING.find(line)
                    val quote = QUOTE.find(line)
                    val item = LIST_ITEM.find(line)
                    when {
                        fence != null -> {
                            // Closing fence: the same character, 3+ times,
                            // alone on the line. Unclosed runs to the end.
                            val fenceChar = fence.groupValues[1].first()
                            val closing = Regex("^ {0,3}\\$fenceChar{3,}[ \t]*$")
                            val code = StringBuilder()
                            i++
                            while (i < lines.size && !closing.matches(lines[i])) {
                                code.append(lines[i]).append('\n')
                                i++
                            }
                            if (i < lines.size) i++ // drop the closing fence
                            blocks += MarkdownBlock.CodeBlock(
                                text = code.toString().removeSuffix("\n"),
                                language = fence.groupValues[2]
                            )
                        }

                        // `---` and friends beat the list parser: `***`
                        // would otherwise read as bullet soup.
                        HORIZONTAL_RULE.matches(line) -> {
                            blocks += MarkdownBlock.Rule
                            i++
                        }

                        heading != null -> {
                            blocks += MarkdownBlock.Heading(
                                level = heading.groupValues[1].length,
                                spans = parseInline(heading.groupValues[2])
                            )
                            i++
                        }

                        quote != null -> {
                            val inner = mutableListOf<String>()
                            while (i < lines.size) {
                                val quoteLine = QUOTE.find(lines[i]) ?: break
                                inner += quoteLine.groupValues[1]
                                i++
                            }
                            blocks += MarkdownBlock.Quote(children = parseLines(inner))
                        }

                        item != null -> {
                            val (list, next) = parseList(lines, i)
                            blocks += list
                            i = next
                        }

                        else -> {
                            val paragraph = mutableListOf<String>()
                            while (i < lines.size) {
                                val current = lines[i]
                                if (current.isBlank() ||
                                    FENCE_OPEN.containsMatchIn(current) ||
                                    HEADING.matches(current) ||
                                    HORIZONTAL_RULE.matches(current) ||
                                    QUOTE.matches(current) ||
                                    LIST_ITEM.containsMatchIn(current)
                                ) break
                                paragraph += current
                                i++
                            }
                            blocks += MarkdownBlock.Paragraph(spans = parseInline(paragraph.joinToString("\n")))
                        }
                    }
                }
            }
        }
        return blocks
    }

    /** Consumes a run of list items; continuation lines join the previous item. */
    private fun parseList(lines: List<String>, start: Int): Pair<MarkdownBlock.MarkdownList, Int> {
        // Raw text first, spans last: a continuation line has to be merged
        // into the item's source before the inline parser sees it.
        data class RawItem(
            val ordered: Boolean,
            val number: String?,
            val checked: Boolean?,
            var text: String
        )

        val raws = mutableListOf<RawItem>()
        var i = start
        while (i < lines.size) {
            val item = LIST_ITEM.find(lines[i])
            when {
                item != null -> {
                    val marker = item.groupValues[2]
                    val ordered = marker.first().isDigit()
                    var text = item.groupValues[3]
                    var checked: Boolean? = null
                    val box = CHECKBOX.find(text)
                    if (box != null) {
                        checked = box.groupValues[1].equals("x", ignoreCase = true)
                        text = box.groupValues[2]
                    }
                    raws += RawItem(ordered, if (ordered) marker.dropLast(1) else null, checked, text)
                    i++
                }

                // An indented or lazy continuation line belongs to the
                // previous item (CommonMark); a blank line ends the list.
                // Block- Starts (Heading, Fence, Rule, Quote) sind KEINE
                // Fortsetzung — sonst verschluckt der erste Listenpunkt
                // eine ganze folgende Überschrift (Review v1.18.0).
                lines[i].isNotBlank() && raws.isNotEmpty()
                    && !HEADING.matches(lines[i])
                    && !FENCE_OPEN.containsMatchIn(lines[i])
                    && !HORIZONTAL_RULE.matches(lines[i])
                    && !QUOTE.matches(lines[i]) -> {
                    raws[raws.lastIndex].text += "\n" + lines[i].trim()
                    i++
                }

                else -> break
            }
        }
        return MarkdownBlock.MarkdownList(
            items = raws.map { raw ->
                ListItem(raw.ordered, raw.number, raw.checked, parseInline(raw.text))
            }
        ) to i
    }

    // --- inline parsing ---

    private const val PLACEHOLDER_BASE = '\uE000'
    private const val ESCAPABLE = """\`*_{}[]()#+-.!>~"""

    /** `\X` for a markdown-relevant X becomes a placeholder no regex below matches. */
    private val ESCAPE = Regex("""\\([\\`*_{}\[\]()#+\-.!>~])""")

    private val INLINE_CODE = Regex("`([^`\n]+)`")
    private val AUTOLINK = Regex("""<((?:https?|mailto):[^>\s]+)>""")
    // URL-Teil: Zeichen ohne Klammern/Whitespace ODER eine vollständig
    // balancierte (...)gruppe — sonst frisst [^)\s]+ bei Wikipedia-URLs wie
    // …/Wien_(Bundesland)) beim ersten ")" ab (Review v1.18.0).
    private val IMAGE = Regex("""!\[([^\]\n]*)]\(((?:[^()\s]|\([^()\s]*\))+)(?:[ \t]+"([^"]*)")?\)""")
    private val WIKI_LINK = NoteLinkDetector.WIKI_PATTERN
    private val LINK = Regex("""\[([^\]\n]*)]\(((?:[^()\s]|\([^()\s]*\))+)(?:[ \t]+"([^"]*)")?\)""")
    private val BOLD_ITALIC_STAR = Regex("""\*\*\*(?!\s)(.+?)(?<!\s)\*\*\*""")
    private val BOLD_ITALIC_UNDERSCORE = Regex("""(?<![\w\\])___(?!\s)(.+?)(?<!\s)___(?!\w)""")
    private val BOLD_STAR = Regex("""\*\*(?!\s)(.+?)(?<!\s)\*\*""")
    private val BOLD_UNDERSCORE = Regex("""(?<![\w\\])__(?!\s)(.+?)(?<!\s)__(?!\w)""")
    private val STRIKETHROUGH = Regex("""~~(?!\s)(.+?)(?<!\s)~~""")
    private val ITALIC_STAR = Regex("""\*(?!\s)([^*\n]+?)(?<!\s)\*""")
    private val ITALIC_UNDERSCORE = Regex("""(?<![\w\\])_(?!\s)([^_\n]+?)(?<!\s)_(?!\w)""")

    private fun parseInline(source: String): List<InlineSpan> {
        if (source.isEmpty()) return emptyList()
        val escaped = ESCAPE.replace(source) { match ->
            (PLACEHOLDER_BASE + ESCAPABLE.indexOf(match.groupValues[1])).toString()
        }
        val out = mutableListOf<InlineSpan>()
        parseSpans(escaped, bold = false, italic = false, strike = false, url = null, wiki = null, out = out)
        // restore auch für url/wikiTitle (Review v1.18.0): Die Platzhalter
        // stecken in ALLEN gegriffenen Gruppen — ohne das hier öffnet
        // [x](Final\(v2\).pdf) eine URL mit Private-Use-Zeichen, und ein
        // [[C\+\+]]-Wiki-Tap findet die Notiz „C++" nie.
        return out.map {
            it.copy(
                text = restore(it.text),
                url = it.url?.let(::restore),
                wikiTitle = it.wikiTitle?.let(::restore)
            )
        }
    }

    private fun parseSpans(
        text: String,
        bold: Boolean,
        italic: Boolean,
        strike: Boolean,
        url: String?,
        wiki: String?,
        out: MutableList<InlineSpan>
    ) {
        var index = 0
        while (index < text.length) {
            val next = nextInlineMatch(text, index)
            if (next == null) {
                out += InlineSpan(text.substring(index), bold, italic, strike, url = url, wikiTitle = wiki)
                return
            }
            val match = next.match
            if (match.range.first > index) {
                out += InlineSpan(
                    text.substring(index, match.range.first), bold, italic, strike, url = url, wikiTitle = wiki
                )
            }
            when (next.kind) {
                // Leaf spans keep the context they were parsed in — a code
                // span inside **bold** stays bold, one inside a link is
                // clickable like the link text around it.
                Kind.CODE -> out += InlineSpan(match.groupValues[1], bold, italic, strike, code = true, url = url)
                Kind.AUTOLINK -> out += InlineSpan(match.groupValues[1], bold, italic, strike, url = match.groupValues[1])
                Kind.IMAGE -> out += InlineSpan(
                    match.groupValues[1].ifEmpty { match.groupValues[2] },
                    bold, italic, strike, url = match.groupValues[2]
                )
                Kind.WIKI -> out += InlineSpan(
                    match.groupValues[1].trim(), bold, italic, strike, wikiTitle = match.groupValues[1].trim()
                )
                Kind.LINK -> parseSpans(match.groupValues[1], bold, italic, strike, match.groupValues[2], wiki, out)
                Kind.BOLD_ITALIC -> parseSpans(match.groupValues[1], true, true, strike, url, wiki, out)
                Kind.BOLD -> parseSpans(match.groupValues[1], true, italic, strike, url, wiki, out)
                Kind.STRIKE -> parseSpans(match.groupValues[1], bold, italic, true, url, wiki, out)
                Kind.ITALIC -> parseSpans(match.groupValues[1], bold, true, strike, url, wiki, out)
            }
            index = match.range.last + 1
        }
    }

    private enum class Kind { CODE, AUTOLINK, IMAGE, WIKI, LINK, BOLD_ITALIC, BOLD, STRIKE, ITALIC }

    private data class InlineMatch(val kind: Kind, val match: MatchResult)

    /**
     * Earliest match wins; the candidate order breaks ties (so `***x***`
     * reads as bold-italic, not bold with a stray star). Code spans come
     * first — their content must never be styled further.
     */
    private fun nextInlineMatch(text: String, from: Int): InlineMatch? {
        val candidates = listOf(
            Kind.CODE to INLINE_CODE,
            Kind.AUTOLINK to AUTOLINK,
            Kind.IMAGE to IMAGE,
            Kind.WIKI to WIKI_LINK,
            Kind.LINK to LINK,
            Kind.BOLD_ITALIC to BOLD_ITALIC_STAR,
            Kind.BOLD_ITALIC to BOLD_ITALIC_UNDERSCORE,
            Kind.BOLD to BOLD_STAR,
            Kind.BOLD to BOLD_UNDERSCORE,
            Kind.STRIKE to STRIKETHROUGH,
            Kind.ITALIC to ITALIC_STAR,
            Kind.ITALIC to ITALIC_UNDERSCORE
        )
        var best: InlineMatch? = null
        for ((kind, regex) in candidates) {
            val match = regex.find(text, from) ?: continue
            if (best == null || match.range.first < best.match.range.first) best = InlineMatch(kind, match)
        }
        return best
    }

    private fun restore(text: String): String = buildString {
        for (char in text) {
            val offset = char - PLACEHOLDER_BASE
            append(if (offset in ESCAPABLE.indices) ESCAPABLE[offset] else char)
        }
    }
}

// --- Compose half ---

/** Relative heading sizes (h1–h6), scaled onto the surrounding text style. */
private fun headingFontSize(level: Int): TextUnit = when (level) {
    1 -> 1.7f.em
    2 -> 1.5f.em
    3 -> 1.3f.em
    4 -> 1.15f.em
    else -> 1f.em
}

/**
 * Maps the parsed span tree onto one AnnotatedString: blocks are separated
 * by a blank line, list items by a single newline. Links and wiki links
 * carry "url"/"wiki" string annotations so [MarkdownText] can make them
 * tappable. [linkColor], [codeColor] and [codeBackground] default to
 * "inherit" — the composable supplies the theme colors.
 */
fun markdownToAnnotatedString(
    blocks: List<MarkdownRenderer.MarkdownBlock>,
    linkColor: Color = Color.Unspecified,
    codeColor: Color = Color.Unspecified,
    codeBackground: Color = Color.Unspecified
): AnnotatedString = buildAnnotatedString {
    blocks.forEachIndexed { index, block ->
        writeBlock(block, linkColor, codeColor, codeBackground, linePrefix = null)
        if (index < blocks.lastIndex) append("\n\n")
    }
}

private fun AnnotatedString.Builder.writeBlock(
    block: MarkdownRenderer.MarkdownBlock,
    linkColor: Color,
    codeColor: Color,
    codeBackground: Color,
    linePrefix: String?
) {
    val prefix = linePrefix ?: ""
    when (block) {
        is MarkdownRenderer.MarkdownBlock.Paragraph -> {
            append(prefix)
            writeSpans(block.spans, linkColor, codeColor, codeBackground)
        }

        is MarkdownRenderer.MarkdownBlock.Heading -> {
            append(prefix)
            writeSpans(block.spans, linkColor, codeColor, codeBackground, fontSize = headingFontSize(block.level))
        }

        is MarkdownRenderer.MarkdownBlock.Quote -> {
            // One quote bar per child block; nested quotes stack naturally.
            block.children.forEachIndexed { index, child ->
                if (index > 0) append("\n")
                writeBlock(child, linkColor, codeColor, codeBackground, linePrefix = "│ ")
            }
        }

        is MarkdownRenderer.MarkdownBlock.MarkdownList -> block.items.forEachIndexed { index, item ->
            if (index > 0) append("\n")
            append(prefix)
            append(
                when {
                    item.checked == false -> "☐ "
                    item.checked == true -> "☒ "
                    item.ordered -> "${item.number ?: "1"}. "
                    else -> "• "
                }
            )
            writeSpans(item.spans, linkColor, codeColor, codeBackground)
        }

        is MarkdownRenderer.MarkdownBlock.CodeBlock -> {
            append(prefix)
            pushStyle(
                SpanStyle(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 0.9f.em,
                    background = codeBackground,
                    color = codeColor
                )
            )
            append(block.text)
            pop()
        }

        MarkdownRenderer.MarkdownBlock.Rule -> {
            append(prefix)
            append("────────────────────────")
        }
    }
}

private fun AnnotatedString.Builder.writeSpans(
    spans: List<MarkdownRenderer.InlineSpan>,
    linkColor: Color,
    codeColor: Color,
    codeBackground: Color,
    fontSize: TextUnit? = null
) {
    spans.forEach { span ->
        pushStyle(
            SpanStyle(
                fontWeight = if (span.bold) FontWeight.Bold else null,
                fontStyle = if (span.italic) FontStyle.Italic else null,
                textDecoration = when {
                    span.strikethrough -> TextDecoration.LineThrough
                    span.url != null -> TextDecoration.Underline
                    else -> null
                },
                fontFamily = if (span.code) FontFamily.Monospace else null,
                fontSize = fontSize ?: if (span.code) 0.9f.em else TextUnit.Unspecified,
                background = if (span.code) codeBackground else Color.Unspecified,
                color = when {
                    span.code -> codeColor
                    span.url != null || span.wikiTitle != null -> linkColor
                    else -> Color.Unspecified
                }
            )
        )
        if (span.url != null) pushStringAnnotation("url", span.url)
        if (span.wikiTitle != null) pushStringAnnotation("wiki", span.wikiTitle)
        append(span.text)
        if (span.wikiTitle != null) pop()
        if (span.url != null) pop()
        pop()
    }
}

/**
 * Rendered note body: tappable links and wiki links surface through the two
 * callbacks — the editor opens URLs in a Custom Tab and resolves a wiki
 * title against the cached notes to swap the pane.
 */
@Composable
fun MarkdownText(
    blocks: List<MarkdownRenderer.MarkdownBlock>,
    modifier: Modifier = Modifier,
    onOpenUrl: (String) -> Unit = {},
    onOpenWiki: (String) -> Unit = {}
) {
    val linkColor = MaterialTheme.colorScheme.primary
    val codeColor = MaterialTheme.colorScheme.onSurfaceVariant
    val codeBackground = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)
    val text = remember(blocks, linkColor, codeColor, codeBackground) {
        markdownToAnnotatedString(blocks, linkColor, codeColor, codeBackground)
    }
    ClickableText(
        text = text,
        style = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
        modifier = modifier
    ) { offset ->
        val url = text.getStringAnnotations("url", offset, offset).firstOrNull()?.item
        if (url != null) {
            onOpenUrl(url)
        } else {
            text.getStringAnnotations("wiki", offset, offset).firstOrNull()?.let { onOpenWiki(it.item) }
        }
    }
}
