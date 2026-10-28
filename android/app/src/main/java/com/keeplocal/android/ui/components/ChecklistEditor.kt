package com.keeplocal.android.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChecklistEditor(
    items: List<TodoItem>, options: ChecklistOptions,
    onOptions: (ChecklistOptions) -> Unit, onText: (Int, String) -> Unit,
    onToggle: (Int) -> Unit, onMove: (Int, Int) -> Unit, onIndent: (Int) -> Unit,
    onDelete: (Int) -> Unit, onAdd: () -> Unit, onCleanup: () -> Unit,
    modifier: Modifier = Modifier, settingsOpen: Boolean = false,
    onDismissSettings: () -> Unit = {}
) {
    var knownIds by remember { mutableStateOf(items.map { it.id }.toSet()) }
    var focusId by remember { mutableStateOf(items.firstOrNull()?.takeIf { it.text.isBlank() }?.id) }
    LaunchedEffect(items.map { it.id }) {
        items.firstOrNull { it.id !in knownIds }?.let { focusId = it.id }
        knownIds = items.map { it.id }.toSet()
    }
    var parentCompleted = false
    val indexed = items.mapIndexed { index, item ->
        if (item.indent == 0) parentCompleted = item.isCompleted
        Triple(index, item, options.checkedToBottom && (item.isCompleted || (item.indent == 1 && parentCompleted)))
    }
    Column(modifier) {
        val row: @Composable (Int, TodoItem) -> Unit = { index, item ->
            key(item.id) {
                ChecklistRow(item, index, items.size, onText, onToggle, onMove, onIndent,
                    onDelete, onAdd, requestFocus = item.id == focusId)
            }
        }
        indexed.filter { !it.third }.forEach { (index, item, _) -> row(index, item) }
        Row(
            Modifier.fillMaxWidth().clickable(onClick = onAdd).heightIn(min = 48.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(Icons.Default.Add, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(24.dp))
            Text(stringResource(R.string.editor_add_todo_item), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val done = indexed.filter { it.third }
        if (done.isNotEmpty()) {
            TextButton(onClick = { onOptions(options.copy(collapseCompleted = !options.collapseCompleted)) }) {
                Icon(if (options.collapseCompleted) Icons.Default.ChevronRight else Icons.Default.ExpandMore, null)
                Spacer(Modifier.width(12.dp))
                Text("${done.size} ${stringResource(R.string.list_completed)}")
            }
            if (!options.collapseCompleted) done.forEach { (index, item, _) -> row(index, item) }
        }
    }
    if (settingsOpen) ModalBottomSheet(onDismissRequest = onDismissSettings) {
        Text(stringResource(R.string.list_settings), style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
        ListItem(
            headlineContent = { Text(stringResource(R.string.list_checked_bottom)) },
            trailingContent = { Switch(options.checkedToBottom, { onOptions(options.copy(checkedToBottom = it)) }) }
        )
        ListItem(
            headlineContent = { Text(stringResource(R.string.list_add_top)) },
            trailingContent = { Switch(options.addToTop, { onOptions(options.copy(addToTop = it)) }) }
        )
        TextButton(onClick = onCleanup, modifier = Modifier.padding(horizontal = 16.dp)) {
            Text(stringResource(R.string.checklist_cleanup))
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun ChecklistRow(
    item: TodoItem, index: Int, count: Int, onText: (Int, String) -> Unit,
    onToggle: (Int) -> Unit, onMove: (Int, Int) -> Unit, onIndent: (Int) -> Unit,
    onDelete: (Int) -> Unit, onAdd: () -> Unit, requestFocus: Boolean
) {
    var menu by remember(item.id) { mutableStateOf(false) }
    var focused by remember(item.id) { mutableStateOf(false) }
    val focus = remember(item.id) { FocusRequester() }
    LaunchedEffect(requestFocus) { if (requestFocus) { withFrameNanos { }; focus.requestFocus() } }
    Row(Modifier.fillMaxWidth().padding(start = (item.indent * 24).dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(item.isCompleted, { onToggle(index) })
        TextField(
            item.text, { onText(index, it) },
            Modifier.weight(1f).focusRequester(focus).onFocusChanged { focused = it.isFocused },
            singleLine = true, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            keyboardActions = KeyboardActions(onNext = { onAdd() }),
            textStyle = MaterialTheme.typography.bodyLarge.copy(textDecoration = if (item.isCompleted) TextDecoration.LineThrough else null),
            colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent,
                unfocusedContainerColor = Color.Transparent, focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent)
        )
        if (focused || menu) Box {
            IconButton(onClick = { menu = true }) { Icon(Icons.Default.MoreVert, stringResource(R.string.list_item_actions)) }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text(stringResource(R.string.list_move_up)) }, enabled = index > 0, onClick = { onMove(index, -1); menu = false })
                DropdownMenuItem(text = { Text(stringResource(R.string.list_move_down)) }, enabled = index < count - 1, onClick = { onMove(index, 1); menu = false })
                DropdownMenuItem(text = { Text(stringResource(if (item.indent == 0) R.string.list_indent else R.string.list_outdent)) }, enabled = index > 0, onClick = { onIndent(index); menu = false })
                DropdownMenuItem(text = { Text(stringResource(R.string.delete)) }, onClick = { onDelete(index); menu = false })
            }
        }
    }
}
