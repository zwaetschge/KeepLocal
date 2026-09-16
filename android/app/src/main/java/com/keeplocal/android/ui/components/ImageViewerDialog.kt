package com.keeplocal.android.ui.components

import com.keeplocal.android.R
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.res.stringResource
import coil.compose.AsyncImage
import com.keeplocal.android.domain.model.NoteImage

/**
 * Pure index navigation for the image viewer, free of composables so it can
 * be unit tested.
 */
internal object ImageViewerNavigation {
    /** Safely bounds an incoming index (e.g. after the image list shrank). */
    fun clamp(index: Int, count: Int): Int = when {
        count <= 0 -> 0
        index < 0 -> 0
        index >= count -> count - 1
        else -> index
    }

    fun next(index: Int, count: Int): Int = if (count <= 1) 0 else (index + 1) % count

    fun previous(index: Int, count: Int): Int = if (count <= 1) 0 else (index - 1 + count) % count
}

/**
 * Fullscreen image viewer with prev/next navigation, an "n/m" counter and a
 * close button. Pinch-zoom is deliberately not hand-rolled here — the image
 * is shown fit-to-screen; a zoomable library would be an extra dependency.
 *
 * The system back gesture/button dismisses the dialog (onDismissRequest),
 * which closes the whole viewer — the same as the X button.
 */
@Composable
fun ImageViewerDialog(
    images: List<NoteImage>,
    initialIndex: Int,
    onDismiss: () -> Unit
) {
    if (images.isEmpty()) {
        onDismiss()
        return
    }
    var index by remember(images) { mutableIntStateOf(ImageViewerNavigation.clamp(initialIndex, images.size)) }
    val image = images[index]

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(color = Color.Black.copy(alpha = 0.95f), modifier = Modifier.fillMaxSize()) {
            Box(modifier = Modifier.fillMaxSize()) {
                AsyncImage(
                    model = rememberMediaImageModel(image.url),
                    contentDescription = image.originalName ?: image.filename,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Fit
                )

                // Close (X)
                IconButton(
                    onClick = onDismiss,
                    modifier = Modifier.align(Alignment.TopEnd)
                ) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = stringResource(R.string.cd_close),
                        tint = Color.White
                    )
                }

                // Counter "2/5"
                Surface(
                    color = Color.Black.copy(alpha = 0.5f),
                    contentColor = Color.White,
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = 40.dp)
                ) {
                    Text(
                        text = "${index + 1}/${images.size}",
                        style = MaterialTheme.typography.labelMedium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                    )
                }

                if (images.size > 1) {
                    // Previous
                    IconButton(
                        onClick = { index = ImageViewerNavigation.previous(index, images.size) },
                        modifier = Modifier.align(Alignment.CenterStart)
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                            contentDescription = stringResource(R.string.viewer_previous_image),
                            tint = Color.White,
                            modifier = Modifier.size(32.dp)
                        )
                    }
                    // Next
                    IconButton(
                        onClick = { index = ImageViewerNavigation.next(index, images.size) },
                        modifier = Modifier.align(Alignment.CenterEnd)
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = stringResource(R.string.viewer_next_image),
                            tint = Color.White,
                            modifier = Modifier.size(32.dp)
                        )
                    }
                }

                // Original file name as caption when known
                if (!image.originalName.isNullOrBlank()) {
                    Surface(
                        color = Color.Black.copy(alpha = 0.5f),
                        contentColor = Color.White,
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 24.dp)
                    ) {
                        Text(
                            text = image.originalName.orEmpty(),
                            style = MaterialTheme.typography.labelMedium,
                            textAlign = TextAlign.Center,
                            maxLines = 1,
                            modifier = Modifier
                                .fillMaxWidth(0.8f)
                                .padding(horizontal = 12.dp, vertical = 4.dp)
                        )
                    }
                }
            }
        }
    }
}
