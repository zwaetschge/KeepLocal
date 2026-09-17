package com.keeplocal.android.ui.notes

import android.Manifest
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.Friend
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.ui.components.AudioRecordButton
import com.keeplocal.android.ui.components.ImageViewerDialog
import com.keeplocal.android.ui.components.LinkPreviewCard
import com.keeplocal.android.ui.components.NoteColorUtil
import com.keeplocal.android.ui.components.NoteImageGrid
import com.keeplocal.android.util.LinkOpener
import com.keeplocal.android.util.NoteLinkDetector
import kotlinx.coroutines.delay
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
    viewModel: NoteEditorViewModel = hiltViewModel()
) {
    NoteEditorContent(
        viewModel = viewModel,
        onNavigateBack = onNavigateBack,
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
    isEmbedded: Boolean
) {
    val uiState by viewModel.uiState.collectAsState()
    var showColorPicker by remember { mutableStateOf(false) }
    var showShareDialog by remember { mutableStateOf(false) }
    var showReminderSheet by remember { mutableStateOf(false) }
    var viewerIndex by remember { mutableStateOf<Int?>(null) }
    val context = LocalContext.current

    // Photo picker needs no permission; up to 5 items per session. The
    // per-note limit (25) is enforced by the ViewModel.
    val imagePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(5)
    ) { uris -> viewModel.onImagesPicked(uris) }

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
                    IconButton(onClick = { showColorPicker = true }) {
                        Icon(Icons.Default.Palette, contentDescription = stringResource(R.string.editor_color))
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
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        unfocusedContainerColor = androidx.compose.ui.graphics.Color.Transparent,
                        focusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent,
                        unfocusedIndicatorColor = androidx.compose.ui.graphics.Color.Transparent
                    )
                )
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
                            InputChip(
                                selected = false,
                                onClick = { viewModel.removeTag(tag) },
                                label = { Text(tag) },
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
            onDismiss = { viewerIndex = null }
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
