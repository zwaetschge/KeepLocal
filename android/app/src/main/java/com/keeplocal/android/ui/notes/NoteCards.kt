package com.keeplocal.android.ui.notes

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.foundation.LocalIndication
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.Text
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.ui.components.ImageViewerDialog
import com.keeplocal.android.ui.components.NoteColorUtil
import com.keeplocal.android.ui.components.rememberMediaImageModel
import com.keeplocal.android.ui.theme.Motion
import com.keeplocal.android.ui.theme.NoteContentColors
import com.keeplocal.android.ui.theme.contentColorsFor
import com.keeplocal.android.ui.theme.doodleCard
import com.keeplocal.android.util.SearchHighlight

private val CardShape = RoundedCornerShape(8.dp)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SwipeableNoteCard(
    note: Note,
    isSelected: Boolean,
    compact: Boolean,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null,
    onArchive: () -> Unit,
    onDelete: () -> Unit,
    ownerLabel: String? = null,
    highlightQuery: String = "",
    onTagClick: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val dismissState = rememberSwipeToDismissBoxState(
        confirmValueChange = { value ->
            when (value) {
                SwipeToDismissBoxValue.StartToEnd -> {
                    onArchive()
                    false
                }
                SwipeToDismissBoxValue.EndToStart -> {
                    onDelete()
                    false
                }
                SwipeToDismissBoxValue.Settled -> false
            }
        },
        positionalThreshold = { it * 0.4f }
    )

    SwipeToDismissBox(
        state = dismissState,
        modifier = modifier,
        backgroundContent = {
            val direction = dismissState.dismissDirection
            val color by animateColorAsState(
                when (dismissState.targetValue) {
                    SwipeToDismissBoxValue.StartToEnd -> MaterialTheme.colorScheme.secondaryContainer
                    SwipeToDismissBoxValue.EndToStart -> MaterialTheme.colorScheme.errorContainer
                    else -> MaterialTheme.colorScheme.surface
                },
                label = "swipe_bg"
            )
            val icon = when (direction) {
                SwipeToDismissBoxValue.EndToStart -> Icons.Default.Delete
                else -> Icons.Default.Archive
            }
            val iconTint = when (direction) {
                SwipeToDismissBoxValue.EndToStart -> MaterialTheme.colorScheme.onErrorContainer
                else -> MaterialTheme.colorScheme.onSecondaryContainer
            }
            val alignment = when (direction) {
                SwipeToDismissBoxValue.EndToStart -> Alignment.CenterEnd
                else -> Alignment.CenterStart
            }
            val scale by animateFloatAsState(
                if (dismissState.targetValue == SwipeToDismissBoxValue.Settled) 0.75f else 1f,
                label = "swipe_scale"
            )

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(color, MaterialTheme.shapes.medium)
                    .padding(horizontal = 20.dp),
                contentAlignment = alignment
            ) {
                Icon(
                    icon,
                    contentDescription = null,
                    modifier = Modifier.scale(scale),
                    tint = iconTint
                )
            }
        },
        content = {
            if (compact) {
                NoteRow(
                    note = note,
                    isSelected = isSelected,
                    onClick = onClick,
                    onLongClick = onLongClick,
                    ownerLabel = ownerLabel,
                    highlightQuery = highlightQuery,
                    onTagClick = onTagClick
                )
            } else {
                NoteCard(
                    note = note,
                    isSelected = isSelected,
                    onClick = onClick,
                    onLongClick = onLongClick,
                    ownerLabel = ownerLabel,
                    highlightQuery = highlightQuery,
                    onTagClick = onTagClick
                )
            }
        }
    )
}

