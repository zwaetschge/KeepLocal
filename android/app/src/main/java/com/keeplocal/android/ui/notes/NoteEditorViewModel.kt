package com.keeplocal.android.ui.notes

import android.content.Context
import android.media.MediaRecorder
import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keeplocal.android.domain.model.Friend
import com.keeplocal.android.domain.model.LinkPreview
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.domain.model.NoteImage
import com.keeplocal.android.domain.model.SharedUser
import com.keeplocal.android.domain.model.TodoItem
import com.keeplocal.android.domain.model.TranscriptionException
import com.keeplocal.android.domain.repository.MediaLimits
import com.keeplocal.android.domain.repository.MediaRepository
import com.keeplocal.android.domain.usecase.friends.GetFriendsUseCase
import com.keeplocal.android.domain.usecase.notes.CreateNoteUseCase
import com.keeplocal.android.domain.usecase.notes.GetLinkPreviewUseCase
import com.keeplocal.android.domain.usecase.notes.GetNoteUseCase
import com.keeplocal.android.domain.usecase.notes.ShareNoteUseCase
import com.keeplocal.android.domain.usecase.notes.TogglePinUseCase
import com.keeplocal.android.domain.usecase.notes.UpdateNoteUseCase
import com.keeplocal.android.data.local.NoteDraft
import com.keeplocal.android.data.local.NoteDraftStore
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.DraftTodoItem
import com.keeplocal.android.util.IncomingIntents
import com.keeplocal.android.util.Result
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.File
import java.io.IOException
import java.time.Instant
import java.util.UUID
import javax.inject.Inject

data class NoteEditorState(
    val id: String? = null,
    val title: String = "",
    val content: String = "",
    val color: NoteColor = NoteColor.DEFAULT,
    val isPinned: Boolean = false,
    val isTodoList: Boolean = false,
    val todoItems: List<TodoItem> = emptyList(),
    val tags: List<String> = emptyList(),
    val tagInput: String = "",
    val sharedWith: List<SharedUser> = emptyList(),
    val friends: List<Friend> = emptyList(),
    val images: List<NoteImage> = emptyList(),
    val uploadingImageCount: Int = 0,
    val isRecording: Boolean = false,
    val recordingElapsedMs: Long = 0L,
    val isTranscribing: Boolean = false,
    /** Non-blocking inline hint below the attachment row (limits, save-first). */
    val mediaHint: String? = null,
    /** A recording survived a budget refusal (HTTP 429) and can be re-sent. */
    val canRetryTranscription: Boolean = false,
    val isLoading: Boolean = false,
    val isSaving: Boolean = false,
    val isLoadingFriends: Boolean = false,
    val errorMessage: String? = null,
    val isNewNote: Boolean = true,
    val hasChanges: Boolean = false,

    /** Wall-clock time of the last draft autosave; 0 = never (v1.7.0 Nr. 7). */
    val draftSavedAt: Long = 0L,
    val linkPreviews: List<LinkPreview> = emptyList(),
    val isLoadingPreview: Boolean = false,
    // Account-wide dictation switch (aiFeatures.voiceTranscription): while
    // off, the mic button is hidden rather than disabled.
    val showMic: Boolean = true,
    // Server version this edit started from (optimistic locking guard).
    val baseUpdatedAt: Instant? = null
)

private val URL_PATTERN = Regex("""https?://[^\s]+""")

// Errors shown in the editor snackbar clear themselves after this delay —
// NoteEditorScreen's Snackbar has no auto-dismiss of its own.
private const val ERROR_CLEAR_DELAY_MS = 4000L

/**
 * Appends a transcription to the note content, separated by a blank line.
 * Pure function so it can be unit tested.
 */
internal fun appendTranscription(currentContent: String, transcription: String): String {
    val trimmed = transcription.trim()
    if (trimmed.isEmpty()) return currentContent
    return if (currentContent.isBlank()) trimmed
    else currentContent.trimEnd() + "\n\n" + trimmed
}

