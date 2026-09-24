package com.keeplocal.android.util

import com.keeplocal.android.util.MarkdownRenderer.MarkdownBlock
import com.keeplocal.android.util.MarkdownRenderer.InlineSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownRendererTest {

    private fun paragraph(block: MarkdownBlock): MarkdownBlock.Paragraph = block as MarkdownBlock.Paragraph

    private fun singleSpan(block: MarkdownBlock): InlineSpan = paragraph(block).spans.single()

    @Test
    fun `empty source yields no blocks`() {
        assertTrue(MarkdownRenderer.parseMarkdown("").isEmpty())
    }

    @Test
    fun `blank lines only yield no blocks`() {
        assertTrue(MarkdownRenderer.parseMarkdown("\n   \n\n").isEmpty())
    }

    @Test
    fun `crlf line endings are normalized`() {
        val blocks = MarkdownRenderer.parseMarkdown("Zeile eins\r\nZeile zwei")

        assertEquals(1, blocks.size)
        assertEquals("Zeile eins\nZeile zwei", singleSpan(blocks[0]).text)
    }

    @Test
    fun `plain paragraph keeps single line breaks like gfm breaks`() {
        val blocks = MarkdownRenderer.parseMarkdown("Zeile eins\nZeile zwei\n\nNeuer Absatz")

        assertEquals(2, blocks.size)
        assertEquals("Zeile eins\nZeile zwei", singleSpan(blocks[0]).text)
        assertEquals("Neuer Absatz", singleSpan(blocks[1]).text)
    }

    @Test
    fun `atx headings from level 1 to 6`() {
        val blocks = MarkdownRenderer.parseMarkdown("# Eins\n###### Sechs")

        assertEquals(2, blocks.size)
        assertEquals(1, (blocks[0] as MarkdownBlock.Heading).level)
        assertEquals("Eins", (blocks[0] as MarkdownBlock.Heading).spans.single().text)
        assertEquals(6, (blocks[1] as MarkdownBlock.Heading).level)
    }

    @Test
    fun `trailing hashes are stripped from headings`() {
        val blocks = MarkdownRenderer.parseMarkdown("## Titel ##")

        val heading = blocks.single() as MarkdownBlock.Heading
        assertEquals(2, heading.level)
        assertEquals("Titel", heading.spans.single().text)
    }

    @Test
    fun `hash without a space stays a paragraph`() {
        val blocks = MarkdownRenderer.parseMarkdown("#tag ohne Leerzeichen")

        assertEquals("#tag ohne Leerzeichen", singleSpan(blocks.single()).text)
    }

    @Test
    fun `heading ends the paragraph before it`() {
        val blocks = MarkdownRenderer.parseMarkdown("Text\n# Head")

        assertEquals(2, blocks.size)
        assertEquals("Text", singleSpan(blocks[0]).text)
        assertTrue(blocks[1] is MarkdownBlock.Heading)
    }

    @Test
    fun `bold italic and code spans are styled`() {
        val blocks = MarkdownRenderer.parseMarkdown("**fett** und *kursiv* und `code`")

        val spans = paragraph(blocks.single()).spans
        assertEquals(5, spans.size)
        assertEquals("fett", spans[0].text)
        assertTrue(spans[0].bold)
        assertEquals(" und ", spans[1].text)
        assertFalse(spans[1].bold)
        assertEquals("kursiv", spans[2].text)
        assertTrue(spans[2].italic)
        assertEquals("code", spans[4].text)
        assertTrue(spans[4].code)
    }

    @Test
    fun `bold italic combination carries both flags`() {
        val blocks = MarkdownRenderer.parseMarkdown("***beides***")

        val span = singleSpan(blocks.single())
        assertEquals("beides", span.text)
        assertTrue(span.bold)
        assertTrue(span.italic)
    }

    @Test
    fun `unclosed markers stay literal`() {
        val blocks = MarkdownRenderer.parseMarkdown("**fett *kursiv `code")

        val span = singleSpan(blocks.single())
        assertEquals("**fett *kursiv `code", span.text)
        assertFalse(span.bold)
        assertFalse(span.italic)
        assertFalse(span.code)
    }

    @Test
    fun `intraword underscore is not italic`() {
        val blocks = MarkdownRenderer.parseMarkdown("foo_bar_baz")

        val span = singleSpan(blocks.single())
        assertEquals("foo_bar_baz", span.text)
        assertFalse(span.italic)
    }

    @Test
    fun `inline code protects markup inside`() {
        val blocks = MarkdownRenderer.parseMarkdown("`*nicht* **kursiv**`")

        val span = singleSpan(blocks.single())
        assertEquals("*nicht* **kursiv**", span.text)
        assertTrue(span.code)
    }

    @Test
    fun `fenced code block keeps content literally`() {
        val blocks = MarkdownRenderer.parseMarkdown("```js\nlet a = 1\nlet b = 2\n```")

        val code = blocks.single() as MarkdownBlock.CodeBlock
        assertEquals("js", code.language)
        assertEquals("let a = 1\nlet b = 2", code.text)
    }

    @Test
    fun `unclosed fence runs to the end`() {
        val blocks = MarkdownRenderer.parseMarkdown("```\nZeile a\nZeile b")

        val code = blocks.single() as MarkdownBlock.CodeBlock
        assertEquals("", code.language)
        assertEquals("Zeile a\nZeile b", code.text)
    }

    @Test
    fun `unordered and ordered list items are one list`() {
        val blocks = MarkdownRenderer.parseMarkdown("- eins\n* zwei\n1. erster\n2) zweiter")

        val list = blocks.single() as MarkdownBlock.MarkdownList
        assertEquals(4, list.items.size)
        assertFalse(list.items[0].ordered)
        assertEquals("eins", list.items[0].spans.single().text)
        assertFalse(list.items[1].ordered)
        assertTrue(list.items[2].ordered)
        assertEquals("1", list.items[2].number)
        assertTrue(list.items[3].ordered)
        assertEquals("2", list.items[3].number)
    }

    @Test
    fun `blank line ends the list`() {
        val blocks = MarkdownRenderer.parseMarkdown("- eins\n\nText danach")

        assertEquals(2, blocks.size)
        assertEquals(1, (blocks[0] as MarkdownBlock.MarkdownList).items.size)
        assertEquals("Text danach", singleSpan(blocks[1]).text)
    }

    @Test
    fun `continuation lines join the previous item`() {
        val blocks = MarkdownRenderer.parseMarkdown("- eins\nFortsetzung\n- zwei")

        val list = blocks.single() as MarkdownBlock.MarkdownList
        assertEquals(2, list.items.size)
        assertEquals("eins\nFortsetzung", list.items[0].spans.single().text)
        assertEquals("zwei", list.items[1].spans.single().text)
    }

    @Test
    fun `checkbox items carry their checked state`() {
        val blocks = MarkdownRenderer.parseMarkdown("- [ ] offen\n- [x] fertig")

        val list = blocks.single() as MarkdownBlock.MarkdownList
        assertEquals(false, list.items[0].checked)
        assertEquals("offen", list.items[0].spans.single().text)
        assertEquals(true, list.items[1].checked)
        assertEquals("fertig", list.items[1].spans.single().text)
    }

    @Test
    fun `blockquote content is parsed recursively`() {
        val blocks = MarkdownRenderer.parseMarkdown("> # Titel\n> Text mit **Fett**")

        val quote = blocks.single() as MarkdownBlock.Quote
        assertEquals(2, quote.children.size)
        assertEquals("Titel", (quote.children[0] as MarkdownBlock.Heading).spans.single().text)
        val paragraph = quote.children[1] as MarkdownBlock.Paragraph
        assertEquals("Text mit ", paragraph.spans[0].text)
        assertEquals("Fett", paragraph.spans[1].text)
        assertTrue(paragraph.spans[1].bold)
    }

    @Test
    fun `horizontal rules in the three flavors`() {
        val blocks = MarkdownRenderer.parseMarkdown("---\nText\n***\n- - -")

        assertEquals(4, blocks.size)
        assertTrue(blocks[0] is MarkdownBlock.Rule)
        assertTrue(blocks[1] is MarkdownBlock.Paragraph)
        assertTrue(blocks[2] is MarkdownBlock.Rule)
        assertTrue(blocks[3] is MarkdownBlock.Rule)
    }

    @Test
    fun `links carry their target`() {
        val blocks = MarkdownRenderer.parseMarkdown("[Google](https://google.de)")

        val span = singleSpan(blocks.single())
        assertEquals("Google", span.text)
        assertEquals("https://google.de", span.url)
    }

    @Test
    fun `link titles are tolerated`() {
        val blocks = MarkdownRenderer.parseMarkdown("[x](https://a.b \"Titel\")")

        assertEquals("https://a.b", singleSpan(blocks.single()).url)
    }

    @Test
    fun `bold inside a link inherits the target`() {
        val blocks = MarkdownRenderer.parseMarkdown("[**fett**](https://x.de)")

        val span = singleSpan(blocks.single())
        assertEquals("fett", span.text)
        assertTrue(span.bold)
        assertEquals("https://x.de", span.url)
    }

    @Test
    fun `unclosed link stays literal`() {
        val blocks = MarkdownRenderer.parseMarkdown("[Text ohne Ziel]")

        assertEquals("[Text ohne Ziel]", singleSpan(blocks.single()).text)
    }

    @Test
    fun `wiki links carry the target title`() {
        val blocks = MarkdownRenderer.parseMarkdown("siehe [[Ziel Notiz]] bitte")

        val spans = paragraph(blocks.single()).spans
        assertEquals(3, spans.size)
        assertEquals("Ziel Notiz", spans[1].text)
        assertEquals("Ziel Notiz", spans[1].wikiTitle)
        assertEquals("siehe ", spans[0].text)
    }

    @Test
    fun `images become tappable alt text`() {
        val blocks = MarkdownRenderer.parseMarkdown("![Alternativ](https://x.de/b.png)")

        val span = singleSpan(blocks.single())
        assertEquals("Alternativ", span.text)
        assertEquals("https://x.de/b.png", span.url)
    }

    @Test
    fun `angle bracket autolinks become links`() {
        val blocks = MarkdownRenderer.parseMarkdown("<https://example.com/pfad>")

        val span = singleSpan(blocks.single())
        assertEquals("https://example.com/pfad", span.text)
        assertEquals("https://example.com/pfad", span.url)
    }

    @Test
    fun `strikethrough is detected`() {
        val blocks = MarkdownRenderer.parseMarkdown("~~weg damit~~")

        val span = singleSpan(blocks.single())
        assertEquals("weg damit", span.text)
        assertTrue(span.strikethrough)
    }

    @Test
    fun `escaped markers stay literal`() {
        val blocks = MarkdownRenderer.parseMarkdown("\\*kein kursiv\\* und \\[kein Link](x)")

        val span = singleSpan(blocks.single())
        assertEquals("*kein kursiv* und [kein Link](x)", span.text)
        assertFalse(span.italic)
    }

    @Test
    fun `wiki link inside bold keeps both`() {
        val blocks = MarkdownRenderer.parseMarkdown("**[[Ziel]]**")

        val span = singleSpan(blocks.single())
        assertEquals("Ziel", span.text)
        assertTrue(span.bold)
        assertEquals("Ziel", span.wikiTitle)
    }
    // --- v1.18.0-Review: URLs, Escapes, Listengrenzen ---

    @Test
    fun `balanced parentheses in urls survive whole`() {
        val blocks = MarkdownRenderer.parseMarkdown("[Wien](https://de.wikipedia.org/wiki/Wien_(Bundesland))")

        assertEquals("https://de.wikipedia.org/wiki/Wien_(Bundesland)", singleSpan(blocks[0]).url)
    }

    @Test
    fun `escaped characters are restored in link targets`() {
        val blocks = MarkdownRenderer.parseMarkdown("[Report](http://server/Final\\(v2\\).pdf)")

        assertEquals("http://server/Final(v2).pdf", singleSpan(blocks[0]).url)
    }

    @Test
    fun `escaped characters are restored in wiki titles`() {
        val blocks = MarkdownRenderer.parseMarkdown("[[C\\+\\+ Notizen]]")

        assertEquals("C++ Notizen", singleSpan(blocks[0]).wikiTitle)
    }

    @Test
    fun `a heading after a list item terminates the list`() {
        val blocks = MarkdownRenderer.parseMarkdown("- Milch\n## Rezept\n- Brot")

        assertEquals(3, blocks.size)
        val list = blocks[0] as MarkdownBlock.MarkdownList
        assertEquals(1, list.items.size)
        assertEquals("Milch", list.items[0].spans.single().text)
        assertEquals(2, (blocks[1] as MarkdownBlock.Heading).level)
        assertEquals("Rezept", (blocks[1] as MarkdownBlock.Heading).spans.single().text)
        assertEquals(1, (blocks[2] as MarkdownBlock.MarkdownList).items.size)
    }

    @Test
    fun `a fenced code block after a list item terminates the list`() {
        val blocks = MarkdownRenderer.parseMarkdown("- eins\n```\ncode\n```")

        assertEquals(2, blocks.size)
        assertEquals(1, (blocks[0] as MarkdownBlock.MarkdownList).items.size)
        assertTrue(blocks[1] is MarkdownBlock.CodeBlock)
    }
}
