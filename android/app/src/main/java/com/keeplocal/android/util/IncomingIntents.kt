package com.keeplocal.android.util

import android.content.Intent
import android.net.Uri
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Bridge between entry intents (share target, widget, quick-settings tile)
 * and Compose navigation. MainActivity is singleTask, so cold start and
 * onNewIntent both land here; the UI collects the flows and navigates.
 */
object IncomingIntents {

    /** ACTION_SEND payload waiting to prefill the next new note. */
    data class SharedText(
        val text: String,
        val title: String?
    )

    data class CaptureRequest(val kind: String = "text", val images: List<Uri> = emptyList())
    private val _captureRequest = MutableStateFlow<CaptureRequest?>(null)
    val captureRequest: StateFlow<CaptureRequest?> = _captureRequest.asStateFlow()
    fun prepareCapture(kind: String, images: List<Uri> = emptyList()) { _captureRequest.value=CaptureRequest(kind,images) }
    fun consumeCapture() { _captureRequest.value=null }

    /** Navigation request emitted by widget/tile/launcher-shortcut taps. */
    sealed interface NavRequest {
        data object NewNote : NavRequest
        data object OpenTrash : NavRequest
        data class OpenNote(val noteId: String) : NavRequest
        data class Search(val query: String) : NavRequest
    }

    private val _sharedText = MutableStateFlow<SharedText?>(null)
    val sharedText: StateFlow<SharedText?> = _sharedText.asStateFlow()

    private val _navRequest = MutableStateFlow<NavRequest?>(null)
    val navRequest: StateFlow<NavRequest?> = _navRequest.asStateFlow()

    /**
     * Search text arriving with a [NavRequest.Search] — the notes screen
     * collects this separately, because its ViewModel (not the nav host)
     * owns the search field state.
     */
    private val _searchRequest = MutableStateFlow<String?>(null)
    val searchRequest: StateFlow<String?> = _searchRequest.asStateFlow()

    /** Feed from MainActivity.onCreate/onNewIntent — tolerates any intent. */
    fun handle(intent: Intent?) {
        when (intent?.action) {
            Intent.ACTION_SEND_MULTIPLE -> {
                if (intent.type?.startsWith("image/") == true) {
                    val images=intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM,Uri::class.java).orEmpty().filter {it.scheme=="content"}.take(25)
                    if(images.isNotEmpty()){prepareCapture("image",images);_navRequest.value=NavRequest.NewNote}
                }
            }

            Intent.ACTION_SEND -> {
                if (intent.type?.startsWith("image/") == true) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM,Uri::class.java)?.takeIf {it.scheme=="content"}?.let { prepareCapture("image",listOf(it));_navRequest.value=NavRequest.NewNote }
                }
                parseSharedText(intent)?.let {
                _sharedText.value = it
                // The share itself carries no destination — open a new note
                // so the editor can pick the text up.
                _navRequest.value = NavRequest.NewNote
            }
            }
            Intent.ACTION_VIEW -> intent.data?.lastPathSegment
                ?.takeIf { ServerContract.isServerId(it) }
                ?.let { _navRequest.value = NavRequest.OpenNote(it) }
        }
        intent?.getStringExtra(EXTRA_CAPTURE_KIND)?.takeIf {it in listOf("text","list","image","drawing")}?.let {prepareCapture(it);_navRequest.value=NavRequest.NewNote}
        if (intent?.getBooleanExtra(EXTRA_NEW_NOTE, false) == true) {
            _navRequest.value = NavRequest.NewNote
        }
        if (intent?.getBooleanExtra(EXTRA_OPEN_TRASH, false) == true) {
            _navRequest.value = NavRequest.OpenTrash
        }
        if (intent?.hasExtra(EXTRA_OPEN_NOTE_ID) == true) {
            intent.getStringExtra(EXTRA_OPEN_NOTE_ID)?.let {
                _navRequest.value = NavRequest.OpenNote(it)
            }
        }
        intent?.getStringExtra(EXTRA_SEARCH)?.takeIf { it.isNotBlank() }?.let {
            _navRequest.value = NavRequest.Search(it)
            _searchRequest.value = it
        }
        // Launcher shortcut "Suche": no query, just focus the search field.
        if (intent?.getBooleanExtra(EXTRA_OPEN_SEARCH, false) == true) {
            _navRequest.value = NavRequest.Search("")
            _searchRequest.value = ""
        }
    }

    /**
     * Pure ACTION_SEND extraction (unit-tested): text/plain only, EXTRA_TEXT
     * required; a long first line (>80 chars) is treated as content rather
     * than a title, mirroring how Keep splits shares.
     */
    fun parseSharedText(intent: Intent): SharedText? {
        if (intent.action != Intent.ACTION_SEND) return null
        if (intent.type != null && intent.type != "text/plain") return null
        val text = intent.getStringExtra(Intent.EXTRA_TEXT)?.trim().orEmpty()
        if (text.isEmpty()) return null
        val subject = intent.getStringExtra(Intent.EXTRA_SUBJECT)?.trim().orEmpty()
        val firstLine = text.lineSequence().firstOrNull().orEmpty()
        val title: String? = when {
            subject.isNotEmpty() -> subject
            firstLine.length in 1..MAX_TITLE_LENGTH && text.lines().size > 1 -> firstLine
            else -> null
        }
        return SharedText(text = text, title = title)
    }

    fun consumeSharedText() {
        _sharedText.value = null
    }

    fun consumeNavRequest() {
        _navRequest.value = null
    }

    fun consumeSearchRequest() {
        _searchRequest.value = null
    }

    const val EXTRA_CAPTURE_KIND = "keeplocal.extra.CAPTURE_KIND"
    const val EXTRA_NEW_NOTE = "keeplocal.extra.NEW_NOTE"
    const val EXTRA_OPEN_NOTE_ID = "keeplocal.extra.OPEN_NOTE_ID"
    const val EXTRA_OPEN_TRASH = "keeplocal.extra.OPEN_TRASH"
    const val EXTRA_SEARCH = "keeplocal.extra.SEARCH"
    const val EXTRA_OPEN_SEARCH = "keeplocal.extra.OPEN_SEARCH"

    private const val MAX_TITLE_LENGTH = 80
}
