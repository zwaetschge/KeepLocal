package com.keeplocal.android.ui.notes

import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.staggeredgrid.LazyStaggeredGridLayoutInfo
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.lazy.staggeredgrid.rememberLazyStaggeredGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.ExperimentalMaterialApi
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Draw
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Label
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.ViewAgenda
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.pullrefresh.PullRefreshIndicator
import androidx.compose.material.pullrefresh.pullRefresh
import androidx.compose.material.pullrefresh.rememberPullRefreshState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Divider
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PermanentDrawerSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.FolderScope
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteTypeFilter
import com.keeplocal.android.domain.model.SortMode
import com.keeplocal.android.ui.adaptive.LayoutMode
import com.keeplocal.android.ui.adaptive.LocalAppWindowInfo
import com.keeplocal.android.ui.adaptive.isTwoPane
import com.keeplocal.android.ui.components.EmptyState
import com.keeplocal.android.ui.components.EmptyStateVariant
import com.keeplocal.android.ui.components.ShimmerNoteGrid
import com.keeplocal.android.ui.components.ShimmerNoteList
import com.keeplocal.android.util.NoteShareFormatter
import com.keeplocal.android.util.Ordering
import com.keeplocal.android.util.UiState
import kotlin.math.floor
import kotlin.math.max
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

private val SidebarWidth = 264.dp

/** Minimum readable width of a note card; the grid fits as many as this allows. */
private val MinNoteColumnWidth = 160.dp

/**
 * Below this window width the permanent sidebar starts collapsed to an icon
 * rail. An unfolded Galaxy Z Fold (~1000dp at 4:3) sits under it; a 12" tablet
 * or a desktop window sits above.
 */
private val WideSidebarBreakpoint = 1200.dp

@Composable
private fun PaneDivider() {
    @Suppress("DEPRECATION")
    Divider(
        modifier = Modifier
            .fillMaxHeight()
            .width(1.dp),
        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
    )
}

/**
 * Notes home. Picks a layout from the current window/fold posture:
 *
 * - phone (compact width, or folded cover screen): modal drawer + one pane
 * - tablet portrait (medium width): permanent sidebar + one pane
 * - tablet landscape / desktop (expanded width): sidebar + list-detail
 * - foldable half-opened: list and detail split along the hinge
 */
@Composable
fun NotesScreen(
    onNavigateToEditor: (String?, String?) -> Unit,
    onNavigateToFriends: () -> Unit,
    onNavigateToAdmin: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToTrash: () -> Unit = {},
    onNavigateToTags: () -> Unit = {},
    onNavigateToReminders: () -> Unit = {},
    onReLoginRequired: () -> Unit = {},
    viewModel: NotesViewModel = hiltViewModel()
) {
    val windowInfo = LocalAppWindowInfo.current

    // The sync layer bounced off an expired session: hand the user over to
    // the existing login flow instead of retrying into nowhere.
    LaunchedEffect(Unit) {
        viewModel.reloginEvent.collect { onReLoginRequired() }
    }

    // "Heute" (v1.10.0): the journal note was found/created — straight to
    // the editor with it.
    LaunchedEffect(Unit) {
        viewModel.openNoteEvent.collect { id -> onNavigateToEditor(id, null) }
    }

    if (windowInfo.layoutMode.isTwoPane) {
        NotesTwoPaneLayout(
            onNavigateToFriends = onNavigateToFriends,
            onNavigateToAdmin = onNavigateToAdmin,
            onNavigateToSettings = onNavigateToSettings,
            onNavigateToTrash = onNavigateToTrash,
            onNavigateToTags = onNavigateToTags,
            onNavigateToReminders = onNavigateToReminders,
            viewModel = viewModel
        )
    } else {
        NotesSinglePaneLayout(
            onNavigateToEditor = onNavigateToEditor,
            onNavigateToFriends = onNavigateToFriends,
            onNavigateToAdmin = onNavigateToAdmin,
            onNavigateToSettings = onNavigateToSettings,
            onNavigateToTrash = onNavigateToTrash,
            onNavigateToTags = onNavigateToTags,
            onNavigateToReminders = onNavigateToReminders,
            viewModel = viewModel
        )
    }
}

/* ------------------------------------------------------------------ */
/* Single pane — phone and tablet portrait                             */
/* ------------------------------------------------------------------ */

@Composable
private fun NotesSinglePaneLayout(
    onNavigateToEditor: (String?, String?) -> Unit,
    onNavigateToFriends: () -> Unit,
    onNavigateToAdmin: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToTrash: () -> Unit,
    onNavigateToTags: () -> Unit,
    onNavigateToReminders: () -> Unit,
    viewModel: NotesViewModel
) {
    val uiState by viewModel.uiState.collectAsState()
    val windowInfo = LocalAppWindowInfo.current
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val scope = rememberCoroutineScope()

    // Tablet portrait has room for the sidebar to stay on screen; a phone does not.
    val permanentSidebar = windowInfo.layoutMode == LayoutMode.TABLET_PORTRAIT

    // New notes land inside the folder the grid is scoped to (v1.10.0).
    val folderParentId = (uiState.folderScope as? FolderScope.Node)?.id

    val sidebar = @Composable {
        NotesSidebarContent(
            state = uiState,
            showLogo = true,
            onSelectNotes = {
                viewModel.selectFolder(FolderScope.Root)
                scope.launch { drawerState.close() }
            },
            onSelectArchive = {
                viewModel.onTagSelected(null)
                viewModel.toggleArchiveView(true)
                scope.launch { drawerState.close() }
            },
            onSelectTrash = {
                scope.launch { drawerState.close() }
                onNavigateToTrash()
            },
            onSelectReminders = {
                scope.launch { drawerState.close() }
                onNavigateToReminders()
            },
            onSelectTag = { tag ->
                viewModel.onTagSelected(if (uiState.selectedTag == tag) null else tag)
                scope.launch { drawerState.close() }
            },
            onNavigateToFriends = {
                scope.launch { drawerState.close() }
                onNavigateToFriends()
            },
            onNavigateToAdmin = {
                scope.launch { drawerState.close() }
                onNavigateToAdmin()
            },
            onNavigateToSettings = {
                scope.launch { drawerState.close() }
                onNavigateToSettings()
            },
            onNavigateToTags = {
                scope.launch { drawerState.close() }
                onNavigateToTags()
            },
            onSelectToday = {
                viewModel.openTodayNote()
                scope.launch { drawerState.close() }
            },
            onSelectFolder = { folderScope ->
                viewModel.selectFolder(folderScope)
                scope.launch { drawerState.close() }
            },
            onToggleFolderExpanded = viewModel::toggleFolderExpanded,
            onSelectSavedSearch = { search ->
                viewModel.applySavedSearch(search)
                scope.launch { drawerState.close() }
            }
        )
    }

    if (permanentSidebar) {
        Row(modifier = Modifier.fillMaxSize()) {
            PermanentDrawerSheet(
                modifier = Modifier.width(SidebarWidth),
                drawerContainerColor = MaterialTheme.colorScheme.surface
            ) { sidebar() }
            NotesPane(
                viewModel = viewModel,
                onOpenSettings = onNavigateToSettings,
                showMenuButton = false,
                onOpenDrawer = {},
                onOpenNote = { onNavigateToEditor(it, null) },
                onCreateNote = { onNavigateToEditor(null, folderParentId) },
                selectedNoteId = null,
                modifier = Modifier.weight(1f)
            )
        }
    } else {
        ModalNavigationDrawer(
            drawerState = drawerState,
            drawerContent = { ModalDrawerSheet { sidebar() } }
        ) {
            NotesPane(
                viewModel = viewModel,
                onOpenSettings = onNavigateToSettings,
                showMenuButton = true,
                onOpenDrawer = { scope.launch { drawerState.open() } },
                onOpenNote = { onNavigateToEditor(it, null) },
                onCreateNote = { onNavigateToEditor(null, folderParentId) },
                selectedNoteId = null
            )
        }
    }
}

