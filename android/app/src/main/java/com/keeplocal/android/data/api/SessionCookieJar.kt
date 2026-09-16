package com.keeplocal.android.data.api

import com.keeplocal.android.data.local.TokenManager
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import java.util.concurrent.ConcurrentHashMap
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Keeps the server's session cookies for the lifetime of the process.
 *
 * KeepLocal's API uses double-submit CSRF protection: `GET /api/csrf-token`
 * returns a token *and* sets a matching secret cookie, and every mutating
 * request has to send both back. Without a cookie jar only the header was
 * returned, so creating or editing a note always failed with
 * `403 Ungültiger CSRF-Token` and silently fell back to the offline queue.
 *
 * Authelia cookies captured by the login WebView are merged in here too, so
 * OkHttp's own `Cookie` header does not overwrite them.
 */
@Singleton
class SessionCookieJar @Inject constructor(
    private val tokenManager: TokenManager
) : CookieJar {

    private val store = ConcurrentHashMap<String, MutableMap<String, Cookie>>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (cookies.isEmpty()) return
        val host = store.getOrPut(url.host) { ConcurrentHashMap() }
        cookies.forEach { cookie ->
            if (cookie.expiresAt < System.currentTimeMillis()) {
                host.remove(cookie.name)
            } else {
                host[cookie.name] = cookie
            }
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        val stored = store[url.host]
            ?.values
            ?.filter { it.expiresAt > now && it.matches(url) }
            .orEmpty()

        val autheliaNames = mutableSetOf<String>()
        val authelia = parseAutheliaCookies(url).also { list ->
            list.forEach { autheliaNames += it.name }
        }

        // Authelia's session cookie wins over anything cached for the same name.
        return authelia + stored.filterNot { it.name in autheliaNames }
    }

    /** Cookies harvested from the Authelia WebView are stored as a raw header string. */
    private fun parseAutheliaCookies(url: HttpUrl): List<Cookie> {
        val raw = runCatching { tokenManager.getAutheliaCookies() }.getOrNull()
        if (raw.isNullOrBlank()) return emptyList()
        return raw.split(';').mapNotNull { part ->
            val trimmed = part.trim()
            if (trimmed.isEmpty()) return@mapNotNull null
            val separator = trimmed.indexOf('=')
            if (separator <= 0) return@mapNotNull null
            Cookie.Builder()
                .name(trimmed.substring(0, separator).trim())
                .value(trimmed.substring(separator + 1).trim())
                .domain(url.host)
                .path("/")
                .build()
        }
    }

    fun clear() {
        store.clear()
    }
}