@OptIn(ExperimentalFoundationApi::class, ExperimentalLayoutApi::class)
@Composable
fun NoteCard(
    note: Note,
    isSelected: Boolean,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null,
    ownerLabel: String? = null,
    highlightQuery: String = "",
    onTagClick: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val containerColor = NoteColorUtil.colorFor(note.color)
    // Per-card ink (v1.7.0 Nr. 1): text/icons derived from the card color, not
    // the theme surface — every pair is WCAG-verified in ColorContrastTest.
    val cc = contentColorsFor(containerColor)
    val interactionSource = remember { MutableInteractionSource() }
    val pressed by interactionSource.collectIsPressedAsState()
    val pressScale by animateFloatAsState(
        targetValue = if (pressed) Motion.PRESS_SCALE else 1f,
        animationSpec = Motion.short(),
        label = "card_press_scale"
    )

    Card(
        modifier = modifier
            .fillMaxWidth()
            .graphicsLayer {
                scaleX = pressScale
                scaleY = pressScale
            }
            .doodleCard(CardShape)
            .combinedClickable(
                interactionSource = interactionSource,
                indication = LocalIndication.current,
                onClick = onClick,
                onLongClick = onLongClick
            ),
        shape = CardShape,
        // Tonal look (v1.7.0 Nr. 2): a real resting shadow instead of the
        // invisible 1dp, more on press.
        elevation = CardDefaults.cardElevation(
            defaultElevation = if (isSelected) 4.dp else 2.dp,
            pressedElevation = 6.dp,
            hoveredElevation = 3.dp
        ),
        colors = CardDefaults.cardColors(
            containerColor = containerColor,
            contentColor = cc.onCard
        ),
        border = if (isSelected) {
            CardDefaults.outlinedCardBorder().copy(width = 2.dp)
        } else {
            null
        }
    ) {
        CompositionLocalProvider(LocalContentColor provides cc.onCard) {
            Column(modifier = Modifier.animateContentSize(animationSpec = Motion.short())) {
                // Full-bleed cover (v1.7.0 Nr. 2): edge to edge, outside the
                // content padding, above title and text.
                note.images.firstOrNull()?.let { cover ->
                    NoteCardImageCover(note = note, cover = cover)
                }

                Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (note.title.isNotBlank()) {
                            Text(
                                text = SearchHighlight.annotate(note.title, highlightQuery),
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f)
                            )
                        } else {
                            Spacer(modifier = Modifier.weight(1f))
                        }
                        if (ownerLabel != null) {
                            OwnerBadge(ownerLabel, cc)
                        }
                        if (note.isPinned) {
                            Icon(
                                Icons.Default.PushPin,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                                tint = cc.accent
                            )
                        }
                    }

                    if (note.title.isNotBlank()) {
                        Spacer(modifier = Modifier.height(4.dp))
                    }

                    if (note.isTodoList) {
                        note.todoItems.take(5).forEach { item ->
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(vertical = 1.dp)
                            ) {
                                Checkbox(
                                    checked = item.isCompleted,
                                    onCheckedChange = null,
                                    modifier = Modifier.size(20.dp),
                                    colors = CheckboxDefaults.colors(
                                        checkedColor = cc.accent,
                                        uncheckedColor = cc.accent,
                                        checkmarkColor = cc.onCard
                                    )
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = item.text,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (item.isCompleted) cc.onCardVariant else cc.onCard,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                        if (note.todoItems.size > 5) {
                            Text(
                                text = "+${note.todoItems.size - 5}",
                                style = MaterialTheme.typography.labelSmall,
                                color = cc.onCardVariant
                            )
                        }
                    } else if (note.content.isNotBlank()) {
                        Text(
                            text = SearchHighlight.annotate(note.content, highlightQuery),
                            style = MaterialTheme.typography.bodySmall,
                            color = cc.onCard,
                            maxLines = 8,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    if (note.tags.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(8.dp))
                        // Wraps instead of clipping: in a narrow list pane three chips do
                        // not fit on one line and used to be cut in half.
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            note.tags.take(3).forEach { tag ->
                                TagChip(tag = tag, cc = cc, onTagClick = onTagClick)
                            }
                            if (note.tags.size > 3) {
                                TagOverflowChip(count = note.tags.size - 3, cc = cc)
                            }
                        }
                    }
                }
            }
        }
    }
}

/**
 * Own tag chip (v1.7.0 Nr. 3): 20dp-ish Surface in the card's translucent
 * chip colors instead of a 24dp SuggestionChip with a dead click — tapping a
 * tag now filters the list.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TagChip(
    tag: String,
    cc: NoteContentColors,
    onTagClick: ((String) -> Unit)?
) {
    if (onTagClick != null) {
        Surface(
            onClick = { onTagClick(tag) },
            color = cc.chipContainer,
            contentColor = cc.onCardVariant,
            border = BorderStroke(1.dp, cc.chipOutline),
            shape = RoundedCornerShape(8.dp)
        ) {
            TagChipLabel(tag)
        }
    } else {
        Surface(
            color = cc.chipContainer,
            contentColor = cc.onCardVariant,
            border = BorderStroke(1.dp, cc.chipOutline),
            shape = RoundedCornerShape(8.dp)
        ) {
            TagChipLabel(tag)
        }
    }
}

@Composable
private fun TagChipLabel(tag: String) {
    Text(
        text = tag,
        style = MaterialTheme.typography.labelSmall,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
    )
}

/** Non-interactive "+N" chip for tags beyond the third. */
@Composable
private fun TagOverflowChip(count: Int, cc: NoteContentColors) {
    Surface(
        color = cc.chipContainer,
        contentColor = cc.onCardVariant,
        border = BorderStroke(1.dp, cc.chipOutline),
        shape = RoundedCornerShape(8.dp)
    ) {
        Text(
            text = "+$count",
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
        )
    }
}

