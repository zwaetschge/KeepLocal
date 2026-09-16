package com.keeplocal.android.util

import android.content.Context
import com.keeplocal.android.BuildConfig
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Debug-only file logger. Every write is suppressed in release builds, and
 * even in debug builds PII must be redacted before it reaches a log line:
 * use [redactEmail]/[redact] at the call site, with the automatic email
 * masking in [log] as a safety net. Passwords are never logged at all.
 */
@Singleton
class FileLogger @Inject constructor(
    @ApplicationContext private val context: Context
) {
    private val logFile: File? by lazy {
        // Release builds never touch (or create) the log file.
        if (!BuildConfig.DEBUG) return@lazy null
        // Use external app-specific directory: Android/data/com.keeplocal.android/files/
        // Accessible via file manager without root
        val externalDir = context.getExternalFilesDir(null)
        val dir = externalDir ?: context.filesDir
        File(dir, "keeplocal-debug.log").also { file ->
            if (!file.exists()) file.createNewFile()
            trimIfNeeded(file)
        }
    }

    private val dateFormat = SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS", Locale.US)

    fun log(tag: String, message: String) {
        if (!BuildConfig.DEBUG) return
        try {
            val file = logFile ?: return
            val timestamp = dateFormat.format(Date())
            file.appendText("[$timestamp] $tag: ${redactEmails(message)}\n")
            trimIfNeeded(file)
            android.util.Log.d(tag, message)
        } catch (_: Exception) {}
    }

    fun error(tag: String, message: String, throwable: Throwable? = null) {
        if (!BuildConfig.DEBUG) return
        try {
            val file = logFile ?: return
            val timestamp = dateFormat.format(Date())
            val line = buildString {
                append("[$timestamp] ERROR $tag: ${redactEmails(message)}\n")
                if (throwable != null) {
                    append("  Exception: ${throwable.javaClass.simpleName}: ${throwable.message}\n")
                    throwable.stackTrace.take(5).forEach { append("    at $it\n") }
                }
            }
            file.appendText(line)
            trimIfNeeded(file)
            android.util.Log.e(tag, message, throwable)
        } catch (_: Exception) {}
    }

    fun getLogContent(): String = try {
        if (BuildConfig.DEBUG) logFile?.readText().orEmpty() else ""
    } catch (_: Exception) { "" }

    fun file(): File? = logFile

    fun clear() {
        if (!BuildConfig.DEBUG) return
        try { logFile?.writeText("") } catch (_: Exception) {}
    }

    /** Rotation: once the file passes 1 MB keep only the newest 1000 lines. */
    private fun trimIfNeeded(file: File) {
        if (file.length() > MAX_LOG_BYTES) {
            val trimmed = file.readLines().takeLast(1000)
            file.writeText(trimmed.joinToString("\n") + "\n")
        }
    }

    companion object {
        private const val MAX_LOG_BYTES = 1_000_000L

        @Volatile
        private var instance: FileLogger? = null

        fun init(context: Context) {
            if (instance == null) {
                synchronized(this) {
                    if (instance == null) {
                        instance = FileLogger(context.applicationContext)
                    }
                }
            }
        }

        fun get(): FileLogger? = instance

        private val EMAIL_REGEX = Regex("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}")

        /**
         * Masks a single email for logging: the local part is cut down to its
         * first character, the domain stays intact for debugging
         * ("j***@example.com").
         */
        fun redactEmail(email: String): String {
            val separator = email.lastIndexOf('@')
            if (separator <= 0) return "***"
            val localPart = email.substring(0, separator)
            val domain = email.substring(separator)
            return "${localPart.first()}***$domain"
        }

        /** Masks every email-looking token inside an arbitrary message. */
        private fun redactEmails(message: String): String =
            EMAIL_REGEX.replace(message) { redactEmail(it.value) }

        /**
         * Redacts free-text user input such as a search query: only the
         * length is logged, never the content.
         */
        fun redact(query: String): String =
            if (query.isBlank()) "search[empty]" else "search[len=${query.length}]"
    }
}
