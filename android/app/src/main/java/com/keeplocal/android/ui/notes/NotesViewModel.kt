package com.keeplocal.android.ui.notes

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.SyncManager
import com.keeplocal.android.data.local.SyncStatus
import com.keeplocal.android.domain.model.FolderScope
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteTreeNode
import com.keeplocal.android.domain.model.NoteTypeFilter
import com.keeplocal.android.domain.model.SavedSearch
import com.keeplocal.android.domain.model.SortMode
import com.keeplocal.android.domain.usecase.auth.GetCurrentUserUseCase
import com.keeplocal.android.domain.usecase.friends.GetFriendsUseCase
import com.keeplocal.android.domain.usecase.notes.DeleteNoteUseCase
import com.keeplocal.android.domain.usecase.notes.DuplicateNoteUseCase
import com.keeplocal.android.domain.usecase.notes.FindOrCreateTodayNoteUseCase
import com.keeplocal.android.domain.usecase.notes.GetNoteTreeUseCase
import com.keeplocal.android.domain.usecase.notes.GetNotesUseCase
import com.keeplocal.android.domain.usecase.notes.MoveNoteUseCase
import com.keeplocal.android.domain.usecase.notes.ReorderNotesUseCase
import com.keeplocal.android.domain.usecase.notes.ToggleArchiveUseCase
import com.keeplocal.android.domain.usecase.notes.TogglePinUseCase
import com.keeplocal.android.domain.usecase.notes.UndoDeleteUseCase
import com.keeplocal.android.domain.usecase.notes.UpdateNoteUseCase
import com.keeplocal.android.util.IncomingIntents
import com.keeplocal.android.util.Result
import com.keeplocal.android.util.UiState
import com.keeplocal.android.widget.NoteWidget
import com.keeplocal.android.widget.PinnedNotesWidget
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val SEARCH_DEBOUNCE_MS = 300L

/** Presentation of the note collection — mirrors the WebUI grid/list switch. */
enum class NoteViewMode {
    GRID, LIST;

    val key: String get() = if (this == LIST) "list" else "grid"

    companion object {
        fun fromKey(key: String?): NoteViewMode = if (key == "list") LIST else GRID
    }
}

/** What the sync banner above the note list should show. */
sealed interface SyncBanner {
    object None : SyncBanner
    data class Syncing(val pending: Int) : SyncBanner
    data class Failed(val count: Int) : SyncBanner
    object AuthRequired : SyncBanner
}

data class NotesScreenState(
    val notes: UiState<List<Note>> = UiState.Loading,
    val searchQuery: String = "",
    /** Type restriction while searching (v1.9.0 Nr. 7); ALL = no clause. */
    val typeFilter: NoteTypeFilter = NoteTypeFilter.ALL,
    val selectedTag: String? = null,
    val showArchived: Boolean = false,
    val selectedNoteIds: Set<String> = emptySet(),
    val isMultiSelectMode: Boolean = false,
    val isRefreshing: Boolean = false,
    val availableTags: List<String> = emptyList(),
    val viewMode: NoteViewMode = NoteViewMode.GRID,
    val snackbarMessage: String? = null,
    val syncBanner: SyncBanner = SyncBanner.None,
    val syncConflicts: List<String> = emptyList(),
    /** Note deleted moments ago, offered as "Undo" in the snackbar. */
    val undoableNote: Note? = null,
    /** Note currently being dragged (index 0) and the id it hovers over. */
    val draggingNoteId: String? = null,
    val dragOverNoteId: String? = null,
    // Owner badge (v1.6.0 Nr. 10): own id + resolved owner usernames.
    val currentUserId: String? = null,
    val ownerNames: Map<String, String> = emptyMap(),
    /** One-shot "focus the search field" (launcher shortcut "Suche"). */
    val searchFocusRequest: Boolean = false,
    /** Recent search terms, most recent first (v1.7.0 design round). */
    val recentSearches: List<String> = emptyList(),
    // v1.8.0: sort mode + windowed loading for large libraries.
    /** Active sort; MANUAL keeps the drag-reorder pinned/others layout. */
    val sortMode: SortMode = SortMode.MANUAL,
    /** How many notes the current window shows; grows via loadMore(). */
    val listLimit: Int = NotesViewModel.PAGE_SIZE,
    /** True when the cache likely holds more notes beyond the window. */
    val hasMore: Boolean = false,
    /** Wall-clock time of the last successful server sync (0 = never). */
    val lastSyncAt: Long = 0L,
    // --- v1.10.0 ---
    /** Folder node the grid is scoped to; All = unscoped, Root = top level. */
    val folderScope: FolderScope = FolderScope.All,
    /** Whole live library as a tree — the sidebar panel's source. */
    val noteTree: List<NoteTreeNode> = emptyList(),
    /** Expanded tree nodes; collapsed elsewhere. */
    val expandedFolderIds: Set<String> = emptySet(),
    /** Per-account tag palette (tag name → hex). */
    val tagColors: Map<String, String> = emptyMap(),
    /** Per-account saved searches (smart folders). */
    val savedSearches: List<SavedSearch> = emptyList(),
    /** Note the move picker is open for; null while closed or bulk-moving. */
    val movePickerFor: String? = null,
    /** True while the picker shows — a bulk move carries a null movePickerFor. */
    val movePickerOpen: Boolean = false,
    /** Picker contents: candidate parents with their depth for indentation. */
    val moveCandidates: List<Pair<Note, Int>> = emptyList()
)

