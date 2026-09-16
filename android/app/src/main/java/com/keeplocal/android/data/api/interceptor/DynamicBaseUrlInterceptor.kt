package com.keeplocal.android.data.api.interceptor

import com.keeplocal.android.data.local.SettingsDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.Response
import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject

class DynamicBaseUrlInterceptor @Inject constructor(
    settingsDataStore: SettingsDataStore
) : Interceptor {

    private val cachedUrl = AtomicReference("")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    init {
        settingsDataStore.serverUrl
            .onEach { cachedUrl.set(it) }
            .catch { /* DataStore read failure - use empty URL */ }
            .launchIn(scope)
    }

    override fun intercept(chain: Interceptor.Chain): Response {
        val originalRequest = chain.request()

        val serverUrl = cachedUrl.get()
        if (serverUrl.isNullOrBlank()) return chain.proceed(originalRequest)

        val normalizedUrl = if (serverUrl.startsWith("http://") || serverUrl.startsWith("https://")) {
            serverUrl.trimEnd('/')
        } else {
            "https://${serverUrl.trimEnd('/')}"
        }

        val newBaseUrl = "$normalizedUrl/".toHttpUrlOrNull() ?: return chain.proceed(originalRequest)

        val urlBuilder = originalRequest.url.newBuilder()
            .scheme(newBaseUrl.scheme)
            .host(newBaseUrl.host)

        // Only set port if it differs from the scheme default (80 for http, 443 for https).
        // OkHttp's HttpUrl.Builder.port() throws IllegalArgumentException for invalid values,
        // and when no explicit port is in the URL, we must not override the default.
        val port = newBaseUrl.port
        val defaultPort = HttpUrl.defaultPort(newBaseUrl.scheme)
        if (port != defaultPort) {
            urlBuilder.port(port)
        }

        val newUrl = urlBuilder.build()

        val newRequest = originalRequest.newBuilder()
            .url(newUrl)
            .build()

        return chain.proceed(newRequest)
    }
}
