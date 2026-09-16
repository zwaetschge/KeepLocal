package com.keeplocal.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.ui.theme.LocalIsDarkTheme
import com.keeplocal.android.ui.theme.NoteColors

@Composable
fun ColorPicker(
    selectedColor: NoteColor,
    onColorSelected: (NoteColor) -> Unit,
    modifier: Modifier = Modifier
) {
    val isDark = LocalIsDarkTheme.current

    LazyRow(
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(NoteColor.entries.toList()) { noteColor ->
            val color = NoteColorUtil.colorFor(noteColor)
            val isSelected = noteColor == selectedColor
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(color)
                    .then(
                        if (isSelected) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, CircleShape)
                        else Modifier.border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.3f), CircleShape)
                    )
                    .clickable { onColorSelected(noteColor) }
                    .semantics { contentDescription = noteColor.name },
                contentAlignment = Alignment.Center
            ) {
                if (isSelected) {
                    Icon(
                        Icons.Filled.Check,
                        contentDescription = null,
                        tint = if (isDark) Color.White else Color.Black,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}

fun getNoteColor(noteColor: NoteColor, isDark: Boolean): Color = when (noteColor) {
    NoteColor.DEFAULT -> if (isDark) NoteColors.Default else NoteColors.DefaultLight
    NoteColor.RED -> if (isDark) NoteColors.Red else NoteColors.RedLight
    NoteColor.ORANGE -> if (isDark) NoteColors.Orange else NoteColors.OrangeLight
    NoteColor.YELLOW -> if (isDark) NoteColors.Yellow else NoteColors.YellowLight
    NoteColor.GREEN -> if (isDark) NoteColors.Green else NoteColors.GreenLight
    NoteColor.TEAL -> if (isDark) NoteColors.Teal else NoteColors.TealLight
    NoteColor.BLUE -> if (isDark) NoteColors.Blue else NoteColors.BlueLight
    NoteColor.DARK_BLUE -> if (isDark) NoteColors.DarkBlue else NoteColors.DarkBlueLight
    NoteColor.PURPLE -> if (isDark) NoteColors.Purple else NoteColors.PurpleLight
    NoteColor.PINK -> if (isDark) NoteColors.Pink else NoteColors.PinkLight
    NoteColor.BROWN -> if (isDark) NoteColors.Brown else NoteColors.BrownLight
    NoteColor.GRAY -> if (isDark) NoteColors.Gray else NoteColors.GrayLight
}