@HiltViewModel
class NotesViewModel @Inject constructor(
    private val getNotesUseCase: GetNotesUseCase,
    private val togglePinUseCase: TogglePinUseCase,
    private val toggleArchiveUseCase: ToggleArchiveUseCase,
    private val deleteNoteUseCase: DeleteNoteUseCase,
    private val updateNoteUseCase: UpdateNoteUseCase,
    private val reorderNotesUseCase: ReorderNotesUseCase,
    private val undoDeleteUseCase: UndoDeleteUseCase,
    private val getCurrentUserUseCase: GetCurrentUserUseCase,
    private val getFriendsUseCase: GetFriendsUseCase,
    private val duplicateNoteUseCase: DuplicateNoteUseCase,
    private val getNoteTreeUseCase: GetNoteTreeUseCase,
    private val moveNoteUseCase: MoveNoteUseCase,
    private val findOrCreateTodayNoteUseCase: FindOrCreateTodayNoteUseCase,
    private val settingsDataStore: SettingsDataStore,
    private val syncManager: SyncManager,
    @ApplicationContext private val appContext: Context
) : ViewModel() {

    private val _uiState = MutableStateFlow(NotesScreenState())
    val uiState = _uiState.asStateFlow()

    /** Navigation signal for "session expired, re-login" — collected by NotesScreen. */
    private val _reloginEvent = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val reloginEvent = _reloginEvent.asSharedFlow()

    /** "Open this note in the editor" — fired by "Heute" (journal). */
    private val _openNoteEvent = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val openNoteEvent = _openNoteEvent.asSharedFlow()

    private var loadJob: Job? = null
    private var searchJob: Job? = null

    init {
        loadNotes()
        refreshTree()
        // Tag palette + saved searches (v1.10.0): per-account, synced via
        // the preferences endpoint.
        viewModelScope.launch {
            settingsDataStore.tagColors.collect { colors ->
                _uiState.update { it.copy(tagColors = colors) }
            }
        }
        viewModelScope.launch {
            settingsDataStore.savedSearches.collect { searches ->
                _uiState.update { it.copy(savedSearches = searches) }
            }
        }
        // Launcher-shortcut "Suche": arrives via IncomingIntents while the
        // nav host brings the notes screen into view. An empty query is the
        // pure "open and focus the search field" variant.
        viewModelScope.launch {
            IncomingIntents.searchRequest.collect { query ->
                if (query != null) {
                    if (query.isNotBlank()) onSearchQueryChanged(query)
                    else _uiState.update { it.copy(searchFocusRequest = true) }
                    IncomingIntents.consumeSearchRequest()
                }
            }
        }
        // Owner badge (v1.6.0 Nr. 10): the server sends an opaque owner id —
        // resolve it against the own user id and the friends list.
        viewModelScope.launch {
            getCurrentUserUseCase().getOrNull()?.let { user ->
                _uiState.update { it.copy(currentUserId = user.id) }
            }
        }
        viewModelScope.launch {
            val friends = getFriendsUseCase().getOrNull().orEmpty()
            if (friends.isNotEmpty()) {
                _uiState.update { it.copy(ownerNames = friends.associate { it.id to it.username }) }
            }
        }
        viewModelScope.launch {
            settingsDataStore.noteViewMode.collect { key ->
                _uiState.update { it.copy(viewMode = NoteViewMode.fromKey(key)) }
            }
        }
        // Sort mode (v1.8.0 Nr. 9): persisted per device; a change re-reads the
        // window through the cache only — no server round trip needed.
        viewModelScope.launch {
            settingsDataStore.sortMode.collect { key ->
                val mode = SortMode.fromStorageKey(key)
                if (mode != _uiState.value.sortMode) {
                    _uiState.update { it.copy(sortMode = mode) }
                    startLoad(showLoading = false)
                }
            }
        }
        // "Zuletzt synchronisiert" (v1.8.0 Nr. 3): written by the repository
        // and the background worker after every successful server sync.
        viewModelScope.launch {
            settingsDataStore.lastSyncAt.collect { at ->
                _uiState.update { it.copy(lastSyncAt = at) }
            }
        }
        viewModelScope.launch {
            settingsDataStore.recentSearches.collect { recent ->
                _uiState.update { it.copy(recentSearches = recent) }
            }
        }
        viewModelScope.launch {
            var authSignalled = false
            syncManager.syncStatus.collect { status ->
                _uiState.update {
                    it.copy(syncBanner = status.toBanner(), syncConflicts = status.conflicts)
                }
                if (status.authRequired && !authSignalled) {
                    authSignalled = true
                    _reloginEvent.tryEmit(Unit)
                } else if (!status.authRequired) {
                    authSignalled = false
                }
            }
        }
    }

    fun setViewMode(mode: NoteViewMode) {
        _uiState.update { it.copy(viewMode = mode) }
        viewModelScope.launch { settingsDataStore.setNoteViewMode(mode.key) }
    }

    fun toggleViewMode() {
        setViewMode(
            if (_uiState.value.viewMode == NoteViewMode.GRID) NoteViewMode.LIST else NoteViewMode.GRID
        )
    }

    fun loadNotes() = startLoad(showLoading = true)

    fun refresh() {
        _uiState.update { it.copy(isRefreshing = true) }
        startLoad(showLoading = false)
    }

    private fun startLoad(showLoading: Boolean) {
        // Cancel any load still in flight so results of a stale filter or
        // archive view can never overwrite the current ones.
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            if (showLoading) _uiState.update { it.copy(notes = UiState.Loading) }
            val state = _uiState.value
            getNotesUseCase(
                search = state.searchQuery.ifBlank { null },
                tag = state.selectedTag,
                archived = state.showArchived,
                sortMode = state.sortMode,
                limit = state.listLimit,
                filter = state.typeFilter,
                scope = state.folderScope
            ).collect { result ->
                applyNotesResult(result)
            }
        }
    }

    private fun applyNotesResult(result: Result<List<Note>>) {
        val data = result.getOrNull()
        val errorMsg = if (result is Result.Error) result.message else null
        _uiState.update {
            it.copy(
                notes = when {
                    data == null -> UiState.Error(errorMsg ?: "Failed to load notes")
                    data.isEmpty() -> UiState.Empty
                    else -> UiState.Success(data)
                },
                isRefreshing = false,
                // Exactly one full page means there is probably more; tag
                // views come from the server unwindowed, so they never page.
                hasMore = it.selectedTag == null && (data?.size ?: 0) >= it.listLimit,
                availableTags = data?.flatMap { note -> note.tags }?.distinct()?.sorted() ?: it.availableTags
            )
        }
        // Pinned set/order may have changed — keep the home-screen widgets
        // in step with what the user just saw.
        if (data != null) viewModelScope.launch { refreshWidget() }
        // The tree follows the cache: a created folder, a delete-reparenting
        // or an offline import lands here without its own collector.
        if (data != null) refreshTree()
    }

    /**
     * Re-reads the sidebar tree (v1.10.0). Also guards the folder scope: a
     * node that vanished (deleted elsewhere, sync shrink) falls back to All
     * instead of silently showing an empty grid forever.
     */
    fun refreshTree() {
        viewModelScope.launch {
            val tree = getNoteTreeUseCase().getOrNull().orEmpty()
            _uiState.update { state ->
                val liveIds = tree.flatMapTo(mutableSetOf()) { node -> node.flatten().map { it.note.id } }
                val scopeValid = state.folderScope !is FolderScope.Node ||
                    state.folderScope.id in liveIds
                // The whole library's tags — the sidebar lists them even when
                // the visible window only carries a page. An empty tree must
                // never wipe tags the note window already produced.
                val treeTags = if (liveIds.isEmpty()) null else tree.flatMap { node -> node.flatten() }
                    .flatMapTo(mutableSetOf()) { it.note.tags }
                    .sorted()
                state.copy(
                    noteTree = tree,
                    folderScope = if (scopeValid) state.folderScope else FolderScope.All,
                    availableTags = treeTags ?: state.availableTags
                )
            }
        }
    }

    private suspend fun refreshWidget() {
        runCatching { PinnedNotesWidget.refreshAll(appContext) }
        runCatching { NoteWidget.refreshAll(appContext) }
    }

    /** Persists the sort choice (v1.8.0 Nr. 9); the collector re-reads the list. */
    fun setSortMode(mode: SortMode) {
        viewModelScope.launch { settingsDataStore.setSortMode(mode.storageKey) }
    }

    /**
     * Grows the visible window by one page and re-reads it from Room (v1.8.0
     * Nr. 4) — instant, no server round trip, and the DB flow keeps the
     * window live for later edits.
     */
    fun loadMore() {
        val state = _uiState.value
        if (!state.hasMore) return
        val newLimit = state.listLimit + PAGE_SIZE
        _uiState.update { it.copy(listLimit = newLimit) }
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            getNotesUseCase.invokeCached(
                search = state.searchQuery.ifBlank { null },
                archived = state.showArchived,
                sortMode = state.sortMode,
                limit = newLimit,
                filter = state.typeFilter,
                scope = state.folderScope
            ).collect { result -> applyNotesResult(result) }
        }
    }

    /**
     * Duplicates a note (v1.8.0 Nr. 8): "(Kopie)" suffix, unpinned, shares
     * stripped. Runs through the offline-capable create path.
     */
    fun duplicateNote(noteId: String, copyLabel: String) {
        viewModelScope.launch {
            when (val result = duplicateNoteUseCase(noteId, copyLabel)) {
                is Result.Success -> loadNotes()
                is Result.Error -> showSnackbar(result.message)
            }
        }
    }

    fun onSearchQueryChanged(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        // Debounce keystrokes: reload only once typing has paused for 300ms.
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(SEARCH_DEBOUNCE_MS)
            // A term someone actually searched for (not every keystroke) is
            // worth remembering for the recent-searches chips.
            if (query.trim().length >= 3) {
                runCatching { settingsDataStore.addRecentSearch(query) }
            }
            loadNotes()
        }
    }

    /** Clears the recent-search chips (v1.7.0 design round). */
    fun clearRecentSearches() {
        viewModelScope.launch { settingsDataStore.clearRecentSearches() }
    }

    fun onTagSelected(tag: String?) {
        _uiState.update { it.copy(selectedTag = tag, folderScope = FolderScope.All) }
        loadNotes()
    }

    // --- v1.10.0: tree scope, saved searches, journal, moves ---

    /**
     * Scopes the grid to a tree node. Selecting a folder clears tag/archive
     * views — a scope only ever narrows one dimension at a time.
     */
    fun selectFolder(scope: FolderScope) {
        if (_uiState.value.folderScope == scope && _uiState.value.showArchived.not()) {
            // Re-tap on the active folder: collapse back to everything.
            _uiState.update { it.copy(folderScope = FolderScope.All) }
        } else {
            _uiState.update { it.copy(folderScope = scope, selectedTag = null, showArchived = false) }
        }
        loadNotes()
    }

    /** Expand/collapse a tree node in the sidebar panel. */
    fun toggleFolderExpanded(folderId: String) {
        _uiState.update {
            val expanded = it.expandedFolderIds.toMutableSet()
            if (!expanded.remove(folderId)) expanded.add(folderId)
            it.copy(expandedFolderIds = expanded)
        }
    }

    /** Runs a saved search: query + type chip + tag from one tap. */
    fun applySavedSearch(search: SavedSearch) {
        _uiState.update {
            it.copy(
                searchQuery = search.query,
                typeFilter = NoteTypeFilter.fromKey(search.typeFilter),
                selectedTag = search.tag.ifBlank { null },
                folderScope = FolderScope.All,
                showArchived = false
            )
        }
        loadNotes()
    }

    /**
     * "Heute" (journal): opens today's note, creating it on first access.
     * Emits [openNoteEvent] for the editor navigation.
     */
    fun openTodayNote() {
        viewModelScope.launch {
            when (val result = findOrCreateTodayNoteUseCase()) {
                is Result.Success -> {
                    refreshTree()
                    _openNoteEvent.tryEmit(result.data.id)
                }
                is Result.Error -> showSnackbar(result.message)
            }
        }
    }

    /**
     * Opens the move picker. [noteId] null = bulk move for the current
     * selection. Candidates exclude the moved notes' own subtrees — those are
     * the cycles the repository would reject anyway.
     */
    fun beginMove(noteId: String?) {
        viewModelScope.launch {
            val movingIds = noteId?.let { setOf(it) } ?: _uiState.value.selectedNoteIds
            val flat = _uiState.value.noteTree.flatMap { it.flatten() }
            val excluded = movingIds.flatMap { subtreeIdsOf(it, flat) }.toSet() + movingIds
            val candidates = flat
                .filter { it.note.id !in excluded }
                .map { it.note to it.depth }
            _uiState.update {
                it.copy(
                    movePickerFor = noteId,
                    movePickerOpen = true,
                    moveCandidates = candidates
                )
            }
        }
    }

    /** A note's descendants, walked over the flattened tree. */
    private fun subtreeIdsOf(noteId: String, flat: List<NoteTreeNode>): List<String> {
        val childrenOf = flat.groupBy { it.note.parentId }
        val out = mutableListOf<String>()
        var frontier = childrenOf[noteId].orEmpty().map { it.note.id }
        while (frontier.isNotEmpty()) {
            out += frontier
            frontier = frontier.flatMap { childrenOf[it].orEmpty().map { c -> c.note.id } }
        }
        return out
    }

    /** Performs the pending move (single note or selection) and closes the picker. */
    fun moveTo(parentId: String?) {
        val target = _uiState.value.movePickerFor
        val selected = _uiState.value.selectedNoteIds
        if (target == null && selected.isEmpty()) {
            cancelMove()
            return
        }
        viewModelScope.launch {
            val ids = target?.let { listOf(it) } ?: selected.toList()
            var firstError: String? = null
            ids.forEach { id ->
                val result = moveNoteUseCase(id, parentId)
                if (result is Result.Error && firstError == null) firstError = result.message
            }
            _uiState.update {
                it.copy(
                    movePickerFor = null,
                    movePickerOpen = false,
                    moveCandidates = emptyList(),
                    selectedNoteIds = emptySet(),
                    isMultiSelectMode = false
                )
            }
            firstError?.let { showSnackbar(it) }
            refreshTree()
            loadNotes()
        }
    }

    fun cancelMove() {
        _uiState.update { it.copy(movePickerFor = null, movePickerOpen = false, moveCandidates = emptyList()) }
    }

    /** Restricts the visible list to one note type (v1.9.0 Nr. 7). */
    fun setTypeFilter(filter: NoteTypeFilter) {
        if (_uiState.value.typeFilter == filter) return
        _uiState.update { it.copy(typeFilter = filter) }
        loadNotes()
    }

    /** Called by the screen once the search field actually has focus. */
    fun searchFocusHandled() {
        _uiState.update { it.copy(searchFocusRequest = false) }
    }

    fun toggleArchiveView(showArchived: Boolean) {
        _uiState.update { it.copy(showArchived = showArchived, folderScope = FolderScope.All) }
        loadNotes()
    }

    fun toggleNoteSelection(noteId: String) {
        _uiState.update {
            val selected = it.selectedNoteIds.toMutableSet()
            if (selected.contains(noteId)) selected.remove(noteId) else selected.add(noteId)
            it.copy(
                selectedNoteIds = selected,
                isMultiSelectMode = selected.isNotEmpty()
            )
        }
    }

    fun clearSelection() {
        _uiState.update { it.copy(selectedNoteIds = emptySet(), isMultiSelectMode = false) }
    }

    fun togglePin(noteId: String) {
        viewModelScope.launch {
            togglePinUseCase(noteId)
            loadNotes()
        }
    }

    fun toggleArchive(noteId: String) {
        viewModelScope.launch {
            toggleArchiveUseCase(noteId)
            loadNotes()
        }
    }

    fun deleteNote(noteId: String) {
        viewModelScope.launch {
            deleteNoteUseCase(noteId)
            loadNotes()
        }
    }

    /**
     * Immediate delete without confirm dialog (Keep pattern): the snackbar
     * with "Undo" is the safety net. [note] is the snapshot from before the
     * delete so undo can restore it exactly.
     */
    fun deleteNoteWithUndo(note: Note) {
        viewModelScope.launch {
            deleteNoteUseCase(note.id)
            _uiState.update { it.copy(undoableNote = note) }
            loadNotes()
        }
    }

    fun undoDelete() {
        val note = _uiState.value.undoableNote ?: return
        viewModelScope.launch {
            undoDeleteUseCase(note)
            _uiState.update { it.copy(undoableNote = null) }
            loadNotes()
        }
    }

    fun dismissUndo() {
        _uiState.update { it.copy(undoableNote = null) }
    }

    fun archiveSelectedNotes() {
        viewModelScope.launch {
            _uiState.value.selectedNoteIds.forEach { toggleArchiveUseCase(it) }
            _uiState.update { it.copy(selectedNoteIds = emptySet(), isMultiSelectMode = false) }
            loadNotes()
        }
    }

    /** Pins or unpins the whole selection (multi-select extension). */
    fun pinSelectedNotes(pin: Boolean) {
        viewModelScope.launch {
            val selected = _uiState.value.selectedNoteIds
            (_uiState.value.notes as? UiState.Success)?.data
                ?.filter { it.id in selected && it.isPinned != pin }
                ?.forEach { togglePinUseCase(it.id) }
            _uiState.update { it.copy(selectedNoteIds = emptySet(), isMultiSelectMode = false) }
            loadNotes()
        }
    }

    /** Adds a tag to every selected note (skips notes that already have it). */
    fun tagSelectedNotes(tag: String) {
        if (tag.isBlank()) return
        viewModelScope.launch {
            val selected = _uiState.value.selectedNoteIds
            (_uiState.value.notes as? UiState.Success)?.data
                ?.filter { it.id in selected && !it.tags.contains(tag) }
                ?.forEach { note ->
                    updateNoteUseCase(note.copy(tags = note.tags + tag.trim()))
                }
            _uiState.update { it.copy(selectedNoteIds = emptySet(), isMultiSelectMode = false) }
            loadNotes()
        }
    }

    fun deleteSelectedNotes() {
        viewModelScope.launch {
            _uiState.value.selectedNoteIds.forEach { deleteNoteUseCase(it) }
            _uiState.update { it.copy(selectedNoteIds = emptySet(), isMultiSelectMode = false) }
            loadNotes()
        }
    }

    /**
     * Reorders the visible list while a drag is in progress — state only,
     * nothing persisted until commitDragReorder, so a cancelled drag simply
     * reloads.
     */
    fun previewDragReorder(orderedIds: List<String>) {
        val current = (_uiState.value.notes as? UiState.Success)?.data ?: return
        val byId = current.associateBy { it.id }
        val reordered = orderedIds.mapNotNull { byId[it] }
        if (reordered.size == current.size) {
            _uiState.update { it.copy(notes = UiState.Success(reordered)) }
        }
    }

    /** Final order after the finger lifts: persists Room + PATCHes the server. */
    fun commitDragReorder(orderedIds: List<String>) {
        _uiState.update { it.copy(draggingNoteId = null, dragOverNoteId = null) }
        viewModelScope.launch {
            reorderNotesUseCase(orderedIds)
            loadNotes()
        }
    }

    fun dragStarted(noteId: String) {
        _uiState.update { it.copy(draggingNoteId = noteId, dragOverNoteId = noteId) }
    }

    fun dragHoveringOver(noteId: String?) {
        if (noteId != null && noteId != _uiState.value.dragOverNoteId) {
            _uiState.update { it.copy(dragOverNoteId = noteId) }
        }
    }

    fun dragCancelled() {
        _uiState.update { it.copy(draggingNoteId = null, dragOverNoteId = null) }
        loadNotes()
    }

    /** Re-runs the offline queue, e.g. from the failed-sync banner action. */
    fun retrySync() {
        viewModelScope.launch {
            syncManager.syncPendingOperations()
            loadNotes()
            refreshWidget()
        }
    }

    /** Fired by the banner action and by an auth-required sync status. */
    fun requestRelogin() {
        _reloginEvent.tryEmit(Unit)
    }

    fun clearSyncConflicts() {
        _uiState.update { it.copy(syncConflicts = emptyList()) }
    }

    fun showSnackbar(message: String) {
        _uiState.update { it.copy(snackbarMessage = message) }
    }

    fun clearSnackbar() {
        _uiState.update { it.copy(snackbarMessage = null) }
    }

    companion object {
        /** Notes fetched per window; "load more" grows the list by this. */
        const val PAGE_SIZE = 60
    }

    private fun SyncStatus.toBanner(): SyncBanner = when {
        authRequired -> SyncBanner.AuthRequired
        failedCount > 0 -> SyncBanner.Failed(failedCount)
        isSyncing || pendingCount > 0 -> SyncBanner.Syncing(pendingCount)
        else -> SyncBanner.None
    }
}
