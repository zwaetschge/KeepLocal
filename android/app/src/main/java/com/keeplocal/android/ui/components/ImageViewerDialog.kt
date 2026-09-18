package com.keeplocal.android.ui.components

import com.keeplocal.android.R
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntSize
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
 * Pure zoom state math (v1.9.0 Nr. 4) so clamping/panning is unit-testable
 * without composing anything.
 */
internal object ImageViewerZoom {
    const val MIN_SCALE = 1f
    const val MAX_SCALE = 5f
    const val DOUBLE_TAP_SCALE = 2.5f

    fun applyZoom(scale: Float, zoomDelta: Float): Float =
        (scale * zoomDelta).coerceIn(MIN_SCALE, MAX_SCALE)

    /**
     * Pan bound: the image may move at most half its own scaled overshoot per
     * axis, so the fingers can never push the picture fully off screen.
     */
    fun applyPan(offset: Offset, pan: Offset, scale: Float, viewport: IntSize): Offset {
        val maxX = (viewport.width * (scale - 1f)) / 2f
        val maxY = (viewport.height * (scale - 1f)) / 2f
        return Offset(
            (offset.x + pan.x).coerceIn(-maxX, maxX),
            (offset.y + pan.y).coerceIn(-maxY, maxY)
        )
    }
}

/**
 * Full-screen image viewer over a note's attachments. v1.9.0 Nr. 4: pinch to
 * zoom (1x–5x), drag to pan while zoomed, double-tap toggles between 1x and
 * 2.5x, and save-to-gallery / share actions download the current image via
 * [onSaveImage]/[onShareImage] (both get the full-size URL, not the
 * thumbnail).
 *
 * The system back gesture/button dismisses the dialog (onDismissRequest),
 * which closes the whole viewer — the same as the X button.
 */
@Composable
fun ImageViewerDialog(
    images: List<NoteImage>,
    initialIndex: Int,
    onDismiss: () -> Unit,
    onSaveImage: ((NoteImage) -> Unit)? = null,
    onShareImage: ((NoteImage) -> Unit)? = null
) {
    if (images.isEmpty()) {
        onDismiss()
        return
    }
    var index by remember(images) { mutableIntStateOf(ImageViewerNavigation.clamp(initialIndex, images.size)) }
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    val image = images[index]

    fun resetZoom() {
        scale = 1f
        offset = Offset.Zero
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(color = Color.Black.copy(alpha = 0.95f), modifier = Modifier.fillMaxSize()) {
            Box(modifier = Modifier.fillMaxSize()) {
                AsyncImage(
                    model = rememberMediaImageModel(image.url),
                    contentDescription = image.originalName ?: image.filename,
                    modifier = Modifier
                        .fillMaxSize()
                        .onSizeChanged { viewport = it }
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            translationX = offset.x
                            translationY = offset.y
                        }
                        // Two pointerInput modifiers: transform gestures
                        // consume drag, tap detection needs its own stream.
                        .pointerInput(images, index) {
                            detectTransformGestures { _, pan, zoom, _ ->
                                val newScale = ImageViewerZoom.applyZoom(scale, zoom)
                                scale = newScale
                                offset = if (newScale > 1f) {
                                    ImageViewerZoom.applyPan(offset, pan, newScale, viewport)
                                } else {
                                    Offset.Zero
                                }
                            }
                        }
                        .pointerInput(images, index) {
                            detectTapGestures(
                                onDoubleTap = {
                                    if (scale > 1f) resetZoom() else scale = ImageViewerZoom.DOUBLE_TAP_SCALE
                                }
                            )
                        },
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
                        onClick = {
                            resetZoom()
                            index = ImageViewerNavigation.previous(index, images.size)
                        },
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
                        onClick = {
                            resetZoom()
                            index = ImageViewerNavigation.next(index, images.size)
                        },
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

                // Save / share (v1.9.0) — the actions download the full-size
                // original, so they are hidden when the caller has none.
                if (onSaveImage != null || onShareImage != null) {
                    Surface(
                        color = Color.Black.copy(alpha = 0.5f),
                        contentColor = Color.White,
                        shape = MaterialTheme.shapes.small,
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(bottom = 24.dp, end = 8.dp)
                    ) {
                        Row {
                            if (onShareImage != null) {
                                IconButton(onClick = { onShareImage(image) }) {
                                    Icon(
                                        Icons.Default.Share,
                                        contentDescription = stringResource(R.string.viewer_share_image),
                                        tint = Color.White
                                    )
                                }
                            }
                            if (onSaveImage != null) {
                                IconButton(onClick = { onSaveImage(image) }) {
                                    Icon(
                                        Icons.Default.Download,
                                        contentDescription = stringResource(R.string.viewer_save_image),
                                        tint = Color.White
                                    )
                                }
                            }
                        }
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
