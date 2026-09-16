package com.keeplocal.android.widget

import android.content.Context
import android.content.Intent
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
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.usecase.notes.GetPinnedNotesUseCase
import com.keeplocal.android.ui.MainActivity
import com.keeplocal.android.ui.components.NoteColorUtil
import com.keeplocal.android.ui.theme.contentColorsFor
import com.keeplocal.android.util.IncomingIntents
import com.keeplocal.android.util.Result
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent

/** Up to four pinned notes, straight from the local Room cache. */
class PinnedNotesWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val notes = runCatching {
            EntryPointAccessors.fromApplication(context.applicationContext, WidgetEntryPoint::class.java)
                .pinnedNotes()
                .invoke(maxCount = MAX_NOTES)
        }.getOrNull()
        val pinned = (notes as? Result.Success<List<Note>>)?.data ?: emptyList()
        // Widgets live outside the app theme; follow the system night mode so
        // the widget never blinds on a dark launcher (v1.7.0 Nr. 10).
        val isNight = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        provideContent { PinnedNotesContent(pinned, isNight) }
    }

    @Composable
    private fun PinnedNotesContent(notes: List<Note>, isNight: Boolean) {
        // Card-style restyle (v1.7.0 Nr. 10): each pinned note renders as a
        // mini note card in its own color, with the same per-card ink the app
        // uses (contentColorsFor keeps text readable on every palette tone).
        val paper = if (isNight) Color(0xFF1C1C1E) else Color(0xFFFAF7F2)
        val headerInk = if (isNight) Color(0xFFD8A196) else Color(0xFF8A5A4B)
        val emptyInk = if (isNight) Color(0xFF9A938D) else Color(0xFF9C8B82)
        Column(
            modifier = GlanceModifier.fillMaxSize().background(paper).cornerRadius(20.dp).padding(12.dp)
        ) {
            Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "KeepLocal",
                    style = TextStyle(color = ColorProvider(headerInk), fontSize = 15.sp, fontWeight = FontWeight.Bold),
                    modifier = GlanceModifier.defaultWeight()
                )
                Text(
                    text = "+",
                    style = TextStyle(color = ColorProvider(Color(0xFFB56B55)), fontSize = 22.sp, fontWeight = FontWeight.Bold),
                    modifier = GlanceModifier.clickable(actionRunCallback<NewNoteAction>())
                )
            }
            Spacer(modifier = GlanceModifier.height(8.dp))
            if (notes.isEmpty()) {
                Text(
                    text = "—",
                    style = TextStyle(color = ColorProvider(emptyInk), fontSize = 13.sp)
                )
            } else {
                notes.forEachIndexed { index, note ->
                    if (index > 0) Spacer(modifier = GlanceModifier.height(4.dp))
                    val cardColor = NoteColorUtil.getColor(note.color, isNight)
                    val ink = contentColorsFor(cardColor)
                    Column(
                        modifier = GlanceModifier.fillMaxWidth().clickable(
                            actionRunCallback<OpenNoteAction>(parametersOf(note.id))
                        ).background(cardColor).cornerRadius(12.dp).padding(horizontal = 10.dp, vertical = 7.dp)
                    ) {
                        Text(
                            text = note.title.ifBlank { note.content.take(40) }.ifBlank { "•" },
                            style = TextStyle(
                                color = ColorProvider(ink.onCard),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium
                            ),
                            maxLines = 1
                        )
                        if (note.title.isNotBlank() && note.content.isNotBlank()) {
                            Text(
                                text = note.content,
                                style = TextStyle(color = ColorProvider(ink.onCardVariant), fontSize = 11.sp),
                                maxLines = 1
                            )
                        }
                    }
                }
            }
        }
    }

    companion object {
        private const val MAX_NOTES = 4

        /** Refreshes every placed instance; safe to call from workers/VMs. */
        suspend fun refreshAll(context: Context) {
            runCatching {
                val manager = GlanceAppWidgetManager(context.applicationContext)
                manager.getGlanceIds(PinnedNotesWidget::class.java).forEach { id ->
                    PinnedNotesWidget().update(context.applicationContext, id)
                }
            }
        }
    }
}

private val NOTE_ID_KEY = ActionParameters.Key<String>("note_id")

private fun parametersOf(noteId: String): ActionParameters = actionParametersOf(NOTE_ID_KEY to noteId)

class OpenNoteAction : ActionCallback {
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

class NewNoteAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        context.startActivity(
            Intent(context, MainActivity::class.java).apply {
                putExtra(IncomingIntents.EXTRA_NEW_NOTE, true)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
    }
}

class PinnedNotesWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = PinnedNotesWidget()
}

@EntryPoint
@InstallIn(SingletonComponent::class)
interface WidgetEntryPoint {
    fun pinnedNotes(): GetPinnedNotesUseCase
}