/* ------------------------------------------------------------------ */
/* Two pane — tablet landscape, desktop windows and open foldables     */
/* ------------------------------------------------------------------ */

@Composable
private fun NotesTwoPaneLayout(
    onNavigateToFriends: () -> Unit,
    onNavigateToAdmin: () -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToTrash: () -> Unit,
    onNavigateToTags: () -> Unit,
    onNavigateToReminders: () -> Unit,
    viewModel: NotesViewModel
) {
    val uiState by viewModel.uiState.collectAsState()
    val windowInfo = LocalAppWindowInfo.current
    var detail by remember { mutableStateOf<EditorRequest?>(null) }
    var editorSerial by rememberSaveable { mutableStateOf(0) }
    val wideEnoughForLabels = windowInfo.widthDp >= WideSidebarBreakpoint
    var sidebarExpanded by rememberSaveable(wideEnoughForLabels) {
        mutableStateOf(wideEnoughForLabels)
    }

    BackHandler(enabled = detail != null) { detail = null }

    // Journal (v1.10.0): "Heute" opens in the detail pane here.
    LaunchedEffect(Unit) {
        viewModel.openNoteEvent.collect { id ->
            editorSerial += 1
            detail = EditorRequest(noteId = id, serial = editorSerial)
        }
    }

    val listPane = @Composable { modifier: Modifier ->
        NotesPane(
            viewModel = viewModel,
                onOpenSettings = onNavigateToSettings,
            showMenuButton = false,
            onOpenDrawer = {},
            onOpenNote = { id -> detail = EditorRequest(noteId = id, serial = editorSerial) },
            onCreateNote = {
                editorSerial += 1
                detail = EditorRequest(
                    noteId = null,
                    serial = editorSerial,
                    parentId = (uiState.folderScope as? FolderScope.Node)?.id
                )
            },
            selectedNoteId = detail?.noteId,
            modifier = modifier
        )
    }

    val detailPane = @Composable { modifier: Modifier ->
        NoteDetailPane(
            request = detail,
            onClose = {
                detail = null
                viewModel.refresh()
            },
            onOpenNote = { id ->
                editorSerial += 1
                detail = EditorRequest(noteId = id, serial = editorSerial)
            },
            modifier = modifier
        )
    }

    Row(modifier = Modifier.fillMaxSize()) {
        // The sidebar stays visible next to both panes, like the WebUI at >= 1024px.
        // Below WideSidebarBreakpoint (an unfolded foldable at 4:3, say) 264dp of
        // labels costs the editor too much room, so it starts as an icon rail.
        if (windowInfo.layoutMode == LayoutMode.TABLET_LANDSCAPE) {
            val onSelectNotes = { viewModel.selectFolder(FolderScope.Root) }
            val onSelectArchive = {
                viewModel.onTagSelected(null)
                viewModel.toggleArchiveView(true)
            }
            val onSelectTrash = { onNavigateToTrash() }
            val onSelectReminders = { onNavigateToReminders() }
            val onSelectToday = { viewModel.openTodayNote() }

            if (sidebarExpanded) {
                PermanentDrawerSheet(
                    modifier = Modifier.width(SidebarWidth),
                    drawerContainerColor = MaterialTheme.colorScheme.surface
                ) {
                    NotesSidebarContent(
                        state = uiState,
                        showLogo = true,
                        onCollapse = { sidebarExpanded = false },
                        onSelectNotes = onSelectNotes,
                        onSelectArchive = onSelectArchive,
                        onSelectTrash = onSelectTrash,
                        onSelectReminders = onSelectReminders,
                        onSelectTag = { tag ->
                            viewModel.onTagSelected(if (uiState.selectedTag == tag) null else tag)
                        },
                        onNavigateToFriends = onNavigateToFriends,
                        onNavigateToAdmin = onNavigateToAdmin,
                        onNavigateToSettings = onNavigateToSettings,
                        onNavigateToTags = onNavigateToTags,
                        onSelectToday = onSelectToday,
                        onSelectFolder = viewModel::selectFolder,
                        onToggleFolderExpanded = viewModel::toggleFolderExpanded,
                        onSelectSavedSearch = viewModel::applySavedSearch
                    )
                }
            } else {
                NotesSidebarRail(
                    state = uiState,
                    onExpand = { sidebarExpanded = true },
                    onSelectNotes = onSelectNotes,
                    onSelectArchive = onSelectArchive,
                    onSelectTrash = onSelectTrash,
                    onSelectReminders = onSelectReminders,
                    onNavigateToFriends = onNavigateToFriends,
                    onNavigateToAdmin = onNavigateToAdmin,
                    onNavigateToSettings = onNavigateToSettings,
                    onNavigateToTags = onNavigateToTags,
                    onSelectToday = onSelectToday
                )
            }

            @Suppress("DEPRECATION")
            Divider(
                modifier = Modifier
                    .fillMaxHeight()
                    .width(1.dp),
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
            )
        }

        when (windowInfo.layoutMode) {
            LayoutMode.FOLDABLE_TABLETOP -> {
                // Horizontal hinge: content above the fold, editor below it.
                Column(modifier = Modifier.fillMaxSize()) {
                    listPane(Modifier.weight(1f))
                    Spacer(modifier = Modifier.height(windowInfo.fold.hingeSize))
                    detailPane(Modifier.weight(1f))
                }
            }
            LayoutMode.FOLDABLE_BOOK -> {
                // Vertical hinge: keep each pane on its own half of the screen.
                Row(modifier = Modifier.fillMaxSize()) {
                    listPane(Modifier.weight(1f))
                    Spacer(modifier = Modifier.width(windowInfo.fold.hingeSize))
                    PaneDivider()
                    detailPane(Modifier.weight(1f))
                }
            }
            else -> {
                // The editor deserves the wider half once the list has room for
                // two comfortable note columns.
                listPane(Modifier.weight(1f))
                PaneDivider()
                detailPane(Modifier.weight(1.2f))
            }
        }
    }
}

