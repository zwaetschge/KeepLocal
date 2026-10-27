package com.keeplocal.android.util

import android.content.Context
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** The Latin model is bundled; recognizing a downloaded image needs no cloud API. */
suspend fun recognizeImageText(context: Context,file: File): String {
    val recognizer=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    return try {
        val image=InputImage.fromFilePath(context,Uri.fromFile(file))
        suspendCancellableCoroutine { continuation ->
            recognizer.process(image).addOnSuccessListener { result -> if(continuation.isActive)continuation.resume(result.text.take(10000)) }
                .addOnFailureListener { error -> if(continuation.isActive)continuation.resumeWithException(error) }
        }
    } finally {recognizer.close()}
}
