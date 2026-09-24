package com.keeplocal.android.util

/**
 * Detects bare http(s)/www URLs inside note text (v1.8.0 Nr. 6) and wiki
 * links (`[[Titel]]`, v1.18.0) so the viewer can make them tappable. Pure,
 * unit-tested; the UI turns each range into a clickable AnnotatedString span.
 */
object NoteLinkDetector {

    /** Bare URL chars: no whitespace and no common delimiters (parens stay —
     *  Wikipedia-style URLs contain them and the trailing-paren heuristic in
     *  [find] sorts prose parens from URL parens). */
    private val URL_PATTERN = Regex("""\b(?:https?://|www\.)[^\s<>"{}|\\^`\[\]]+""")

    /** Wiki link syntax (v1.10.0): `[[Ziel]]` anywhere in the content.
     *  Internal so [MarkdownRenderer] scans with the same pattern. */
    internal val WIKI_PATTERN = Regex("""\[\[([^\[\]\n]+)]]""")

    /** Trailing punctuation that belongs to the sentence, not the URL. */
    private const val TRAILING_NOISE = ".,;:!?)]}'\">"

    data class Link(val url: String, val start: Int, val end: Int) {
        val range: IntRange get() = start until end
        /** Openable URL — "www." links get the https scheme prefixed. */
        val target: String get() = if (url.startsWith("http", ignoreCase = true)) url else "https://$url"
    }

    fun find(text: String): List<Link> = URL_PATTERN.findAll(text).map { match ->
        var raw = match.value
        while (raw.length > 4 && raw.last() in TRAILING_NOISE) {
            val candidate = raw.dropLast(1)
            // Keep a closing paren when an unmatched opener sits inside the URL
            // ("…/Foo_(bar)" stays intact); without one the paren is prose.
            if (raw.last() == ')' && candidate.count { it == '(' } > candidate.count { it == ')' }) break
            raw = candidate
        }
        Link(url = raw, start = match.range.first, end = match.range.first + raw.length)
    }.filter { it.url.length > 4 }.toList()

    /** One `[[Titel]]` occurrence; [title] is the trimmed target note title. */
    data class WikiLink(val title: String, val start: Int, val end: Int) {
        val range: IntRange get() = start until end
    }

    fun findWikiLinks(text: String): List<WikiLink> = WIKI_PATTERN.findAll(text).map { match ->
        WikiLink(title = match.groupValues[1].trim(), start = match.range.first, end = match.range.last + 1)
    }.filter { it.title.isNotEmpty() }.toList()
}