/** Editor pane target. [serial] forces a fresh editor for each new blank note. */
data class EditorRequest(val noteId: String?, val serial: Int, val parentId: String? = null)

/* ------------------------------------------------------------------ */
/* The note list pane itself                                           */
/* ------------------------------------------------------------------ */

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterialApi::class)
@Composable
private fun NotesPane(
    viewModel: NotesViewModel,
    showMenuButton: Boolean,
    onOpenDrawer: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenNote: (String) -> Unit,
    onCreateNote: () -> Unit,
    selectedNoteId: String?,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsState()
    val windowInfo = LocalAppWindowInfo.current
    val snackbarHostState = remember { SnackbarHostState() }
    var showSearch by remember { mutableStateOf(false) }
    var showDeleteConfirm by remember { mutableStateOf<String?>(null) }
    var showTagDialog by remember { mutableStateOf(false) }
    var showExtraFilters by remember { mutableStateOf(false) }
    var showCaptureMenu by remember { mutableStateOf(false) }
    var showSelectionMenu by remember { mutableStateOf(false) }
    var showListOptions by remember { mutableStateOf(false) }
    var showSortDialog by remember { mutableStateOf(false) }
    val searchFocus = remember { FocusRequester() }
    val context = LocalContext.current

    // Teilen als Text (v1.8.0 Nr. 8): formatted like the WebUI share, then
    // straight into the system share sheet.
    fun shareNoteAsText(note: Note) {
        val text = NoteShareFormatter.plainText(note, context.getString(R.string.app_name))
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
        }
        context.startActivity(Intent.createChooser(intent, null))
    }

    // Precomputed outside the effects — stringResource is composable-only.
    val undoText = stringResource(R.string.undo)
    val noteDeletedText = stringResource(R.string.note_deleted_snackbar)

    val isListMode = uiState.viewMode == NoteViewMode.LIST

    val pullRefreshState = rememberPullRefreshState(
        refreshing = uiState.isRefreshing,
        onRefresh = viewModel::refresh
    )

    LaunchedEffect(uiState.snackbarMessage) {
        uiState.snackbarMessage?.let { message ->
            snackbarHostState.showSnackbar(message)
            viewModel.clearSnackbar()
        }
    }

    // Undo-delete: the snackbar IS the safety net, so the delete itself
    // needs no confirm dialog. Action tap restores, timeout dismisses.
    val undoableNote = uiState.undoableNote
    LaunchedEffect(undoableNote?.id, undoableNote != null) {
        if (undoableNote != null) {
            val result = snackbarHostState.showSnackbar(
                message = noteDeletedText,
                actionLabel = undoText,
                duration = SnackbarDuration.Short
            )
            if (result == SnackbarResult.ActionPerformed) viewModel.undoDelete()
            else viewModel.dismissUndo()
        }
    }

    val archivedText = stringResource(R.string.notes_archived_toast)

    // Folder breadcrumb (v1.10.0): "Projekte / 2026" while the grid is scoped
    // to a node; null outside a folder view.
    val folderBreadcrumb = remember(uiState.folderScope, uiState.noteTree) {
        val scope = uiState.folderScope as? FolderScope.Node ?: return@remember null
        val flat = uiState.noteTree.flatMap { it.flatten() }
        val byId = flat.associateBy { it.note.id }
        val chain = generateSequence(scope.id) { id ->
            byId[id]?.note?.parentId?.takeIf { it in byId }
        }.mapNotNull { byId[it]?.note?.title?.ifBlank { null } }.toList()
        if (chain.isEmpty()) null else chain.asReversed().joinToString(" / ")
    }

    // Closing the search also clears the query — the list must never stay
    // invisibly filtered behind a regular-looking title.
    fun closeSearch() {
        showSearch = false
        if (uiState.searchQuery.isNotBlank()) viewModel.onSearchQueryChanged("")
        if (uiState.typeFilter != NoteTypeFilter.ALL) viewModel.setTypeFilter(NoteTypeFilter.ALL)
    }

    // Launcher-shortcut "Suche": open the search row and drop the cursor in.
    LaunchedEffect(uiState.searchFocusRequest) {
        if (uiState.searchFocusRequest) {
            showSearch = true
            // The field only exists after the recomposition that flips
            // showSearch — wait one frame before requesting focus.
            withFrameNanos { }
            runCatching { searchFocus.requestFocus() }
            viewModel.searchFocusHandled()
        }
    }

    BackHandler(enabled = showSearch || uiState.isMultiSelectMode) {
        if (uiState.isMultiSelectMode) viewModel.clearSelection() else closeSearch()
    }
    LaunchedEffect(showSearch) {
        if (showSearch) { withFrameNanos { }; searchFocus.requestFocus() }
    }

    Scaffold(
        modifier = modifier
            .onPreviewKeyEvent { event ->
                // Hardware keyboard (tablets with keyboards, desktop mode).
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when {
                    event.isCtrlPressed && event.key == Key.N -> {
                        onCreateNote(); true
                    }
                    event.isCtrlPressed && event.key == Key.F -> {
                        showSearch = true
                        runCatching { searchFocus.requestFocus() }
                        true
                    }
                    event.key == Key.Escape -> when {
                        uiState.isMultiSelectMode -> {
                            viewModel.clearSelection(); true
                        }
                        showSearch -> {
                            closeSearch()
                            true
                        }
                        else -> false
                    }
                    else -> false
                }
            },
        containerColor = Color.Transparent,
        topBar = {
            if (uiState.isMultiSelectMode) {
                TopAppBar(
                    title = { Text("${uiState.selectedNoteIds.size}") },
                    navigationIcon = {
                        IconButton(onClick = viewModel::clearSelection) {
                            Icon(Icons.Default.Close, contentDescription = stringResource(R.string.cd_close))
                        }
                    },
                    actions = {
                        // Pin/unpin the whole selection; the icon reflects
                        // what the tap will do (pin when any is unpinned).
                        val selectedNotes = (uiState.notes as? UiState.Success)?.data
                            ?.filter { it.id in uiState.selectedNoteIds }
                            ?: emptyList()
                        val pinNext = selectedNotes.any { !it.isPinned }
                        IconButton(onClick = { viewModel.pinSelectedNotes(pinNext) }) {
                            Icon(
                                if (pinNext) Icons.Outlined.PushPin else Icons.Default.PushPin,
                                contentDescription = stringResource(
                                    if (pinNext) R.string.cd_pin_note else R.string.cd_unpin_note
                                )
                            )
                        }
                        IconButton(onClick = { showTagDialog = true }) {
                            Icon(Icons.Default.Label, contentDescription = stringResource(R.string.cd_tag_selection))
                        }
                        IconButton(onClick = viewModel::archiveSelectedNotes) {
                            Icon(Icons.Default.Archive, contentDescription = stringResource(R.string.cd_archive_note))
                        }
                        IconButton(onClick = viewModel::deleteSelectedNotes) {
                            Icon(Icons.Default.Delete, contentDescription = stringResource(R.string.cd_delete_note))
                        }
                        Box {
                            IconButton(onClick = { showSelectionMenu = true }) { Icon(Icons.Default.MoreVert, stringResource(R.string.cd_more_actions)) }
                            DropdownMenu(showSelectionMenu, { showSelectionMenu = false }) {
                                DropdownMenuItem(text = { Text(stringResource(R.string.action_move)) }, onClick = { showSelectionMenu = false; viewModel.beginMove(null) })
                                if (selectedNotes.size == 1) DropdownMenuItem(text = { Text(stringResource(R.string.action_share)) }, onClick = { showSelectionMenu = false; shareNoteAsText(selectedNotes.single()) })
                                DropdownMenuItem(text = { Text(stringResource(R.string.action_duplicate)) }, onClick = {
                                    showSelectionMenu = false
                                    selectedNotes.forEach { viewModel.duplicateNote(it.id, context.getString(R.string.duplicate_copy_label)) }
                                    viewModel.clearSelection()
                                })
                            }
                        }
                    }
                )
            } else {
                Column(Modifier.statusBarsPadding()) {
                    Surface(
                        shape = RoundedCornerShape(32.dp),
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.25f)),
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
                    ) {
                        Row(Modifier.fillMaxWidth().height(56.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (showSearch || showMenuButton) IconButton(onClick = {
                                if (showSearch) closeSearch() else onOpenDrawer()
                            }) {
                                Icon(if (showSearch) Icons.AutoMirrored.Filled.ArrowBack else Icons.Default.Menu,
                                    stringResource(if (showSearch) R.string.cd_back else R.string.cd_menu))
                            } else Spacer(Modifier.width(16.dp))
                            if (showSearch) {
                                BasicTextField(
                                    value = uiState.searchQuery,
                                    onValueChange = viewModel::onSearchQueryChanged,
                                    modifier = Modifier.weight(1f).focusRequester(searchFocus),
                                    singleLine = true,
                                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                                    cursorBrush = androidx.compose.ui.graphics.SolidColor(MaterialTheme.colorScheme.primary),
                                    decorationBox = { field ->
                                        Box {
                                            if (uiState.searchQuery.isEmpty()) Text(stringResource(R.string.notes_search), color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            field()
                                        }
                                    }
                                )
                                IconButton(onClick = { showExtraFilters = true }) {
                                    Icon(Icons.Default.Tune, stringResource(R.string.note_filters))
                                }
                                if (uiState.searchQuery.isNotEmpty()) IconButton(onClick = { viewModel.onSearchQueryChanged("") }) {
                                    Icon(Icons.Default.Close, stringResource(R.string.clear))
                                }
                            } else {
                                Surface(onClick = { showSearch = true }, color = Color.Transparent, modifier = Modifier.weight(1f)) {
                                    Box(Modifier.height(56.dp), contentAlignment = Alignment.CenterStart) {
                                        Text(stringResource(R.string.notes_search), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                                IconButton(onClick = viewModel::toggleViewMode) {
                                    Icon(if (isListMode) Icons.Default.GridView else Icons.Default.ViewAgenda,
                                        stringResource(if (isListMode) R.string.cd_view_grid else R.string.cd_view_list))
                                }
                                Box {
                                    IconButton(onClick = { showListOptions = true }) {
                                        val username = uiState.ownerNames[uiState.currentUserId]
                                        if (username.isNullOrBlank()) Icon(Icons.Default.AccountCircle, stringResource(R.string.note_account))
                                        else Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer,
                                            modifier = Modifier.size(32.dp).then(Modifier.semantics { contentDescription = username })) {
                                            Box(contentAlignment = Alignment.Center) { Text(username.take(1).uppercase(), color = MaterialTheme.colorScheme.onPrimaryContainer) }
                                        }
                                    }
                                    DropdownMenu(showListOptions, { showListOptions = false }) {
                                        uiState.ownerNames[uiState.currentUserId]?.let { username ->
                                            DropdownMenuItem(text = { Text(username) }, enabled = false, onClick = {})
                                        }
                                        DropdownMenuItem(text = { Text(stringResource(R.string.nav_settings)) }, onClick = { showListOptions = false; onOpenSettings() })
                                        DropdownMenuItem(text = { Text(stringResource(R.string.sort_label)) }, onClick = { showListOptions = false; showSortDialog = true })
                                        DropdownMenuItem(text = { Text(stringResource(R.string.note_filters)) }, onClick = { showListOptions = false; showSearch = true; showExtraFilters = true })
                                    }
                                }
                            }
                        }
                    }
                    val sectionTitle = when {
                        uiState.showArchived -> stringResource(R.string.notes_archived)
                        uiState.selectedTag != null -> uiState.selectedTag
                        folderBreadcrumb != null -> folderBreadcrumb
                        else -> null
                    }
                    if (sectionTitle != null) Text(sectionTitle, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
                    if (uiState.colorFilter != null || uiState.personFilter != null) TextButton(onClick = { viewModel.setColorFilter(null); viewModel.setPersonFilter(null) }, modifier = Modifier.padding(horizontal = 16.dp)) {
                        Text(stringResource(R.string.filters_reset))
                    }
                }
            }
        },
        floatingActionButton = {
            if (!uiState.showArchived && !uiState.isMultiSelectMode) {
                FloatingActionButton(
                    onClick = {showCaptureMenu=true},
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    shape = RoundedCornerShape(20.dp)
                ) {
                    Icon(Icons.Default.Add, contentDescription = stringResource(R.string.cd_add_note))
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        BoxWithConstraints(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .pullRefresh(pullRefreshState)
        ) {
            // Capture the pane width once: deeper lambdas (when/Box scopes)
            // can't resolve BoxWithConstraints.maxWidth via implicit receiver.
            val paneMaxWidth = this@BoxWithConstraints.maxWidth
            Column(modifier = Modifier.fillMaxSize()) {
                if (uiState.syncBanner != SyncBanner.None) {
                    SyncStatusBanner(
                        banner = uiState.syncBanner,
                        onRetry = viewModel::retrySync,
                        onReLogin = viewModel::requestRelogin
                    )
                }

                // Recent searches (v1.7.0 Nr. 6): chips while the search field
                // is open and still empty — one tap repeats a previous term.
                if (showSearch && uiState.searchQuery.isBlank() && uiState.recentSearches.isNotEmpty()) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.recent_searches),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Row(
                            modifier = Modifier
                                .weight(1f)
                                .horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            uiState.recentSearches.forEach { term ->
                                AssistChip(
                                    onClick = { viewModel.onSearchQueryChanged(term) },
                                    label = {
                                        Text(
                                            term,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                )
                            }
                        }
                        TextButton(onClick = viewModel::clearRecentSearches) {
                            Text(stringResource(R.string.clear))
                        }
                    }
                }

                // Type filter (v1.9.0 Nr. 7): chips while search is open —
                // plain notes, lists, image notes, reminders, pinned.
                if (showSearch) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 16.dp, vertical = 2.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        NoteTypeFilter.entries.forEach { filter ->
                            FilterChip(
                                selected = uiState.typeFilter == filter,
                                onClick = { viewModel.setTypeFilter(filter) },
                                label = { Text(stringResource(filter.labelRes)) }
                            )
                        }
                    }
                }

                Box(modifier = Modifier.weight(1f)) {
                    when (val notes = uiState.notes) {
                        is UiState.Loading -> if (isListMode) {
                            ShimmerNoteList(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(top = 8.dp)
                            )
                        } else {
                            ShimmerNoteGrid(
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(top = 8.dp)
                            )
                        }

                        is UiState.Empty -> when {
                            // Search with no hits gets its own scene + reset
                            // action (v1.7.0 Nr. 6 + 9).
                            uiState.searchQuery.isNotBlank() -> EmptyState(
                                variant = EmptyStateVariant.SEARCH,
                                title = stringResource(R.string.search_no_results_title),
                                subtitle = stringResource(
                                    R.string.search_no_results_subtitle,
                                    uiState.searchQuery.trim()
                                ),
                                actionLabel = stringResource(R.string.search_reset),
                                onAction = { viewModel.onSearchQueryChanged("") }
                            )
                            uiState.selectedTag != null -> EmptyState(
                                variant = EmptyStateVariant.SEARCH,
                                title = stringResource(R.string.tag_empty_title),
                                subtitle = stringResource(
                                    R.string.tag_empty_subtitle,
                                    uiState.selectedTag ?: ""
                                ),
                                actionLabel = stringResource(R.string.tag_empty_reset),
                                onAction = { viewModel.onTagSelected(null) }
                            )
                            uiState.showArchived -> EmptyState(
                                variant = EmptyStateVariant.ARCHIVE,
                                title = stringResource(R.string.archive_empty_title),
                                subtitle = stringResource(R.string.archive_empty_subtitle)
                            )
                            // Folder view without children (v1.10.0): notes for
                            // this node exist none — offer to start one inside.
                            uiState.folderScope is FolderScope.Node -> EmptyState(
                                variant = EmptyStateVariant.NOTES,
                                title = stringResource(R.string.folder_empty_title),
                                subtitle = stringResource(R.string.folder_empty_subtitle),
                                actionLabel = stringResource(R.string.folder_empty_create),
                                onAction = onCreateNote
                            )
                            else -> EmptyState(
                                variant = EmptyStateVariant.NOTES,
                                title = stringResource(R.string.notes_empty_title),
                                subtitle = stringResource(R.string.notes_empty_subtitle)
                            )
                        }

                        is UiState.Error -> Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    notes.message,
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.error
                                )
                                Spacer(modifier = Modifier.height(16.dp))
                                FilledTonalButton(onClick = viewModel::loadNotes) {
                                    Text(stringResource(R.string.retry))
                                }
                            }
                        }

                        is UiState.Success -> {
                            // Columns follow the pane's own width, not the window's: in the
                            // list-detail layout the grid only owns a slice of the screen.
                            val columnCount = if (isListMode) {
                                1
                            } else {
                                if (paneMaxWidth < 600.dp) 2 else max(2, floor(paneMaxWidth / MinNoteColumnWidth).toInt())
                            }
                            val allNotes = notes.data
                            // Explicit sorts (v1.8.0 Nr. 9) show ONE flat sequence —
                            // pin sections would fight the chosen order — and manual
                            // drag reorder only makes sense in the custom order.
                            val manualSort = uiState.sortMode == SortMode.MANUAL
                            val pinnedNotes = if (manualSort) allNotes.filter { it.isPinned } else emptyList()
                            val otherNotes = if (manualSort) allNotes.filter { !it.isPinned } else emptyList()
                            val haptic = LocalHapticFeedback.current

                            // Drag & drop manual ordering. The gesture lives on the
                            // GRID, not on the cards, so the finger position maps
                            // 1:1 onto item coordinates even while cards swap.
                            val gridState = rememberLazyStaggeredGridState()

                            // Infinite scroll (v1.8.0 Nr. 4): nearing the end of the
                            // window grows it by one page straight from Room. Both
                            // keys matter: size grows on loadMore (may STILL be near
                            // the end → load again), nearEnd flips on every scroll.
                            val nearEndOfWindow by remember {
                                derivedStateOf {
                                    val info = gridState.layoutInfo
                                    val last = info.visibleItemsInfo.lastOrNull()
                                    last != null &&
                                        last.offset.y + last.size.height <= info.viewportEndOffset + 600
                                }
                            }
                            LaunchedEffect(allNotes.size, nearEndOfWindow) {
                                if (nearEndOfWindow && uiState.hasMore) viewModel.loadMore()
                            }

                            var draggingId by remember { mutableStateOf<String?>(null) }
                            var dragMoved by remember { mutableStateOf(false) }
                            var dragFinger by remember { mutableStateOf(Offset.Zero) }
                            val orderedIds = pinnedNotes.map { it.id } + otherNotes.map { it.id }
                            val pinnedIdSet = pinnedNotes.map { it.id }.toSet()
                            // Read inside the gesture handler without restarting it
                            // (keying pointerInput on the order would cancel drags).
                            val currentOrderedIds by rememberUpdatedState(orderedIds)
                            val currentPinnedIds by rememberUpdatedState(pinnedIdSet)
                            val currentUiState by rememberUpdatedState(uiState)
                            val currentManualSort by rememberUpdatedState(manualSort)

                            LazyVerticalStaggeredGrid(
                                state = gridState,
                                columns = StaggeredGridCells.Fixed(columnCount),
                                contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 96.dp),
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalItemSpacing = 8.dp,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .pointerInput(Unit) {
                                        detectDragGesturesAfterLongPress(
                                            onDragStart = { start ->
                                                val id = noteIdAt(gridState.layoutInfo, start)
                                                if (id != null && !currentUiState.isMultiSelectMode) {
                                                    draggingId = id
                                                    dragMoved = false
                                                    dragFinger = start
                                                    haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                                                }
                                            },
                                            onDrag = { change, amount ->
                                                change.consume()
                                                val id = draggingId ?: return@detectDragGesturesAfterLongPress
                                                dragFinger += amount
                                                dragMoved = true
                                                // Reordering only exists in the custom order —
                                                // sorted views keep their chosen sequence.
                                                if (currentManualSort && !currentUiState.showArchived) {
                                                    val target = noteIdAt(gridState.layoutInfo, dragFinger)
                                                    if (target != null && target != id) {
                                                        val newOrder = Ordering.orderAfterDrop(
                                                            currentOrderedIds, id, target, currentPinnedIds
                                                        )
                                                        if (newOrder != currentOrderedIds) {
                                                            viewModel.previewDragReorder(newOrder)
                                                        }
                                                    }
                                                }
                                            },
                                            onDragEnd = {
                                                val id = draggingId
                                                draggingId = null
                                                if (id != null) {
                                                    if (dragMoved && currentManualSort && !currentUiState.showArchived) {
                                                        viewModel.commitDragReorder(currentOrderedIds)
                                                    } else if (!dragMoved) {
                                                        // Keep selects on a stationary long press; moving still reorders.
                                                        viewModel.toggleNoteSelection(id)
                                                    }
                                                }
                                            },
                                            onDragCancel = {
                                                if (draggingId != null && dragMoved) viewModel.dragCancelled()
                                                draggingId = null
                                            }
                                        )
                                    }
                            ) {
                                val noteItem: @Composable (Note) -> Unit = { note ->
                                    DraggableNoteCard(isDragged = note.id == draggingId) {
                                        AnimatedNoteCard(
                                            note = note,
                                            uiState = uiState,
                                            isSelected = note.id == selectedNoteId ||
                                                note.id in uiState.selectedNoteIds,
                                            onOpen = { onOpenNote(note.id) },
                                            viewModel = viewModel,
                                            archivedText = archivedText,
                                            onDelete = { showDeleteConfirm = note.id }
                                        )
                                    }
                                }

                                if (manualSort) {
                                    if (pinnedNotes.isNotEmpty()) {
                                        item(span = StaggeredGridItemSpan.FullLine) {
                                            SectionLabel(stringResource(R.string.notes_pinned))
                                        }
                                        items(pinnedNotes, key = { it.id }) { note -> noteItem(note) }
                                    }
                                    if (pinnedNotes.isNotEmpty() && otherNotes.isNotEmpty()) {
                                        item(span = StaggeredGridItemSpan.FullLine) {
                                            SectionLabel(stringResource(R.string.notes_others))
                                        }
                                    }
                                    items(otherNotes, key = { it.id }) { note -> noteItem(note) }
                                } else {
                                    // Sorted views: one flat sequence in the chosen order.
                                    items(allNotes, key = { it.id }) { note -> noteItem(note) }
                                }
                            }
                        }
                    }

                    PullRefreshIndicator(
                        refreshing = uiState.isRefreshing,
                        state = pullRefreshState,
                        modifier = Modifier.align(Alignment.TopCenter),
                        contentColor = MaterialTheme.colorScheme.primary
                    )
                }

                // Visible sync status (v1.8.0 Nr. 3): when the list last
                // matched the server, pulled-to-refresh or background sync.
                // Sync failures remain visible in the banner; routine sync stays quiet.
            }
        }
    }

    showDeleteConfirm?.let { noteId ->
        // Snapshot from the list: the undo snackbar restores exactly this.
        val snapshot = (uiState.notes as? UiState.Success)?.data?.find { it.id == noteId }
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = null },
            title = { Text(stringResource(R.string.delete)) },
            text = { Text(stringResource(R.string.notes_delete_confirm)) },
            confirmButton = {
                TextButton(onClick = {
                    if (snapshot != null) viewModel.deleteNoteWithUndo(snapshot)
                    else viewModel.deleteNote(noteId)
                    showDeleteConfirm = null
                }) { Text(stringResource(R.string.delete)) }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = null }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }

    // Bulk-tagging the multi-selection.
    if (showTagDialog) {
        var tagInput by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showTagDialog = false },
            title = { Text(stringResource(R.string.tag_selection_title)) },
            text = {
                OutlinedTextField(
                    value = tagInput,
                    onValueChange = { tagInput = it },
                    singleLine = true,
                    label = { Text(stringResource(R.string.tag_selection_label)) },
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.tagSelectedNotes(tagInput.trim())
                        showTagDialog = false
                    },
                    enabled = tagInput.isNotBlank()
                ) { Text(stringResource(R.string.tag_selection_add)) }
            },
            dismissButton = {
                TextButton(onClick = { showTagDialog = false }) {
                    Text(stringResource(R.string.cancel))
                }
            }
        )
    }

    // Sync conflicts were auto-resolved ("(lokale Version …)" copies); this
    // dialog makes that visible instead of a snackbar flashing by.
    if (uiState.syncConflicts.isNotEmpty()) {
        AlertDialog(
            onDismissRequest = viewModel::clearSyncConflicts,
            title = { Text(stringResource(R.string.sync_conflict_title)) },
            text = {
                Text(
                    stringResource(
                        R.string.sync_conflict_dialog_text,
                        uiState.syncConflicts.joinToString()
                    )
                )
            },
            confirmButton = {
                TextButton(onClick = viewModel::clearSyncConflicts) {
                    Text(stringResource(R.string.ok))
                }
            }
        )
    }

    // Sort mode picker (v1.8.0 Nr. 9): custom order stays the default; the
    // others re-read the window from the Room cache instantly.
    if(showExtraFilters) ModalBottomSheet(onDismissRequest={showExtraFilters=false}) {
        TextButton(onClick={viewModel.setColorFilter(null);viewModel.setPersonFilter(null)}){Text(stringResource(R.string.filters_reset))}
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(12.dp)) {
            com.keeplocal.android.domain.model.NoteColor.entries.forEach { color ->
                IconButton(onClick={viewModel.setColorFilter(color.hex)},modifier=Modifier.size(48.dp)) {
                    Surface(color=Color(android.graphics.Color.parseColor(color.hex)),shape=RoundedCornerShape(24.dp),modifier=Modifier.size(32.dp)) {if(uiState.colorFilter==color.hex)Text("✓")}
                }
            }
        }
        val people=uiState.noteTree.flatMap {it.flatten()}.flatMap {listOf(com.keeplocal.android.domain.model.SharedUser(it.note.owner,uiState.ownerNames[it.note.owner] ?: stringResource(R.string.note_shared_badge)))+it.note.sharedWith}.filter {it.userId.isNotBlank()}.distinctBy {it.userId}
        people.forEach { person -> ListItem(headlineContent={Text(person.username)},modifier=Modifier.clickable {viewModel.setPersonFilter(person.userId)}) }
    }
    if (showCaptureMenu) {
        ModalBottomSheet(onDismissRequest={showCaptureMenu=false}) {
            listOf("text" to R.string.capture_text,"list" to R.string.capture_list,"image" to R.string.capture_image,"drawing" to R.string.capture_drawing,"audio" to R.string.editor_start_recording).forEach { (kind,label) ->
                ListItem(headlineContent={Text(stringResource(label))}, leadingContent = { Icon(when(kind) { "audio" -> Icons.Default.Mic; "list" -> androidx.compose.material.icons.Icons.Default.CheckBox; "image" -> androidx.compose.material.icons.Icons.Default.Image; "drawing" -> androidx.compose.material.icons.Icons.Default.Draw; else -> Icons.Default.Edit }, null) }, modifier=Modifier.fillMaxWidth().clickable {
                    com.keeplocal.android.util.IncomingIntents.prepareCapture(kind)
                    showCaptureMenu=false
                    onCreateNote()
                })
            }
        }
    }

    if (showSortDialog) {
        AlertDialog(
            onDismissRequest = { showSortDialog = false },
            title = { Text(stringResource(R.string.sort_label)) },
            text = {
                Column {
                    SortMode.entries.forEach { mode ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    viewModel.setSortMode(mode)
                                    showSortDialog = false
                                }
                                .padding(vertical = 12.dp, horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            RadioButton(
                                selected = uiState.sortMode == mode,
                                onClick = {
                                    viewModel.setSortMode(mode)
                                    showSortDialog = false
                                }
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(sortModeLabel(mode))
                        }
                    }
                }
            },
            confirmButton = {}
        )
    }

    // Move picker (v1.10.0): one note or the whole selection into a folder —
    // the mobile answer to the WebUI's drag & drop in the tree.
    if (uiState.movePickerOpen) {
        MovePickerDialog(
            candidates = uiState.moveCandidates,
            onPick = { parentId -> viewModel.moveTo(parentId) },
            onDismiss = viewModel::cancelMove
        )
    }
}

