package com.keeplocal.android.ui.components

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import coil.request.ImageRequest
import com.keeplocal.android.data.repository.MediaRepositoryImpl
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent

/**
 * Hilt entry point for places that render server media without a backing
 * ViewModel — the note cards in the list, for example. MediaRepositoryImpl is
 * used directly (not the domain interface) because image loading also needs
 * the authenticated OkHttp call factory.
 */
@EntryPoint
@InstallIn(SingletonComponent::class)
interface MediaEntryPoint {
    fun mediaRepositoryImpl(): MediaRepositoryImpl
}

/** Access to the singleton [MediaRepositoryImpl] from non-Hilt call sites. */
object MediaLoading {
    fun repository(context: Context): MediaRepositoryImpl =
        EntryPointAccessors.fromApplication(context.applicationContext, MediaEntryPoint::class.java)
            .mediaRepositoryImpl()
}

/**
 * Builds the Coil model for a server-relative media path. Loads through the
 * authenticated OkHttp client so /uploads requests carry the session cookie
 * (the server authenticates image files by cookie, not Bearer header), and
 * resolves the absolute URL. During the cold-start window — before DataStore
 * has emitted the server URL — it briefly suspends and retries once.
 *
 * Returns null when there is nothing loadable; callers simply render nothing.
 */
@Composable
fun rememberMediaImageModel(path: String?): Any? {
    if (path.isNullOrBlank()) return null
    val context = LocalContext.current
    val repository = remember { MediaLoading.repository(context) }
    var model by remember(path) {
        mutableStateOf<Any?>(
            repository.resolveImageUrl(path)?.let { url -> buildMediaImageRequest(context, repository, url) }
        )
    }
    if (model == null) {
        LaunchedEffect(path) {
            model = repository.awaitImageUrl(path)?.let { url ->
                buildMediaImageRequest(context, repository, url)
            }
        }
    }
    return model
}

private fun buildMediaImageRequest(
    context: Context,
    repository: MediaRepositoryImpl,
    url: String
): ImageRequest = ImageRequest.Builder(context)
    .data(url)
    .crossfade(true)
    // The cookie-authenticated OkHttp client is attached app-wide via
    // KeepLocalApplication.newImageLoader() — Coil 2 has no per-request
    // call factory.
    .build()
