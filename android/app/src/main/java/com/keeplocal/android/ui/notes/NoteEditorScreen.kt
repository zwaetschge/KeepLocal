package com.keeplocal.android.ui.notes

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Notes
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isCtrlPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import android.widget.Toast
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.Friend
import com.keeplocal.android.domain.model.NoteColor
import androidx.compose.ui.text.input.VisualTransformation
import androidx.core.content.FileProvider
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.ui.components.ImageActions
import com.keeplocal.android.ui.components.AudioRecordButton
import com.keeplocal.android.ui.components.FileActions
import com.keeplocal.android.ui.components.FileAttachmentRow
import com.keeplocal.android.ui.components.ImageViewerDialog
import com.keeplocal.android.ui.components.LinkPreviewCard
import com.keeplocal.android.ui.components.NoteColorUtil
import com.keeplocal.android.ui.components.NoteImageGrid
import com.keeplocal.android.ui.components.SearchHighlightTransformation
import com.keeplocal.android.util.InNoteSearch
import com.keeplocal.android.util.LinkOpener
import com.keeplocal.android.util.NoteLinkDetector
import com.keeplocal.android.util.PdfNoteRenderer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Full-screen editor route (phone / tablet portrait). */
@Composable
fun NoteEditorScreen(
    onNavigateBack: () -> Unit,
    onOpenNote: (String) -> Unit = {},
    viewModel: NoteEditorViewModel = hiltViewModel()
) {
    NoteEditorContent(
        viewModel = viewModel,
        onNavigateBack = onNavigateBack,
        onOpenNote = onOpenNote,
        isEmbedded = false
    )
}