/**
 * Folder chooser for moves (v1.10.0): root level on top, then every folder
 * note (a note with children) indented by tree depth.
 */
@Composable
private fun MovePickerDialog(
    candidates: List<Pair<Note, Int>>,
    onPick: (String?) -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.move_picker_title)) },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState())
            ) {
                ListItem(
                    headlineContent = { Text(stringResource(R.string.move_to_root)) },
                    leadingContent = { Icon(Icons.Default.Home, contentDescription = null) },
                    modifier = Modifier.clickable { onPick(null) }
                )
                if (candidates.isEmpty()) {
                    Text(
                        stringResource(R.string.move_no_folders),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                    )
                }
                candidates.forEach { (note, depth) ->
                    ListItem(
                        headlineContent = {
                            Text(
                                note.title.ifBlank { stringResource(R.string.editor_untitled) },
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        },
                        leadingContent = { Icon(Icons.Default.Folder, contentDescription = null) },
                        modifier = Modifier
                            .padding(start = (depth * 12).dp)
                            .clickable { onPick(note.id) }
                    )
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        }
    )
}

@Composable
private fun sortModeLabel(mode: SortMode): String = stringResource(
    when (mode) {
        SortMode.MANUAL -> R.string.sort_manual
        SortMode.UPDATED -> R.string.sort_updated
        SortMode.CREATED -> R.string.sort_created
        SortMode.TITLE -> R.string.sort_title_az
    }
)

