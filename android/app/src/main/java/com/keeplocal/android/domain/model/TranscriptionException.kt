package com.keeplocal.android.domain.model

/**
 * Typed transcription failure — the mobile half of the server's transcription
 * budgets (WebUI parity, Top-30 Nr. 18).
 *
 * The server refuses budget-exceeding requests with HTTP 429 plus a stable
 * `code` (TRANSCRIPTION_RATE_LIMITED, TRANSCRIPTION_DAILY_LIMIT,
 * TRANSCRIPTION_MINUTE_LIMIT, TRANSCRIPTION_BUSY) and over-long audio with
 * 413 AUDIO_TOO_LONG. Only the 429 family means "try the same recording
 * later": the client keeps the file and offers a retry. A 413 (and every
 * other failure) means the recording itself is unusable — the file is
 * dropped, exactly like the WebUI drops it.
 */
class TranscriptionException(
    val code: String?,
    message: String,
    val retryable: Boolean
) : Exception(message) {
    companion object {
        /** Server codes that are worth a retry with the same audio file. */
        val RETRYABLE_CODES = setOf(
            "TRANSCRIPTION_RATE_LIMITED",
            "TRANSCRIPTION_DAILY_LIMIT",
            "TRANSCRIPTION_MINUTE_LIMIT",
            "TRANSCRIPTION_BUSY"
        )
    }
}