/**
 * Small "von X" chip on shared notes (v1.6.0 Nr. 10): the note belongs to
 * someone else and edits travel through their account. Since v1.7.0 it uses
 * the card's own translucent scrim + ink instead of theme-surface-on-color,
 * which had no guaranteed contrast on pastel cards.
 */
@Composable
private fun OwnerBadge(label: String, cc: NoteContentColors) {
    Surface(
        color = cc.chipContainer,
        contentColor = cc.onCardVariant,
        border = BorderStroke(1.dp, cc.chipOutline),
        shape = MaterialTheme.shapes.small,
        modifier = Modifier.padding(start = 0.dp)
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
        )
    }
}

/**
 * Full-bleed cover (v1.7.0 Nr. 2): the first image, cropped to a banner that
 * spans the whole card, with a subtle "+N" overlay when the note has more
 * attachments. Tapping the cover opens the fullscreen viewer instead of the
 * note.
 */
@Composable
private fun NoteCardImageCover(
    note: Note,
    cover: com.keeplocal.android.domain.model.NoteImage
) {
    var viewerOpen by remember { mutableStateOf(false) }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(130.dp)
            .clickable { viewerOpen = true }
    ) {
        AsyncImage(
            model = rememberMediaImageModel(cover.bestUrl()),
            contentDescription = cover.originalName ?: cover.filename,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize()
        )
        if (note.images.size > 1) {
            Surface(
                color = Color.Black.copy(alpha = 0.55f),
                contentColor = Color.White,
                shape = MaterialTheme.shapes.small,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(6.dp)
            ) {
                Text(
                    text = "+${note.images.size - 1}",
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                )
            }
        }
    }
    if (viewerOpen) {
        ImageViewerDialog(
            images = note.images,
            initialIndex = 0,
            onDismiss = { viewerOpen = false }
        )
    }
}

/**
 * Dense one-line-per-note row used by the list view mode — the layout that makes
 * long note collections scannable on a tablet or in the list pane.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun NoteRow(
    note: Note,
    isSelected: Boolean,
    onClick: () -> Unit,
    onLongClick: (() -> Unit)? = null,
    ownerLabel: String? = null,
    highlightQuery: String = "",
    onTagClick: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val containerColor = NoteColorUtil.colorFor(note.color)
    val cc = contentColorsFor(containerColor)
    val preview = when {
        note.isTodoList -> note.todoItems.joinToString("  ·  ") { item ->
            (if (item.isCompleted) "✓ " else "☐ ") + item.text
        }
        else -> note.content.replace('\n', ' ')
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .doodleCard(CardShape)
            .combinedClickable(onClick = onClick, onLongClick = onLongClick),
        shape = CardShape,
        elevation = CardDefaults.cardElevation(defaultElevation = if (isSelected) 4.dp else 2.dp),
        colors = CardDefaults.cardColors(
            containerColor = containerColor,
            contentColor = cc.onCard
        ),
        border = if (isSelected) {
            CardDefaults.outlinedCardBorder().copy(width = 2.dp)
        } else {
            null
        }
    ) {
        CompositionLocalProvider(LocalContentColor provides cc.onCard) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (note.isTodoList) {
                    Icon(
                        Icons.Default.CheckBox,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                        tint = cc.accent
                    )
                }
                // Small cover thumbnail so image notes stand out in dense rows.
                note.images.firstOrNull()?.let { cover ->
                    AsyncImage(
                        model = rememberMediaImageModel(cover.bestUrl()),
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .size(40.dp)
                            .clip(RoundedCornerShape(6.dp))
                    )
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = SearchHighlight.annotate(
                            note.title.ifBlank { preview.ifBlank { "—" } },
                            highlightQuery
                        ),
                        style = MaterialTheme.typography.titleSmall.copy(
                            fontWeight = FontWeight.Medium
                        ),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (note.title.isNotBlank() && preview.isNotBlank()) {
                        Text(
                            text = SearchHighlight.annotate(preview, highlightQuery),
                            style = MaterialTheme.typography.bodySmall,
                            color = cc.onCardVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }
                if (note.tags.isNotEmpty()) {
                    TagChip(tag = note.tags.first(), cc = cc, onTagClick = onTagClick)
                }
                if (ownerLabel != null) {
                    Text(
                        text = ownerLabel,
                        style = MaterialTheme.typography.labelSmall,
                        color = cc.onCardVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                if (note.isPinned) {
                    Icon(
                        Icons.Default.PushPin,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp),
                        tint = cc.accent
                    )
                }
            }
        }
    }
}