@HiltViewModel
class NoteEditorViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val getNoteUseCase: GetNoteUseCase,
    private val createNoteUseCase: CreateNoteUseCase,
    private val updateNoteUseCase: UpdateNoteUseCase,
    private val shareNoteUseCase: ShareNoteUseCase,
    private val getFriendsUseCase: GetFriendsUseCase,
    private val togglePinUseCase: TogglePinUseCase,
    private val getLinkPreviewUseCase: GetLinkPreviewUseCase,
    private val mediaRepository: MediaRepository,
    private val settingsDataStore: SettingsDataStore,
    private val noteDraftStore: NoteDraftStore,
    @ApplicationContext private val context: Context
) : ViewModel() {

    private val _uiState = MutableStateFlow(NoteEditorState())
    val uiState = _uiState.asStateFlow()

    private val _navigateBack = MutableSharedFlow<Unit>()
    val navigateBack = _navigateBack.asSharedFlow()

    private val noteId: String? = savedStateHandle["noteId"]
    private var linkPreviewJob: Job? = null
    private var errorClearJob: Job? = null
    private val fetchedUrls = mutableSetOf<String>()
    private var isBound = false

    // --- dictation state (MediaRecorder is released eagerly on clear) ---
    private var mediaRecorder: MediaRecorder? = null
    private var recordingFile: File? = null

    /** Recording kept alive across a 429 budget refusal, awaiting a retry. */
    private var pendingTranscription: File? = null
    private var recordingStartMs: Long = 0L
    private var recordingTickJob: Job? = null

    init {
        if (noteId != null) {
            isBound = true
            loadNote(noteId)
        } else {
            // Share target (ACTION_SEND): a fresh editor pre-fills with the
            // shared text and counts it as a change, so back already saves.
            val shared = IncomingIntents.sharedText.value
            if (shared != null) {
                applySharedText(shared)
                IncomingIntents.consumeSharedText()
            } else {
                // Nothing shared — a surviving draft from a killed new-note
                // editor takes over instead.
                viewModelScope.launch { restoreDraftIfMatching(null) }
            }
        }
        observeVoiceTranscription()
        observeDraftAutosave()
    }

    /** Mic visibility follows the account-wide dictation switch. */
    private fun observeVoiceTranscription() {
        viewModelScope.launch {
            settingsDataStore.voiceTranscription.collect { enabled ->
                _uiState.update { it.copy(showMic = enabled) }
            }
        }
    }

    /**
     * Draft autosave (v1.6.0 Nr. 9): two seconds after the last edit, the
     * editor state lands in [NoteDraftStore]. Process death mid-edit then
     * loses at most the last keystrokes instead of the whole note.
     */
    private fun observeDraftAutosave() {
        viewModelScope.launch {
            uiState
                .debounce { state -> if (state.hasChanges) DRAFT_DEBOUNCE_MS else 0L }
                .collect { state ->
                    if (!state.hasChanges) return@collect
                    noteDraftStore.save(
                        NoteDraft(
                            noteId = state.id,
                            title = state.title,
                            content = state.content,
                            colorHex = state.color.hex,
                            isTodoList = state.isTodoList,
                            todoItems = state.todoItems.map { DraftTodoItem(it.text, it.isCompleted) },
                            tags = state.tags,
                            savedAt = System.currentTimeMillis()
                        )
                    )
                    // Timestamp for the subtle "draft saved" chip (v1.7.0
                    // Nr. 7); the screen fades it out after a moment.
                    _uiState.update { it.copy(draftSavedAt = System.currentTimeMillis()) }
                }
        }
    }

    /**
     * Re-applies a stored draft when it belongs to the note being edited.
     * Drafts for other notes are left alone — the user may still return to
     * them — and stale ones (older than a week) are ignored.
     */
    private suspend fun restoreDraftIfMatching(loadedNoteId: String?) {
        val draft = noteDraftStore.load() ?: return
        if (!NoteDraft.isFresh(draft, System.currentTimeMillis())) return
        if (draft.noteId != loadedNoteId) return
        _uiState.update { state ->
            state.copy(
                title = draft.title,
                content = draft.content,
                color = NoteColor.fromHex(draft.colorHex),
                isTodoList = draft.isTodoList,
                todoItems = if (draft.isTodoList && draft.todoItems.isNotEmpty()) {
                    draft.todoItems.mapIndexed { index, item ->
                        TodoItem(UUID.randomUUID().toString(), item.text, item.isCompleted, index)
                    }
                } else {
                    emptyList()
                },
                tags = draft.tags,
                hasChanges = true,
                // TODO-STR: string resource (editor_draft_restored)
                mediaHint = "Entwurf wiederhergestellt"
            )
        }
    }

    /**
     * Maps a share payload into title/content. When the title heuristic took
     * the first text line as the subject, that line is not repeated in the
     * body — the two stay in sync with the web clipper's behaviour.
     */
    private fun applySharedText(shared: IncomingIntents.SharedText) {
        val title = shared.title.orEmpty()
        val content = if (shared.title != null && shared.text.lineSequence().firstOrNull() == shared.title) {
            shared.text.lines().drop(1).joinToString("\n").trim()
        } else {
            shared.text
        }
        _uiState.update { it.copy(title = title, content = content, hasChanges = true) }
    }

    /**
     * Supplies the note id when the editor is hosted in the list-detail pane,
     * where there is no navigation argument to read. Idempotent: the first call
     * wins, so recomposition never reloads over an in-progress edit.
     */
    fun bindNoteId(id: String?) {
        if (isBound) return
        isBound = true
        if (id != null) loadNote(id)
    }

    private fun loadNote(id: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            val result = getNoteUseCase(id)
            val note = result.getOrNull()
            if (note != null) {
                _uiState.update {
                    it.copy(
                        id = note.id,
                        title = note.title,
                        content = note.content,
                        color = note.color,
                        isPinned = note.isPinned,
                        isTodoList = note.isTodoList,
                        todoItems = note.todoItems,
                        tags = note.tags,
                        sharedWith = note.sharedWith,
                        images = note.images,
                        baseUpdatedAt = note.baseUpdatedAt,
                        isLoading = false,
                        isNewNote = false
                    )
                }
                // Detect existing URLs and fetch previews
                detectAndFetchPreviews(note.content)
                // A draft surviving from a killed session beats the stored note.
                restoreDraftIfMatching(note.id)
            } else {
                setErrorMessage((result as? Result.Error)?.message ?: "Note not found")
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun loadFriends() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingFriends = true) }
            val result = getFriendsUseCase()
            val friends = result.getOrNull() ?: emptyList()
            _uiState.update { it.copy(friends = friends, isLoadingFriends = false) }
        }
    }

    fun shareWithFriend(friendId: String) {
        val noteId = _uiState.value.id ?: return
        viewModelScope.launch {
            val result = shareNoteUseCase(noteId, friendId)
            if (result.isSuccess) {
                val friend = _uiState.value.friends.find { it.id == friendId }
                if (friend != null) {
                    _uiState.update {
                        it.copy(sharedWith = it.sharedWith + SharedUser(friend.id, friend.username))
                    }
                }
            }
        }
    }

    fun unshareWithUser(userId: String) {
        val noteId = _uiState.value.id ?: return
        viewModelScope.launch {
            val result = shareNoteUseCase.unshare(noteId, userId)
            if (result.isSuccess) {
                _uiState.update {
                    it.copy(sharedWith = it.sharedWith.filter { su -> su.userId != userId })
                }
            }
        }
    }

    fun updateTitle(title: String) {
        _uiState.update { it.copy(title = title, hasChanges = true, mediaHint = null) }
    }

    fun updateContent(content: String) {
        _uiState.update { it.copy(content = content, hasChanges = true, mediaHint = null) }
        // Debounced link preview detection
        if (!_uiState.value.isTodoList) {
            linkPreviewJob?.cancel()
            linkPreviewJob = viewModelScope.launch {
                delay(1000)
                detectAndFetchPreviews(content)
            }
        }
    }

    private fun detectAndFetchPreviews(content: String) {
        val urls = URL_PATTERN.findAll(content).map { it.value }.toList()
        val newUrl = urls.firstOrNull { it !in fetchedUrls }
        if (newUrl != null) {
            fetchedUrls.add(newUrl)
            viewModelScope.launch {
                _uiState.update { it.copy(isLoadingPreview = true) }
                val result = getLinkPreviewUseCase(newUrl)
                val preview = result.getOrNull()
                if (preview != null) {
                    _uiState.update {
                        it.copy(
                            linkPreviews = it.linkPreviews + preview,
                            isLoadingPreview = false
                        )
                    }
                } else {
                    _uiState.update { it.copy(isLoadingPreview = false) }
                }
            }
        }
    }

    fun removeLinkPreview(url: String) {
        _uiState.update {
            it.copy(linkPreviews = it.linkPreviews.filter { p -> p.url != url })
        }
    }

    fun updateColor(color: NoteColor) {
        _uiState.update { it.copy(color = color, hasChanges = true) }
    }

    fun togglePin() {
        val id = _uiState.value.id
        if (id != null && !_uiState.value.isNewNote) {
            viewModelScope.launch {
                val result = togglePinUseCase(id)
                val note = result.getOrNull()
                if (note != null) {
                    _uiState.update { it.copy(isPinned = note.isPinned) }
                } else {
                    _uiState.update { it.copy(isPinned = !it.isPinned, hasChanges = true) }
                }
            }
        } else {
            _uiState.update { it.copy(isPinned = !it.isPinned, hasChanges = true) }
        }
    }

    fun toggleTodoList() {
        _uiState.update { state ->
            if (!state.isTodoList && state.todoItems.isEmpty()) {
                state.copy(
                    isTodoList = true,
                    todoItems = listOf(TodoItem(UUID.randomUUID().toString(), "", false, 0)),
                    hasChanges = true
                )
            } else {
                state.copy(isTodoList = !state.isTodoList, hasChanges = true)
            }
        }
    }

    fun updateTodoItem(index: Int, text: String) {
        _uiState.update { state ->
            val items = state.todoItems.toMutableList()
            if (index < items.size) {
                items[index] = items[index].copy(text = text)
            }
            state.copy(todoItems = items, hasChanges = true)
        }
    }

    fun toggleTodoItemCompleted(index: Int) {
        _uiState.update { state ->
            val items = state.todoItems.toMutableList()
            if (index < items.size) {
                items[index] = items[index].copy(isCompleted = !items[index].isCompleted)
            }
            state.copy(todoItems = items, hasChanges = true)
        }
    }

    fun addTodoItem() {
        _uiState.update { state ->
            val items = state.todoItems.toMutableList()
            items.add(TodoItem(UUID.randomUUID().toString(), "", false, items.size))
            state.copy(todoItems = items, hasChanges = true)
        }
    }

    fun removeTodoItem(index: Int) {
        _uiState.update { state ->
            val items = state.todoItems.toMutableList()
            if (index < items.size) items.removeAt(index)
            state.copy(todoItems = items, hasChanges = true)
        }
    }

    fun updateTagInput(input: String) {
        _uiState.update { it.copy(tagInput = input) }
    }

    fun addTag() {
        val tag = _uiState.value.tagInput.trim()
        if (tag.isNotBlank() && tag !in _uiState.value.tags) {
            _uiState.update { it.copy(tags = it.tags + tag, tagInput = "", hasChanges = true) }
        }
    }

    fun removeTag(tag: String) {
        _uiState.update { it.copy(tags = it.tags - tag, hasChanges = true) }
    }

    // --- Image attachments & dictation (both online-only, need a server note) ---

    /**
     * Handles photo picker output. Requires the note to exist on the server;
     * clamps the selection to the server-side 25-images-per-note limit and
     * reports dropped images via [NoteEditorState.mediaHint].
     */
    fun onImagesPicked(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val state = _uiState.value
        val noteId = state.id
        if (noteId == null || noteId.startsWith(OFFLINE_ID_PREFIX)) {
            // TODO-STR: string resource (media_save_note_first)
            _uiState.update { it.copy(mediaHint = "Notiz erst speichern, dann Bilder anhängen") }
            return
        }

        val allowed = MediaLimits.allowedPickCount(state.images.size, uris.size)
        val dropped = uris.size - allowed
        if (allowed <= 0) {
            // TODO-STR: string resource (media_image_limit_reached)
            _uiState.update {
                it.copy(mediaHint = "Maximal ${MediaLimits.MAX_IMAGES_PER_NOTE} Bilder pro Notiz")
            }
            return
        }

        _uiState.update {
            it.copy(
                uploadingImageCount = allowed,
                mediaHint = if (dropped > 0) {
                    // TODO-STR: string resource (media_images_dropped)
                    "$dropped weitere(s) Bild verworfen — maximal ${MediaLimits.MAX_IMAGES_PER_NOTE} pro Notiz"
                } else {
                    null
                },
                errorMessage = null
            )
        }

        viewModelScope.launch {
            val result = mediaRepository.uploadImages(noteId, uris.take(allowed))
            val updated = result.getOrNull()
            if (updated != null) {
                _uiState.update { it.copy(images = updated.images, uploadingImageCount = 0) }
            } else {
                val error = result as? Result.Error
                val message = if (error?.throwable is IOException) {
                    // TODO-STR: string resource (media_upload_offline)
                    "Bilder können nur online hochgeladen werden"
                } else {
                    // TODO-STR: string resource (media_upload_failed)
                    error?.message ?: "Bild-Upload fehlgeschlagen"
                }
                _uiState.update { it.copy(uploadingImageCount = 0) }
                setErrorMessage(message)
            }
        }
    }

    fun deleteImage(image: NoteImage) {
        val noteId = _uiState.value.id ?: return
        if (noteId.startsWith(OFFLINE_ID_PREFIX)) return
        viewModelScope.launch {
            val result = mediaRepository.deleteImage(noteId, image.filename)
            val updated = result.getOrNull()
            if (updated != null) {
                _uiState.update { it.copy(images = updated.images) }
            } else {
                // TODO-STR: string resource (media_delete_failed)
                setErrorMessage((result as? Result.Error)?.message ?: "Bild konnte nicht gelöscht werden")
            }
        }
    }

    /**
     * Mic entry point: toggles recording for saved notes; unsaved/offline
     * notes only get an explanatory hint (transcription needs the server id).
     * The caller takes care of the RECORD_AUDIO permission before calling
     * [startRecording].
     */
    fun onMicClicked() {
        val state = _uiState.value
        when {
            state.isTranscribing -> Unit
            state.isRecording -> stopRecordingAndTranscribe()
            !isTranscribable() -> _uiState.update {
                // TODO-STR: string resource (media_save_note_first)
                it.copy(mediaHint = "Notiz erst speichern, dann diktieren")
            }
            else -> startRecording()
        }
    }

    fun onRecordingPermissionDenied() {
        _uiState.update {
            // TODO-STR: string resource (media_recording_permission_denied)
            it.copy(mediaHint = "Mikrofon-Zugriff wird für Diktate benötigt")
        }
    }

    private fun isTranscribable(): Boolean {
        val id = _uiState.value.id ?: return false
        return !_uiState.value.isNewNote && !id.startsWith(OFFLINE_ID_PREFIX)
    }

    /** Starts an AAC/M4A dictation in the cache dir (16 kHz mono). */
    fun startRecording() {
        if (!isTranscribable() || _uiState.value.isRecording) return
        val file = File(context.cacheDir, "dictation_${UUID.randomUUID()}.m4a")
        try {
            val recorder = MediaRecorder(context)
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioSamplingRate(16000)
            recorder.setAudioChannels(1)
            recorder.setAudioEncodingBitRate(64000)
            recorder.setOutputFile(file.absolutePath)
            recorder.prepare()
            recorder.start()

            mediaRecorder = recorder
            recordingFile = file
            recordingStartMs = System.currentTimeMillis()
            _uiState.update { it.copy(isRecording = true, recordingElapsedMs = 0L, mediaHint = null) }

            recordingTickJob?.cancel()
            recordingTickJob = viewModelScope.launch {
                while (isActive) {
                    delay(1000)
                    _uiState.update {
                        it.copy(recordingElapsedMs = System.currentTimeMillis() - recordingStartMs)
                    }
                }
            }
        } catch (_: Exception) {
            file.delete()
            releaseRecorder()
            _uiState.update { it.copy(isRecording = false) }
            // TODO-STR: string resource (media_recording_failed)
            setErrorMessage("Aufnahme konnte nicht gestartet werden")
        }
    }

    private fun stopRecordingAndTranscribe() {
        val recorder = mediaRecorder ?: return
        val file = recordingFile
        val durationMs = System.currentTimeMillis() - recordingStartMs

        recordingTickJob?.cancel()
        recordingTickJob = null
        _uiState.update { it.copy(isRecording = false, recordingElapsedMs = 0L) }

        val stopped = runCatching { recorder.stop() }.isSuccess
        runCatching { recorder.release() }
        mediaRecorder = null
        recordingFile = null

        // Discard tap-accidents and recordings without any data.
        if (!stopped || file == null || durationMs < MIN_RECORDING_DURATION_MS ||
            !file.exists() || file.length() == 0L
        ) {
            file?.delete()
            return
        }
        transcribe(file)
    }

    private fun transcribe(file: File) {
        val noteId = _uiState.value.id
        if (noteId == null || noteId.startsWith(OFFLINE_ID_PREFIX)) {
            file.delete()
            return
        }
        // A fresh recording replaces an older kept one — only one pending retry.
        pendingTranscription?.takeIf { it != file }?.delete()
        pendingTranscription = null
        _uiState.update { it.copy(isTranscribing = true, mediaHint = null) }
        viewModelScope.launch {
            val result = mediaRepository.transcribeAudio(noteId, file)
            val transcribed = result.getOrNull()
            if (transcribed != null && transcribed.text.isNotBlank()) {
                file.delete()
                pendingTranscription = null
                _uiState.update {
                    it.copy(
                        content = appendTranscription(it.content, transcribed.text),
                        isTranscribing = false,
                        hasChanges = true,
                        canRetryTranscription = false
                    )
                }
            } else {
                val cause = (result as? Result.Error)?.throwable
                val transcriptionError = cause as? TranscriptionException
                val retryable = transcriptionError?.retryable == true
                if (retryable && file.exists()) {
                    // Budget refusal (server 429): the recording is fine — keep
                    // it and offer a retry instead of destroying the dictation.
                    pendingTranscription = file
                    _uiState.update { it.copy(isTranscribing = false, canRetryTranscription = true) }
                    setErrorMessage(transcriptionError?.message ?: "Transkription fehlgeschlagen")
                } else {
                    file.delete()
                    pendingTranscription = null
                    _uiState.update { it.copy(isTranscribing = false, canRetryTranscription = false) }
                    // TODO-STR: string resource (media_transcribe_failed)
                    setErrorMessage((result as? Result.Error)?.message ?: "Transkription fehlgeschlagen")
                }
            }
        }
    }

    /** Re-sends a recording that survived a 429 budget refusal. */
    fun retryTranscription() {
        val file = pendingTranscription ?: return
        val noteId = _uiState.value.id
        if (!file.exists() || noteId == null || noteId.startsWith(OFFLINE_ID_PREFIX)) {
            discardPendingTranscription()
            return
        }
        transcribe(file)
    }

    /** Drops a kept recording without another attempt. */
    fun discardPendingTranscription() {
        pendingTranscription?.delete()
        pendingTranscription = null
        _uiState.update { it.copy(canRetryTranscription = false, mediaHint = null) }
    }

    private fun releaseRecorder() {
        mediaRecorder?.let { recorder -> runCatching { recorder.release() } }
        mediaRecorder = null
        recordingFile = null
    }

    override fun onCleared() {
        recordingTickJob?.cancel()
        val pendingFile = recordingFile
        releaseRecorder()
        pendingFile?.delete()
        pendingTranscription?.delete()
        pendingTranscription = null
        super.onCleared()
    }

    fun save() {
        viewModelScope.launch {
            val state = _uiState.value
            if (state.title.isBlank() && state.content.isBlank() && state.todoItems.all { it.text.isBlank() }) {
                _navigateBack.emit(Unit)
                return@launch
            }

            _uiState.update { it.copy(isSaving = true) }

            val now = Instant.now()
            val note = Note(
                id = state.id ?: "",
                title = state.title,
                content = state.content,
                color = state.color,
                isPinned = state.isPinned,
                isArchived = false,
                isTodoList = state.isTodoList,
                todoItems = if (state.isTodoList) state.todoItems else emptyList(),
                tags = state.tags,
                sharedWith = state.sharedWith,
                owner = "",
                position = 0,
                createdAt = now,
                updatedAt = now,
                baseUpdatedAt = state.baseUpdatedAt,
                // Keep attachments on offline saves — the server ignores this
                // field but the local cache row is rebuilt from this note.
                images = state.images
            )

            val result = if (state.isNewNote) {
                createNoteUseCase(note)
            } else {
                updateNoteUseCase(note)
            }

            if (result.isSuccess) {
                _uiState.update { it.copy(isSaving = false, hasChanges = false) }
                noteDraftStore.clear()
                _navigateBack.emit(Unit)
            } else {
                _uiState.update { it.copy(isSaving = false) }
                setErrorMessage((result as? Result.Error)?.message ?: "Failed to save note")
            }
        }
    }

    fun saveOnBack() {
        if (_uiState.value.hasChanges) {
            save()
        }
    }

    /**
     * Shows an error in the editor snackbar and clears it automatically after
     * [ERROR_CLEAR_DELAY_MS] — NoteEditorScreen's Snackbar has no auto-dismiss
     * of its own, so without this a failure sticks over the whole session.
     */
    private fun setErrorMessage(message: String) {
        errorClearJob?.cancel()
        _uiState.update { it.copy(errorMessage = message) }
        errorClearJob = viewModelScope.launch {
            delay(ERROR_CLEAR_DELAY_MS)
            _uiState.update { if (it.errorMessage == message) it.copy(errorMessage = null) else it }
        }
    }

    companion object {
        /** Ids with this prefix exist only locally and cannot carry media. */
        const val OFFLINE_ID_PREFIX = "offline_"

        /** Recordings below this length are treated as accidental taps. */
        private const val MIN_RECORDING_DURATION_MS = 800L

        /** Typing pause after which the editor state lands in the draft store. */
        private const val DRAFT_DEBOUNCE_MS = 2000L
    }
}
