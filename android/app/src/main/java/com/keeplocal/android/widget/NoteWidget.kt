package com.keeplocal.android.widget

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.res.Configuration
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.compose.ui.res.stringResource
import com.keeplocal.android.R
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.entity.toDomain
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.ui.MainActivity
import com.keeplocal.android.ui.components.NoteColorUtil
import com.keeplocal.android.ui.theme.contentColorsFor
import com.keeplocal.android.util.IncomingIntents
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent

/**
 * Single-note widget (v1.8.0 Nr. 10): one chosen note pinned to the home
 * screen in its own color, straight from the Room cache — checklists render
 * as done/open markers. The note is picked once in [NoteWidgetConfigActivity]
 * and remembered per widget instance; tapping the body opens the note.
 */
class NoteWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val note = runCatching {
            val dao = EntryPointAccessors.fromApplication(
                context.applicationContext, NoteWidgetEntryPoint::class.java
            ).noteDao()
            val noteId = prefs(context).getString(id.toString(), null)
            // Read through the mapper so the widget shows exactly what the
            // app shows, including soft-deleted == gone.
            noteId?.let { dao.getNoteById(it)?.toDomain() }
        }.getOrNull()
        val isNight = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        provideContent { NoteWidgetContent(note, isNight) }
    }

    @Composable
    private fun NoteWidgetContent(note: Note?, isNight: Boolean) {
        val cardColor = if (note != null) {
            NoteColorUtil.getColor(note.color, isNight)
        } else {
            if (isNight) Color(0xFF1C1C1E) else Color(0xFFFAF7F2)
        }
        val ink = contentColorsFor(cardColor)
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(cardColor)
                .cornerRadius(16.dp)
                .padding(12.dp)
        ) {
            if (note == null) {
                Text(
                    text = "KeepLocal",
                    style = TextStyle(
                        color = ColorProvider(ink.onCardVariant),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold
                    ),
                    maxLines = 1
                )
                Spacer(modifier = GlanceModifier.height(4.dp))
                Text(
                    text = stringResource(R.string.note_widget_empty),
                    style = TextStyle(color = ColorProvider(ink.onCardVariant), fontSize = 12.sp),
                    maxLines = 2
                )
            } else {
                Column(
                    modifier = GlanceModifier
                        .fillMaxSize()
                        .clickable(actionRunCallback<NoteWidgetOpenAction>(parametersOf(note.id)))
                ) {
                    Text(
                        text = note.title.ifBlank { note.content.take(30) }.ifBlank { "•" },
                        style = TextStyle(
                            color = ColorProvider(ink.onCard),
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold
                        ),
                        maxLines = 2
                    )
                    if (note.isTodoList) {
                        Spacer(modifier = GlanceModifier.height(6.dp))
                        note.todoItems.take(5).forEach { item ->
                            Text(
                                text = (if (item.isCompleted) "✓ " else "☐ ") + item.text,
                                style = TextStyle(
                                    color = ColorProvider(
                                        if (item.isCompleted) ink.onCardVariant else ink.onCard
                                    ),
                                    fontSize = 12.sp
                                ),
                                maxLines = 1
                            )
                        }
                        if (note.todoItems.size > 5) {
                            Text(
                                text = "+${note.todoItems.size - 5}",
                                style = TextStyle(color = ColorProvider(ink.onCardVariant), fontSize = 11.sp)
                            )
                        }
                    } else if (note.content.isNotBlank()) {
                        Spacer(modifier = GlanceModifier.height(4.dp))
                        Text(
                            text = note.content,
                            style = TextStyle(color = ColorProvider(ink.onCard), fontSize = 12.sp),
                            maxLines = 8
                        )
                    }
                }
            }
        }
    }

    companion object {
        private const val PREFS = "note_widgets"

        internal fun prefs(context: Context): SharedPreferences =
            context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        /** Refreshes every placed instance; safe to call from workers/VMs. */
        suspend fun refreshAll(context: Context) {
            runCatching {
                val manager = GlanceAppWidgetManager(context.applicationContext)
                manager.getGlanceIds(NoteWidget::class.java).forEach { id ->
                    NoteWidget().update(context.applicationContext, id)
                }
            }
        }
    }
}

private val NOTE_ID_KEY = ActionParameters.Key<String>("note_id")

private fun parametersOf(noteId: String): ActionParameters = actionParametersOf(NOTE_ID_KEY to noteId)

class NoteWidgetOpenAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val noteId = parameters[NOTE_ID_KEY] ?: return
        context.startActivity(
            Intent(context, MainActivity::class.java).apply {
                putExtra(IncomingIntents.EXTRA_OPEN_NOTE_ID, noteId)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
    }
}

class NoteWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NoteWidget()
}

@EntryPoint
@InstallIn(SingletonComponent::class)
interface NoteWidgetEntryPoint {
    fun noteDao(): NoteDao
}
