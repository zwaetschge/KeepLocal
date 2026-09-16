package com.keeplocal.android.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * The redaction helpers are the only FileLogger surface that must work in a
 * plain JVM test — everything else is debug-only file IO behind BuildConfig.
 */
class FileLoggerRedactionTest {

    @Test
    fun `redact email masks the local part`() {
        assertEquals("j***@example.com", FileLogger.redactEmail("john.doe@example.com"))
    }

    @Test
    fun `redact email keeps short local parts one character`() {
        assertEquals("a***@b.co", FileLogger.redactEmail("a@b.co"))
    }

    @Test
    fun `redact email without separator is fully masked`() {
        assertEquals("***", FileLogger.redactEmail("not-an-email"))
    }

    @Test
    fun `redact email with empty local part is fully masked`() {
        assertEquals("***", FileLogger.redactEmail("@example.com"))
    }

    @Test
    fun `redact query reports length only`() {
        assertEquals("search[len=12]", FileLogger.redact("secret query"))
    }

    @Test
    fun `redact blank query reports empty`() {
        assertEquals("search[empty]", FileLogger.redact("   "))
    }

    @Test
    fun `redact query never contains the content`() {
        val result = FileLogger.redact("my medical diary")
        assertFalse(result.contains("medical"))
        assertFalse(result.contains("diary"))
    }
}
