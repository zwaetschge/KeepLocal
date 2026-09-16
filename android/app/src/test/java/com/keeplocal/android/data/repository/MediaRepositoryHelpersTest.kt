package com.keeplocal.android.data.repository

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class MediaRepositoryHelpersTest {

    @Test
    fun `mime types map to the server's extensions`() {
        assertEquals("jpg", mimeToImageExtension("image/jpeg"))
        assertEquals("png", mimeToImageExtension("image/png"))
        assertEquals("gif", mimeToImageExtension("image/gif"))
        assertEquals("webp", mimeToImageExtension("image/webp"))
    }

    @Test
    fun `unknown or missing mime falls back to jpg`() {
        assertEquals("jpg", mimeToImageExtension("image/heic"))
        assertEquals("jpg", mimeToImageExtension(null))
        assertEquals("jpg", mimeToImageExtension(""))
    }

    @Test
    fun `language setting passes the server's ISO regex`() {
        assertEquals("de", transcriptionLanguageFor("de"))
        assertEquals("en", transcriptionLanguageFor("EN"))
        assertEquals("pt-BR", transcriptionLanguageFor("pt-br"))
        assertEquals("pt-BR", transcriptionLanguageFor("PT-BR"))
    }

    @Test
    fun `invalid or missing language means auto-detect`() {
        assertNull(transcriptionLanguageFor(null))
        assertNull(transcriptionLanguageFor(""))
        assertNull(transcriptionLanguageFor("  "))
        assertNull(transcriptionLanguageFor("deutsch"))
        assertNull(transcriptionLanguageFor("de-DE-x-formal"))
        assertNull(transcriptionLanguageFor("d"))
    }
}