/**
 * Slim status strip above the note list: syncing/pending while offline changes
 * wait for the server, a retryable error when the queue failed, and a
 * re-login action when the session expired.
 */
@Composable
private fun SyncStatusBanner(
    banner: SyncBanner,
    onRetry: () -> Unit,
    onReLogin: () -> Unit
) {
    val isError = banner is SyncBanner.Failed || banner is SyncBanner.AuthRequired
    val container = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.surfaceVariant
    val content = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurfaceVariant

    Surface(color = container, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(start = 16.dp, end = 8.dp, top = 6.dp, bottom = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Icon(
                imageVector = when (banner) {
                    is SyncBanner.Syncing -> Icons.Default.Sync
                    is SyncBanner.Failed -> Icons.Default.CloudOff
                    is SyncBanner.AuthRequired -> Icons.Default.ErrorOutline
                    is SyncBanner.None -> Icons.Default.Sync
                },
                contentDescription = null,
                tint = content
            )
            Text(
                text = when (banner) {
                    is SyncBanner.Syncing -> stringResource(R.string.sync_banner_syncing, banner.pending)
                    is SyncBanner.Failed -> stringResource(R.string.sync_banner_failed, banner.count)
                    is SyncBanner.AuthRequired -> stringResource(R.string.error_unauthorized)
                    is SyncBanner.None -> ""
                },
                style = MaterialTheme.typography.bodyMedium,
                color = content,
                modifier = Modifier.weight(1f)
            )
            when (banner) {
                is SyncBanner.Failed -> TextButton(onClick = onRetry) {
                    Text(stringResource(R.string.sync_banner_retry))
                }
                is SyncBanner.AuthRequired -> TextButton(onClick = onReLogin) {
                    Text(stringResource(R.string.auth_login))
                }
                else -> {}
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall.copy(
            fontWeight = FontWeight.Medium,
            letterSpacing = 1.5.sp,
            fontSize = 11.sp
        ),
        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant
    )
}

@Composable
private fun EmptyNotes() {
    // Kept for call sites outside the pane; the pane itself uses EmptyState
    // directly with the right variant.
    EmptyState(
        variant = EmptyStateVariant.NOTES,
        title = stringResource(R.string.notes_empty_title),
        subtitle = stringResource(R.string.notes_empty_subtitle)
    )
}

// Note card with slide-in animation (matching WebUI noteSlideIn). No
// onLongClick here on purpose: the grid-level long-press gesture owns it
// (drag reorder, or context menu on a long-press without movement).
@Composable
private fun AnimatedNoteCard(
    note: Note,
    uiState: NotesScreenState,
    isSelected: Boolean,
    onOpen: () -> Unit,
    viewModel: NotesViewModel,
    archivedText: String,
    onDelete: () -> Unit
) {
    var visible by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { visible = true }

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(animationSpec = tween(300, easing = FastOutSlowInEasing)) +
            slideInVertically(
                animationSpec = tween(300, easing = FastOutSlowInEasing),
                initialOffsetY = { it / 8 }
            )
    ) {
        SwipeableNoteCard(
            note = note,
            isSelected = isSelected,
            compact = false,
            onClick = {
                if (uiState.isMultiSelectMode) viewModel.toggleNoteSelection(note.id) else onOpen()
            },
            onArchive = {
                viewModel.toggleArchive(note.id)
                viewModel.showSnackbar(archivedText)
            },
            onDelete = onDelete,
            ownerLabel = ownerBadgeLabel(note, uiState),
            // Live query highlights + tappable tag chips (v1.7.0 Nr. 3 + 6).
            highlightQuery = uiState.searchQuery,
            onTagClick = { tag -> viewModel.onTagSelected(tag) }
        )
    }
}

/** "von X" on shared notes; generic "geteilt" when the owner is not a friend. */
@Composable
private fun ownerBadgeLabel(note: Note, uiState: NotesScreenState): String? {
    val me = uiState.currentUserId ?: return null
    if (note.owner.isBlank() || note.owner == me) return null
    val owner = uiState.ownerNames[note.owner]
    return if (owner != null) stringResource(R.string.note_owner_badge, owner)
    else stringResource(R.string.note_shared_badge)
}

/** Lifts the card visually while it is being dragged. */
@Composable
private fun DraggableNoteCard(
    isDragged: Boolean,
    content: @Composable () -> Unit
) {
    Box(
        modifier = Modifier.graphicsLayer {
            val scale = if (isDragged) 1.04f else 1f
            scaleX = scale
            scaleY = scale
            alpha = if (isDragged) 0.92f else 1f
            shadowElevation = if (isDragged) 24f else 0f
        }
    ) {
        content()
    }
}

/** Finds the note id (grid item key) under [position], grid-local coords. */
private fun noteIdAt(
    layoutInfo: LazyStaggeredGridLayoutInfo,
    position: Offset
): String? {
    return layoutInfo.visibleItemsInfo.firstOrNull { item ->
        val left = item.offset.x.toFloat()
        val top = item.offset.y.toFloat()
        position.x >= left && position.x < left + item.size.width &&
            position.y >= top && position.y < top + item.size.height
    }?.key as? String
}