/**
 * Editor body shared by the full-screen route and the list-detail pane.
 * When [isEmbedded] is true the leading icon closes the pane instead of
 * popping the back stack, and the editor paints on the pane's own surface.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NoteEditorContent(
    viewModel: NoteEditorViewModel,
    onNavigateBack: () -> Unit,
    isEmbedded: Boolean,
    onOpenNote: (String) -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()
    var showColorPicker by remember { mutableStateOf(false) }
    var showShareDialog by remember { mutableStateOf(false) }
    var showReminderSheet by remember { mutableStateOf(false) }
    var showOverflow by remember { mutableStateOf(false) }
    // Find-in-note bar (v1.9.0 Nr. 7) — text notes only, checklists search
    // their items on the list screen instead.
    var showFindBar by remember(uiState.id) { mutableStateOf(false) }
    var inNoteSearch by remember(uiState.id) { mutableStateOf(InNoteSearch.State()) }
    var viewerIndex by remember { mutableStateOf<Int?>(null) }
    val context = LocalContext.current
    // One scope for everything that leaves the composable tree: image
    // save/share and the PDF export.
    val viewerScope = rememberCoroutineScope()

    fun shareAsPdf() {
        val now = Instant.now()
        val snapshot = Note(
            id = uiState.id ?: "",
            title = uiState.title,
            content = uiState.content,
            color = uiState.color,
            isPinned = uiState.isPinned,
            isArchived = false,
            isTodoList = uiState.isTodoList,
            todoItems = if (uiState.isTodoList) uiState.todoItems else emptyList(),
            tags = uiState.tags,
            sharedWith = uiState.sharedWith,
            owner = "",
            position = 0,
            createdAt = uiState.baseUpdatedAt ?: now,
            updatedAt = uiState.baseUpdatedAt ?: now,
            baseUpdatedAt = uiState.baseUpdatedAt,
            remindAt = uiState.remindAt,
            images = uiState.images
        )
        viewerScope.launch {
            val ok = withContext(Dispatchers.IO) {
                runCatching {
                    val file = PdfNoteRenderer.renderToCacheFile(context, snapshot)
                    val uri = FileProvider.getUriForFile(
                        context, context.packageName + ".fileprovider", file
                    )
                    val intent = Intent(Intent.ACTION_SEND).apply {
                        type = "application/pdf"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    context.startActivity(
                        Intent.createChooser(intent, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }.isSuccess
            }
            if (!ok) {
                Toast.makeText(context, context.getString(R.string.pdf_failed), Toast.LENGTH_SHORT).show()
            }
        }
    }

    // Photo picker needs no permission; up to 5 items per session. The
    // per-note limit (25) is enforced by the ViewModel.
    val imagePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(5)
    ) { uris -> viewModel.onImagesPicked(uris) }

    // SAF document picker for PDF attachments (v1.14.0 Nr. 5): no storage
    // permission needed, the ViewModel enforces the 25-per-note budget.
    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris -> viewModel.onFilesPicked(uris) }

    val audioPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) viewModel.startRecording() else viewModel.onRecordingPermissionDenied()
    }

    fun onMicPressed() {
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            viewModel.onMicClicked()
        } else {
            audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // Reminder notifications (v1.8.0 Nr. 2): POST_NOTIFICATIONS is asked for
    // the moment the user actually wants a reminder, never on startup.
    val notifPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    fun applyReminder(at: Instant?) {
        if (at != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        viewModel.setReminder(at)
    }

    LaunchedEffect(Unit) {
        viewModel.navigateBack.collect { onNavigateBack() }
    }

    BackHandler(enabled = !isEmbedded) {
        viewModel.saveOnBack()
        if (!uiState.hasChanges) onNavigateBack()
    }

    val backgroundColor = if (uiState.color == NoteColor.DEFAULT) {
        MaterialTheme.colorScheme.background
    } else {
        NoteColorUtil.colorFor(uiState.color)
    }

    Scaffold(
        modifier = Modifier
            .onPreviewKeyEvent { event ->
                // Hardware keyboard: Ctrl+S saves, Ctrl+Enter appends a todo
                // item, Esc leaves (saving pending changes like the back arrow).
                if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
                when {
                    event.isCtrlPressed && event.key == Key.S -> {
                        viewModel.save(); true
                    }
                    event.isCtrlPressed && event.key == Key.Enter && uiState.isTodoList -> {
                        viewModel.addTodoItem(); true
                    }
                    event.key == Key.Escape -> {
                        viewModel.saveOnBack()
                        if (!uiState.hasChanges) onNavigateBack()
                        true
                    }
                    else -> false
                }
            },
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(onClick = {
                        viewModel.saveOnBack()
                        if (!uiState.hasChanges) onNavigateBack()
                    }) {
                        Icon(
                            if (isEmbedded) Icons.Default.Close else Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(
                                if (isEmbedded) R.string.cd_close else R.string.cd_back
                            )
                        )
                    }
                },
                actions = {
                    // Pin/Unpin button
                    IconButton(onClick = { viewModel.togglePin() }) {
                        Icon(
                            imageVector = if (uiState.isPinned) Icons.Default.PushPin else Icons.Outlined.PushPin,
                            contentDescription = stringResource(if (uiState.isPinned) R.string.cd_unpin_note else R.string.cd_pin_note),
                            tint = if (uiState.isPinned) MaterialTheme.colorScheme.primary
                                   else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    if (!uiState.isNewNote) {
                        IconButton(onClick = {
                            viewModel.loadFriends()
                            showShareDialog = true
                        }) {
                            Icon(Icons.Default.PersonAdd, contentDescription = stringResource(R.string.editor_share))
                        }
                    }
                    IconButton(onClick = { viewModel.toggleTodoList() }) {
                        Icon(
                            if (uiState.isTodoList) Icons.AutoMirrored.Filled.Notes else Icons.Default.CheckBox,
                            contentDescription = stringResource(R.string.editor_todo_mode)
                        )
                    }
                    // Code note (v1.10.0): monospaced content.
                    IconButton(onClick = { viewModel.toggleCode() }) {
                        Icon(
                            Icons.Default.Code,
                            contentDescription = stringResource(R.string.editor_code_mode),
                            tint = if (uiState.isCode) MaterialTheme.colorScheme.primary
                                   else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    IconButton(onClick = { showColorPicker = true }) {
                        Icon(Icons.Default.Palette, contentDescription = stringResource(R.string.editor_color))
                    }
                    // Overflow (v1.9.0): find-in-note + share-as-PDF, so the
                    // icon row stays put even as the actions grow.
                    Box {
                        IconButton(onClick = { showOverflow = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = stringResource(R.string.cd_more_actions))
                        }
                        DropdownMenu(
                            expanded = showOverflow,
                            onDismissRequest = { showOverflow = false }
                        ) {
                            if (!uiState.isTodoList) {
                                DropdownMenuItem(
                                    text = { Text(stringResource(R.string.search_in_note)) },
                                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                                    onClick = {
                                        showOverflow = false
                                        showFindBar = true
                                    }
                                )
                            }
                            DropdownMenuItem(
                                text = { Text(stringResource(R.string.pdf_share)) },
                                leadingIcon = { Icon(Icons.Default.PictureAsPdf, contentDescription = null) },
                                onClick = {
                                    showOverflow = false
                                    shareAsPdf()
                                }
                            )
                        }
                    }
                    IconButton(onClick = viewModel::save, enabled = !uiState.isSaving) {
                        if (uiState.isSaving) {
                            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                        } else {
                            Icon(Icons.Default.Check, contentDescription = stringResource(R.string.editor_save))
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = backgroundColor)
            )
        },
        containerColor = backgroundColor
    ) { padding ->
        if (uiState.isLoading) {
            Box(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentAlignment = Alignment.Center
            ) { CircularProgressIndicator() }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Color picker (v1.7.0 Nr. 7): bottom sheet instead of a row that
            // pushed the whole editor down. Renders in its own window, so its
            // position in the Column is irrelevant.
            if (showColorPicker) {
                ModalBottomSheet(onDismissRequest = { showColorPicker = false }) {
                    Text(
                        stringResource(R.string.editor_color_picker_title),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                    )
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(start = 24.dp, top = 8.dp, end = 24.dp, bottom = 32.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        NoteColorUtil.getAllColors().forEach { color ->
                            val colorValue = NoteColorUtil.colorFor(color)
                            Box(
                                modifier = Modifier
                                    .size(40.dp)
                                    .clip(CircleShape)
                                    .background(colorValue)
                                    .then(
                                        if (color == uiState.color) Modifier.border(
                                            2.dp,
                                            MaterialTheme.colorScheme.primary,
                                            CircleShape
                                        ) else Modifier
                                    )
                                    .clickable {
                                        viewModel.updateColor(color)
                                        showColorPicker = false
                                    }
                            ) {
                                if (color == uiState.color) {
                                    Icon(
                                        Icons.Default.Check,
                                        contentDescription = null,
                                        modifier = Modifier.align(Alignment.Center).size(18.dp),
                                        tint = MaterialTheme.colorScheme.primary
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Subtle autosave confirmation (v1.7.0 Nr. 7): flashes for two
            // seconds after the draft landed in the store.
            var draftSavedVisible by remember { mutableStateOf(false) }
            LaunchedEffect(uiState.draftSavedAt) {
                if (uiState.draftSavedAt > 0L) {
                    draftSavedVisible = true
                    delay(2000)
                    draftSavedVisible = false
                }
            }
            AnimatedVisibility(visible = draftSavedVisible) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = null,
                        modifier = Modifier.size(14.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        stringResource(R.string.editor_draft_saved),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            // Title (v1.7.0 Nr. 7): big and growing — multi-line instead of a
            // cramped single-line field, capped at three lines.
            TextField(
                value = uiState.title,
                onValueChange = viewModel::updateTitle,
                placeholder = { Text(stringResource(R.string.editor_title_hint)) },
                modifier = Modifier.fillMaxWidth(),
                textStyle = MaterialTheme.typography.headlineSmall,
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                    unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                    focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                    unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent
                ),
                minLines = 1,
                maxLines = 3
            )

            // Reminder chip row (v1.8.0 Nr. 2): set time + one-tap remove.
            val remindAt = uiState.remindAt
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(horizontal = 12.dp)
            ) {
                if (remindAt != null) {
                    AssistChip(
                        onClick = { showReminderSheet = true },
                        label = {
                            Text(stringResource(R.string.reminder_label) + " · " + formatReminderTime(remindAt))
                        },
                        leadingIcon = {
                            Icon(Icons.Default.Alarm, contentDescription = null, modifier = Modifier.size(18.dp))
                        }
                    )
                    IconButton(
                        onClick = { applyReminder(null) },
                        modifier = Modifier.size(32.dp)
                    ) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = stringResource(R.string.reminder_remove),
                            modifier = Modifier.size(16.dp)
                        )
                    }
                } else {
                    AssistChip(
                        onClick = { showReminderSheet = true },
                        label = { Text(stringResource(R.string.reminder_add)) },
                        leadingIcon = {
                            Icon(Icons.Default.Alarm, contentDescription = null, modifier = Modifier.size(18.dp))
                        }
                    )
                }
            }

            // Find-in-note bar (v1.9.0 Nr. 7): counter + wrap-around step
            // buttons; the hits themselves are painted into the content field.
            if (showFindBar && !uiState.isTodoList) {
                val hitCount = InNoteSearch.hits(uiState.content, inNoteSearch).size
                val counter = InNoteSearch.counter(uiState.content, inNoteSearch)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp)
                ) {
                    OutlinedTextField(
                        value = inNoteSearch.query,
                        onValueChange = { inNoteSearch = InNoteSearch.onQueryChanged(inNoteSearch, it) },
                        placeholder = { Text(stringResource(R.string.search_in_note)) },
                        modifier = Modifier.weight(1f),
                        singleLine = true
                    )
                    Text(
                        "${counter.first}/${counter.second}",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 8.dp)
                    )
                    IconButton(
                        onClick = { inNoteSearch = InNoteSearch.previous(uiState.content, inNoteSearch) },
                        enabled = hitCount > 0
                    ) {
                        Icon(
                            Icons.Default.KeyboardArrowUp,
                            contentDescription = stringResource(R.string.search_in_note_previous)
                        )
                    }
                    IconButton(
                        onClick = { inNoteSearch = InNoteSearch.next(uiState.content, inNoteSearch) },
                        enabled = hitCount > 0
                    ) {
                        Icon(
                            Icons.Default.KeyboardArrowDown,
                            contentDescription = stringResource(R.string.search_in_note_next)
                        )
                    }
                    IconButton(
                        onClick = {
                            showFindBar = false
                            inNoteSearch = InNoteSearch.close()
                        }
                    ) {
                        Icon(Icons.Default.Close, contentDescription = stringResource(R.string.cd_close))
                    }
                }
            }

            // Content or Todo list
            if (uiState.isTodoList) {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    contentPadding = PaddingValues(horizontal = 4.dp)
                ) {
                    itemsIndexed(uiState.todoItems, key = { _, item -> item.id }) { index, item ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp)
                        ) {
                            Checkbox(
                                checked = item.isCompleted,
                                onCheckedChange = { viewModel.toggleTodoItemCompleted(index) }
                            )
                            TextField(
                                value = item.text,
                                onValueChange = { viewModel.updateTodoItem(index, it) },
                                modifier = Modifier.weight(1f),
                                colors = TextFieldDefaults.colors(
                                    focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                                    unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                                    focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                                    unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent
                                ),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(onNext = { viewModel.addTodoItem() })
                            )
                            if (item.text.isEmpty()) {
                                IconButton(onClick = { viewModel.removeTodoItem(index) }) {
                                    Icon(Icons.Default.Close, contentDescription = null, modifier = Modifier.size(18.dp))
                                }
                            }
                        }
                    }
                    item {
                        Row {
                            TextButton(
                                onClick = viewModel::addTodoItem,
                                modifier = Modifier.padding(start = 40.dp)
                            ) {
                                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(stringResource(R.string.editor_add_todo_item))
                            }
                            // Clean up completed items (v1.8.0 Nr. 5).
                            if (uiState.todoItems.any { it.isCompleted }) {
                                TextButton(onClick = viewModel::cleanupTodoItems) {
                                    Icon(Icons.Default.DeleteSweep, contentDescription = null, modifier = Modifier.size(18.dp))
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(stringResource(R.string.checklist_cleanup))
                                }
                            }
                        }
                    }
                }
            } else {
                TextField(
                    value = uiState.content,
                    onValueChange = viewModel::updateContent,
                    placeholder = { Text(stringResource(R.string.editor_content_hint)) },
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    textStyle = if (uiState.isCode) {
                        MaterialTheme.typography.bodyLarge.copy(fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace)
                    } else {
                        MaterialTheme.typography.bodyLarge
                    },
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent
                    ),
                    visualTransformation = if (inNoteSearch.isActive) {
                        SearchHighlightTransformation(
                            InNoteSearch.hits(uiState.content, inNoteSearch),
                            InNoteSearch.currentRange(uiState.content, inNoteSearch)
                        )
                    } else {
                        VisualTransformation.None
                    }
                )
                // Wiki links (v1.10.0): [[Ziel]] chips under the text. A dimmed
                // chip means no note carries that title — fix the name or create
                // the note and it resolves on the next keystroke.
                if (uiState.wikiLinks.isNotEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        uiState.wikiLinks.forEach { link ->
                            AssistChip(
                                onClick = { link.noteId?.let(onOpenNote) },
                                enabled = link.noteId != null,
                                label = { Text(link.target) },
                                leadingIcon = {
                                    Icon(
                                        Icons.Default.Link,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            )
                        }
                    }
                }
                // Tappable links (v1.8.0 Nr. 6): URLs the text carries open in
                // a Custom Tab. Links that already have a preview card don't
                // need a chip — the card itself is tappable.
                val previewedUrls = remember(uiState.linkPreviews) {
                    uiState.linkPreviews.map { it.url }.toSet()
                }
                val bareLinks = remember(uiState.content, previewedUrls) {
                    NoteLinkDetector.find(uiState.content)
                        .filter { it.url !in previewedUrls }
                        .take(4)
                }
                if (bareLinks.isNotEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState())
                            .padding(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        bareLinks.forEach { link ->
                            AssistChip(
                                onClick = { LinkOpener.open(context, link.target) },
                                label = { Text(linkHost(link.target)) },
                                leadingIcon = {
                                    Icon(
                                        Icons.Default.Language,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            )
                        }
                    }
                }
            }

            // Image attachments (uploads render as placeholder cells)
            if (uiState.images.isNotEmpty() || uiState.uploadingImageCount > 0) {
                NoteImageGrid(
                    images = uiState.images,
                    uploadingCount = uiState.uploadingImageCount,
                    onImageClick = { index -> viewerIndex = index },
                    onDeleteImage = { image -> viewModel.deleteImage(image) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }

            // PDF attachments (v1.14.0 Nr. 5): chips open in the system
            // viewer (cache download — the file route needs the session
            // cookie), trailing X deletes.
            if (uiState.files.isNotEmpty() || uiState.uploadingFileCount > 0) {
                FileAttachmentRow(
                    files = uiState.files,
                    uploadingCount = uiState.uploadingFileCount,
                    onOpenFile = { file ->
                        viewerScope.launch {
                            val opened = FileActions.openInViewer(context, file)
                            if (!opened) {
                                Toast.makeText(
                                    context,
                                    context.getString(R.string.file_open_failed),
                                    Toast.LENGTH_SHORT
                                ).show()
                            }
                        }
                    },
                    onDeleteFile = { file -> viewModel.deleteFile(file) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }

            // Attachment row: add image, dictate, inline media hints
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(
                    onClick = {
                        imagePicker.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                        )
                    },
                    enabled = uiState.uploadingImageCount == 0
                ) {
                    if (uiState.uploadingImageCount > 0) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(
                            Icons.Default.AddPhotoAlternate,
                            contentDescription = stringResource(R.string.editor_add_image)
                        )
                    }
                }
                Spacer(modifier = Modifier.width(8.dp))
                IconButton(
                    onClick = { filePicker.launch(arrayOf("application/pdf")) },
                    enabled = uiState.uploadingFileCount == 0
                ) {
                    if (uiState.uploadingFileCount > 0) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(
                            Icons.Default.AttachFile,
                            contentDescription = stringResource(R.string.editor_add_file)
                        )
                    }
                }
                Spacer(modifier = Modifier.width(8.dp))
                // Hidden — not disabled — while the account-wide dictation
                // switch is off (aiFeatures.voiceTranscription).
                if (uiState.showMic) {
                    AudioRecordButton(
                        isRecording = uiState.isRecording,
                        isTranscribing = uiState.isTranscribing,
                        elapsedMs = uiState.recordingElapsedMs,
                        onClick = { onMicPressed() }
                    )
                }
                // A recording survived a 429 budget refusal: offer the retry
                // the WebUI offers, instead of silently keeping the file.
                if (uiState.canRetryTranscription) {
                    Spacer(modifier = Modifier.width(8.dp))
                    AssistChip(
                        onClick = { viewModel.retryTranscription() },
                        label = { Text(stringResource(R.string.transcribe_retry)) },
                        leadingIcon = {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = null,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    )
                }
                uiState.mediaHint?.let { hint ->
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = hint,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f)
                    )
                }
            }

            // Link Previews
            if (uiState.linkPreviews.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    uiState.linkPreviews.forEach { preview ->
                        LinkPreviewCard(
                            preview = preview,
                            onRemove = { viewModel.removeLinkPreview(preview.url) }
                        )
                    }
                }
            }

            if (uiState.isLoadingPreview) {
                LinearProgressIndicator(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                )
            }

            // "Erwähnt in" (v1.10.0): backlinks — notes whose content carries
            // a [[this note's title]] link.
            if (uiState.backlinks.isNotEmpty()) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
                ) {
                    Text(
                        stringResource(R.string.editor_backlinks),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        uiState.backlinks.forEach { note ->
                            AssistChip(
                                onClick = { onOpenNote(note.id) },
                                label = { Text(note.title.ifBlank { stringResource(R.string.editor_untitled) }) },
                                leadingIcon = {
                                    Icon(
                                        Icons.Default.Link,
                                        contentDescription = null,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            )
                        }
                    }
                }
            }

            // Tags
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                if (uiState.tags.isNotEmpty()) {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        uiState.tags.forEach { tag ->
                            val tagColor = remember(tag, uiState.tagColors) {
                                tagChipColor(uiState.tagColors[tag])
                            }
                            InputChip(
                                selected = false,
                                onClick = { viewModel.removeTag(tag) },
                                label = { Text(tag) },
                                leadingIcon = tagColor?.let { color ->
                                    {
                                        Box(
                                            modifier = Modifier
                                                .size(10.dp)
                                                .clip(CircleShape)
                                                .background(color)
                                        )
                                    }
                                },
                                trailingIcon = {
                                    Icon(Icons.Default.Close, contentDescription = null, modifier = Modifier.size(14.dp))
                                }
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedTextField(
                        value = uiState.tagInput,
                        onValueChange = viewModel::updateTagInput,
                        placeholder = { Text(stringResource(R.string.editor_add_tag)) },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { viewModel.addTag() })
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    IconButton(onClick = viewModel::addTag) {
                        Icon(Icons.Default.Add, contentDescription = null)
                    }
                }

                // Autocomplete (v1.10.0): known tags matching the input.
                if (uiState.tagSuggestions.isNotEmpty()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        uiState.tagSuggestions.forEach { suggestion ->
                            AssistChip(
                                onClick = { viewModel.applyTagSuggestion(suggestion) },
                                label = { Text(suggestion) },
                                leadingIcon = {
                                    val color = remember(suggestion, uiState.tagColors) {
                                        tagChipColor(uiState.tagColors[suggestion])
                                    }
                                    if (color != null) {
                                        Box(
                                            modifier = Modifier
                                                .size(10.dp)
                                                .clip(CircleShape)
                                                .background(color)
                                        )
                                    }
                                }
                            )
                        }
                    }
                }
            }
        }

        uiState.errorMessage?.let { error ->
            Snackbar(
                modifier = Modifier.padding(16.dp)
            ) { Text(error) }
        }
    }

    // Share Dialog
    if (showShareDialog) {
        ShareNoteDialog(
            friends = uiState.friends,
            sharedWith = uiState.sharedWith,
            isLoadingFriends = uiState.isLoadingFriends,
            onShare = { friendId -> viewModel.shareWithFriend(friendId) },
            onUnshare = { userId -> viewModel.unshareWithUser(userId) },
            onDismiss = { showShareDialog = false }
        )
    }

    // Fullscreen image viewer
    viewerIndex?.let { index ->
        ImageViewerDialog(
            images = uiState.images,
            initialIndex = index,
            onDismiss = { viewerIndex = null },
            onSaveImage = { image ->
                viewerScope.launch {
                    val ok = ImageActions.saveToGallery(context, image)
                    Toast.makeText(
                        context,
                        context.getString(if (ok) R.string.viewer_saved else R.string.viewer_save_failed),
                        Toast.LENGTH_SHORT
                    ).show()
                }
            },
            onShareImage = { image ->
                viewerScope.launch {
                    val ok = ImageActions.share(context, image)
                    if (!ok) Toast.makeText(
                        context, context.getString(R.string.viewer_save_failed), Toast.LENGTH_SHORT
                    ).show()
                }
            }
        )
    }

    // Reminder picker (v1.8.0 Nr. 2)
    if (showReminderSheet) {
        ReminderSheet(
            current = uiState.remindAt,
            onPick = { at ->
                showReminderSheet = false
                applyReminder(at)
            },
            onDismiss = { showReminderSheet = false }
        )
    }
}

/**
 * Reminder picker (v1.8.0 Nr. 2): three quick presets, a custom date+time
 * dialog, and — when a reminder is already set — a remove option. The chosen
 * time is only stored; the alarm itself is planned once the note saves.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReminderSheet(
    current: Instant?,
    onPick: (Instant?) -> Unit,
    onDismiss: () -> Unit
) {
    val now = remember { ZonedDateTime.now() }
    var showCustomPicker by remember { mutableStateOf(false) }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Text(
            stringResource(R.string.reminder_time_title),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
        )
        Column(modifier = Modifier.padding(bottom = 32.dp)) {
            listOf(
                stringResource(R.string.reminder_in_30min) to now.plusMinutes(30),
                stringResource(R.string.reminder_tomorrow_morning) to
                    now.toLocalDate().plusDays(1).atTime(LocalTime.of(8, 0)).atZone(now.zone),
                stringResource(R.string.reminder_next_week) to
                    now.plusWeeks(1).withHour(8).withMinute(0).withSecond(0)
            ).forEach { (label, at) ->
                ListItem(
                    headlineContent = { Text(label) },
                    leadingContent = { Icon(Icons.Default.Alarm, contentDescription = null) },
                    modifier = Modifier.clickable { onPick(at.toInstant()) }
                )
            }
            ListItem(
                headlineContent = { Text(stringResource(R.string.reminder_custom)) },
                leadingContent = { Icon(Icons.Default.DateRange, contentDescription = null) },
                modifier = Modifier.clickable { showCustomPicker = true }
            )
            if (current != null) {
                ListItem(
                    headlineContent = {
                        Text(
                            stringResource(R.string.reminder_remove),
                            color = MaterialTheme.colorScheme.error
                        )
                    },
                    leadingContent = {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error
                        )
                    },
                    modifier = Modifier.clickable { onPick(null) }
                )
            }
        }
    }

    if (showCustomPicker) {
        CustomReminderPicker(
            onPicked = { at ->
                showCustomPicker = false
                onPick(at)
            },
            onDismiss = { showCustomPicker = false }
        )
    }
}

/** Date first, then time — both in the device's clock and calendar. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CustomReminderPicker(
    onPicked: (Instant) -> Unit,
    onDismiss: () -> Unit
) {
    var pickedDate by remember { mutableStateOf<LocalDate?>(null) }
    val datePickerState = rememberDatePickerState(
        initialSelectedDateMillis = System.currentTimeMillis()
    )
    val timePickerState = rememberTimePickerState(is24Hour = true)

    if (pickedDate == null) {
        DatePickerDialog(
            onDismissRequest = onDismiss,
            confirmButton = {
                TextButton(
                    onClick = {
                        // DatePicker millis are UTC-midnight of the picked day.
                        datePickerState.selectedDateMillis?.let { millis ->
                            pickedDate = Instant.ofEpochMilli(millis)
                                .atZone(ZoneOffset.UTC)
                                .toLocalDate()
                        }
                    },
                    enabled = datePickerState.selectedDateMillis != null
                ) { Text(stringResource(R.string.ok)) }
            },
            dismissButton = {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
            }
        ) {
            DatePicker(state = datePickerState)
        }
    } else {
        AlertDialog(
            onDismissRequest = onDismiss,
            title = { Text(stringResource(R.string.reminder_custom)) },
            text = { TimePicker(state = timePickerState) },
            confirmButton = {
                TextButton(
                    onClick = {
                        val date = pickedDate
                        if (date != null) {
                            onPicked(
                                date.atTime(LocalTime.of(timePickerState.hour, timePickerState.minute))
                                    .atZone(ZoneId.systemDefault())
                                    .toInstant()
                            )
                        }
                    }
                ) { Text(stringResource(R.string.ok)) }
            },
            dismissButton = {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
            }
        )
    }
}

/** "24.12.2026 08:00" in the device timezone. */
private fun formatReminderTime(at: Instant): String = try {
    DateTimeFormatter.ofPattern("d.M.yyyy HH:mm").withLocale(Locale.getDefault())
        .format(at.atZone(ZoneId.systemDefault()))
} catch (_: Exception) {
    at.toString()
}

