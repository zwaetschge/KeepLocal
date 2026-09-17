package com.keeplocal.android.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notes
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.lifecycle.lifecycleScope
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.SortMode
import com.keeplocal.android.domain.usecase.notes.GetNotesUseCase
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Note picker for the single-note widget (v1.8.0 Nr. 10): launched by the
 * launcher right after the widget is placed. The chosen note id is stored
 * under the glance id, so every widget instance keeps its own note. Backing
 * out cancels the placement (the standard APPWIDGET_CONFIGURE contract).
 */
@AndroidEntryPoint
class NoteWidgetConfigActivity : ComponentActivity() {

    @Inject lateinit var getNotesUseCase: GetNotesUseCase

    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID
    private val notes = mutableStateOf<List<Note>>(emptyList())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        appWidgetId = intent?.extras?.getInt(
            AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID
        ) ?: AppWidgetManager.INVALID_APPWIDGET_ID
        // Default result: cancelled, unless a note is actually picked.
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))

        setContent {
            MaterialTheme {
                NotePicker(notes = notes.value, onPick = { note -> persistSelection(note.id) })
            }
        }
        lifecycleScope.launch {
            val result = getNotesUseCase.invokeCached(sortMode = SortMode.MANUAL).first()
            notes.value = result.getOrNull().orEmpty()
        }
    }

    private fun persistSelection(noteId: String) {
        lifecycleScope.launch {
            runCatching {
                val glanceId = GlanceAppWidgetManager(this@NoteWidgetConfigActivity)
                    .getGlanceIdBy(appWidgetId)
                NoteWidget.prefs(this@NoteWidgetConfigActivity)
                    .edit()
                    .putString(glanceId.toString(), noteId)
                    .apply()
                NoteWidget().update(this@NoteWidgetConfigActivity, glanceId)
            }
            setResult(
                RESULT_OK,
                Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
            )
            finish()
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NotePicker(notes: List<Note>, onPick: (Note) -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(title = { Text(stringResource(R.string.note_widget_config_title)) })
        }
    ) { padding ->
        if (notes.isEmpty()) {
            // Placeholder while the cache loads; the activity is short-lived.
            Text(
                text = stringResource(R.string.loading),
                modifier = Modifier.padding(padding).padding(16.dp)
            )
        } else {
            LazyColumn(modifier = Modifier.padding(padding).fillMaxWidth()) {
                items(notes, key = { it.id }) { note ->
                    ListItem(
                        headlineContent = {
                            Text(
                                note.title.ifBlank { note.content.take(40) }.ifBlank { "•" },
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        },
                        leadingContent = { Icon(Icons.Default.Notes, contentDescription = null) },
                        modifier = Modifier.clickable { onPick(note) }
                    )
                }
            }
        }
    }
}
