package com.keeplocal.android.ui.components

import com.keeplocal.android.R
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import coil.compose.AsyncImage
import com.keeplocal.android.domain.model.NoteImage

/** Thumbnails per grid row in the editor image grid. */
private const val GRID_COLUMNS = 3

private sealed interface GridCell {
    data class Ready(val image: NoteImage) : GridCell
    data object Uploading : GridCell
}

/**
 * Square thumbnail grid for a note's image attachments. Tapping a thumbnail
 * opens the fullscreen viewer (via [onImageClick] with the image index);
 * each cell carries a small delete affordance. While an upload is running,
 * [uploadingCount] placeholder cells with spinners are appended — one per
 * image in flight.
 */
@Composable
fun NoteImageGrid(
    images: List<NoteImage>,
    uploadingCount: Int,
    onImageClick: (Int) -> Unit,
    onDeleteImage: (NoteImage) -> Unit,
    modifier: Modifier = Modifier
) {
    val cells: List<GridCell> = images.map { GridCell.Ready(it) } +
        List(uploadingCount.coerceAtLeast(0)) { GridCell.Uploading }

    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        cells.chunked(GRID_COLUMNS).forEachIndexed { rowIndex, rowCells ->
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                rowCells.forEachIndexed { columnIndex, cell ->
                    val absoluteIndex = rowIndex * GRID_COLUMNS + columnIndex
                    when (cell) {
                        is GridCell.Ready -> ImageThumbCell(
                            image = cell.image,
                            onClick = { onImageClick(absoluteIndex) },
                            onDelete = { onDeleteImage(cell.image) },
                            modifier = Modifier.weight(1f)
                        )
                        is GridCell.Uploading -> UploadingCell(modifier = Modifier.weight(1f))
                    }
                }
                // Keep the last row aligned when it is not full.
                repeat(GRID_COLUMNS - rowCells.size) { Spacer(modifier = Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun ImageThumbCell(
    image: NoteImage,
    onClick: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
    ) {
        AsyncImage(
            model = rememberMediaImageModel(image.bestUrl()),
            contentDescription = image.originalName ?: image.filename,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize()
        )
        Surface(
            color = Color.Black.copy(alpha = 0.55f),
            contentColor = Color.White,
            shape = CircleShape,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(4.dp)
                .size(22.dp)
                .clickable(onClick = onDelete)
        ) {
            Icon(
                Icons.Default.Close,
                contentDescription = stringResource(R.string.editor_remove_image),
                modifier = Modifier.padding(4.dp)
            )
        }
    }
}

@Composable
private fun UploadingCell(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(8.dp)),
        contentAlignment = Alignment.Center
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier.fillMaxSize()
        ) {}
        CircularProgressIndicator(
            modifier = Modifier.size(24.dp),
            strokeWidth = 2.dp
        )
    }
}
