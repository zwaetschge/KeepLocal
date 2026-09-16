package com.keeplocal.android.data.api.interceptor

import com.keeplocal.android.data.local.TokenManager
import com.keeplocal.android.util.FileLogger
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import javax.inject.Inject

class AuthInterceptor @Inject constructor(
    private val tokenManager: TokenManager
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val log = FileLogger.get()
        val originalRequest = chain.request()
        val builder = originalRequest.newBuilder()

        try {
            val jwt = tokenManager.getJwtToken()
            if (!jwt.isNullOrBlank()) {
                builder.addHeader("Authorization", "Bearer $jwt")
            }

            val method = originalRequest.method
            if (method in MUTATING_METHODS) {
                val csrf = tokenManager.getCsrfToken()
                if (!csrf.isNullOrBlank()) {
                    builder.addHeader("X-CSRF-Token", csrf)
                }
            }

            // Cookies (Authelia session + CSRF secret) are attached by SessionCookieJar.
            log?.log("AuthInterceptor", "url=${originalRequest.url} method=$method jwt=${if (jwt.isNullOrBlank()) "none" else "present"}")
        } catch (e: Exception) {
            log?.error("AuthInterceptor", "Failed to add auth headers", e)
        }

        var request = builder.build()
        var response = chain.proceed(request)

        // A stale CSRF token is recoverable: fetch a fresh one (the cookie jar keeps
        // the matching secret cookie) and replay the request once.
        if (response.code == 403 && originalRequest.method in MUTATING_METHODS && looksLikeCsrfFailure(response)) {
            log?.log("AuthInterceptor", "CSRF rejected, refreshing token and retrying once")
            response.close()
            val freshToken = fetchCsrfToken(chain, originalRequest)
            if (freshToken != null) {
                tokenManager.saveCsrfToken(freshToken)
                request = request.newBuilder().header("X-CSRF-Token", freshToken).build()
                response = chain.proceed(request)
            } else {
                response = chain.proceed(request)
            }
        }

        val code = response.code
        val locationHeader = response.header("Location") ?: ""
        log?.log("AuthInterceptor", "response $code for ${originalRequest.url}${if (locationHeader.isNotEmpty()) " with redirect location" else ""}")

        // Detect Authelia blocking the request:
        // 1. Redirect (301-303) with Location pointing to auth domain
        if (code in 301..303 && locationHeader.isNotEmpty() &&
            (locationHeader.contains("authelia") || locationHeader.contains("auth."))) {
            log?.error("AuthInterceptor", "Authelia redirect detected (code=$code), session expired")
            response.close()
            return Response.Builder()
                .request(originalRequest)
                .protocol(Protocol.HTTP_1_1)
                .code(401)
                .message("Authelia session expired")
                .body("{\"error\":\"Authelia session expired. Please re-authenticate via Authelia.\"}".toResponseBody())
                .build()
        }

        // 2. 401 with HTML body containing auth redirect (Authelia returns this for some configs)
        if (code == 401) {
            val contentType = response.header("Content-Type") ?: ""
            if (contentType.contains("text/html") || contentType.isEmpty()) {
                val body = response.peekBody(2048).string()
                if (body.contains("auth.") || body.contains("authelia") || body.contains("Unauthorized")) {
                    log?.error("AuthInterceptor", "Authelia 401 HTML response detected, session expired")
                    response.close()
                    return Response.Builder()
                        .request(originalRequest)
                        .protocol(Protocol.HTTP_1_1)
                        .code(401)
                        .message("Authelia session expired")
                        .body("{\"error\":\"Authelia session expired. Please re-authenticate via Authelia.\"}".toResponseBody())
                        .build()
                }
            }
        }

        return response
    }

    private fun looksLikeCsrfFailure(response: Response): Boolean = runCatching {
        response.peekBody(512).string().contains("csrf", ignoreCase = true)
    }.getOrDefault(false)

    /** Re-reads `GET /api/csrf-token` on the same chain so the jar records the secret cookie. */
    private fun fetchCsrfToken(chain: Interceptor.Chain, source: Request): String? = runCatching {
        val url = source.url.newBuilder()
            .encodedPath("/api/csrf-token")
            .encodedQuery(null)
            .build()
        chain.proceed(Request.Builder().url(url).get().build()).use { response ->
            if (!response.isSuccessful) return null
            val body = response.body?.string() ?: return null
            CSRF_TOKEN_PATTERN.find(body)?.groupValues?.getOrNull(1)
        }
    }.getOrNull()

    private companion object {
        val MUTATING_METHODS = setOf("POST", "PUT", "PATCH", "DELETE")
        val CSRF_TOKEN_PATTERN = Regex("\"csrfToken\"\\s*:\\s*\"([^\"]+)\"")
    }
}
