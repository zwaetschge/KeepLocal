package com.keeplocal.android.ui.components

import com.keeplocal.android.R
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource

/** Formats recording elapsed time as m:ss (e.g. "0:07", "12:05"). */
internal fun formatRecordingDuration(elapsedMs: Long): String {
    val totalSeconds = elapsedMs.coerceAtLeast(0) / 1000
    return "%d:%02d".format(totalSeconds / 60, totalSeconds % 60)
}

/**
 * Microphone / dictation button for the note editor with three visual states:
 * idle (mic icon), recording (stop icon, pulsing red dot and m:ss timer) and
 * transcribing (spinner + hint text, not clickable — jobs run 30-60s).
 *
 * Clicking while the note cannot be transcribed yet (unsaved / offline id)
 * still invokes [onClick]; the caller answers with an explanatory hint.
 */
@Composable
fun AudioRecordButton(
    isRecording: Boolean,
    isTranscribing: Boolean,
    elapsedMs: Long,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onClick, enabled = !isTranscribing) {
            when {
                isTranscribing -> {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp
                    )
                }
                isRecording -> {
                    Icon(
                        Icons.Default.Stop,
                        contentDescription = stringResource(R.string.editor_stop_recording),
                        tint = MaterialTheme.colorScheme.error
                    )
                }
                else -> {
                    Icon(
                        Icons.Default.Mic,
                        contentDescription = stringResource(R.string.editor_start_recording)
                    )
                }
            }
        }

        if (isRecording) {
            PulsingRecordingDot()
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = formatRecordingDuration(elapsedMs),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.error
            )
        } else if (isTranscribing) {
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = stringResource(R.string.editor_transcribing),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

/** Simple pulsing circle — enough visualization for a dictation session. */
@Composable
private fun PulsingRecordingDot() {
    val transition = rememberInfiniteTransition(label = "record_pulse")
    val pulse by transition.animateFloat(
        initialValue = 0.55f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(600), RepeatMode.Reverse),
        label = "record_pulse_value"
    )
    Box(
        modifier = Modifier
            .size(10.dp)
            .scale(pulse)
            .alpha(pulse)
            .background(Color.Red, CircleShape)
    )
}