/** Short host label for a link chip ("example.com"). */
private fun linkHost(url: String): String =
    url.removePrefix("https://").removePrefix("http://").removePrefix("www.")
        .substringBefore('/')
        .ifBlank { url }

/**
 * A tag's palette color as a Compose color (v1.10.0); null when the tag has
 * none or the stored value is not a parseable hex.
 */
internal fun tagChipColor(hex: String?): androidx.compose.ui.graphics.Color? =
    hex?.let { runCatching { androidx.compose.ui.graphics.Color(android.graphics.Color.parseColor(it)) }.getOrNull() }

@Composable
fun ShareNoteDialog(
    friends: List<Friend>,
    sharedWith: List<com.keeplocal.android.domain.model.SharedUser>,
    isLoadingFriends: Boolean,
    onShare: (String) -> Unit,
    onUnshare: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val sharedUserIds = remember(sharedWith) { sharedWith.map { it.userId }.toSet() }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.share_title)) },
        text = {
            if (isLoadingFriends) {
                Box(
                    modifier = Modifier.fillMaxWidth().height(100.dp),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (friends.isEmpty()) {
                Text(stringResource(R.string.share_no_friends))
            } else {
                Column {
                    Text(
                        stringResource(R.string.share_with_friends),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    friends.forEach { friend ->
                        val isShared = friend.id in sharedUserIds
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    if (isShared) onUnshare(friend.id)
                                    else onShare(friend.id)
                                }
                                .padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.Person,
                                contentDescription = null,
                                modifier = Modifier.size(24.dp)
                            )
                            Spacer(modifier = Modifier.width(12.dp))
                            Text(
                                friend.username,
                                modifier = Modifier.weight(1f),
                                style = MaterialTheme.typography.bodyLarge
                            )
                            Checkbox(
                                checked = isShared,
                                onCheckedChange = {
                                    if (isShared) onUnshare(friend.id)
                                    else onShare(friend.id)
                                }
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.ok))
            }
        }
    )
}
