package com.keeplocal.android.data.repository

import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.dto.ApiKeyDto
import com.keeplocal.android.data.api.dto.CreateApiKeyRequestDto
import com.keeplocal.android.util.Result
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Wraps the /api/api-keys endpoints for the Settings screen (v1.14.0 Nr. 10:
 * route fixed — the app previously called /api/keys, which the server never
 * mounted, so the whole screen 404'd; expiry is the server's '30d'|'90d'|
 * '365d'|'never' vocabulary, not a day count). The plaintext key is only in
 * the response of POST — every other response reports name and prefix, so
 * the UI must treat creation as the one chance to show it.
 */
@Singleton
class ApiKeyRepository @Inject constructor(
    private val api: KeepLocalApi
) {
    suspend fun getApiKeys(): Result<List<ApiKeyDto>> = Result.catching {
        val response = api.getApiKeys()
        if (response.isSuccessful) {
            response.body()?.data ?: emptyList()
        } else {
            throw apiErrorException("GET /api/api-keys", response)
        }
    }

    /**
     * [expiresIn] uses the server vocabulary ('30d' | '90d' | '365d' |
     * 'never'); [allowWrite] adds the write scope — new keys are read-only
     * unless explicitly widened.
     */
    suspend fun createApiKey(
        name: String,
        expiresIn: String = "never",
        allowWrite: Boolean = false
    ): Result<ApiKeyDto> = Result.catching {
        val scopes = if (allowWrite) listOf("read", "write") else listOf("read")
        val response = api.createApiKey(CreateApiKeyRequestDto(name, expiresIn, scopes))
        if (response.isSuccessful) {
            // The server wraps the created key in {success, data, message} —
            // without unwrapping, the one-time plaintext key parses as null
            // (review v1.14.0) and is lost for good.
            response.body()?.data ?: throw Exception("No API key data in response")
        } else {
            throw apiErrorException("POST /api/api-keys", response)
        }
    }

    suspend fun revokeApiKey(id: String): Result<Unit> = Result.catching {
        val response = api.revokeApiKey(id)
        if (!response.isSuccessful) {
            throw apiErrorException("DELETE /api/api-keys/$id", response)
        }
    }

    /**
     * Surfaces the API's own validation text (e.g. the max-10-keys limit)
     * instead of a bare status code; the raw body never reaches the message.
     */
    private fun apiErrorException(operation: String, response: retrofit2.Response<*>): Exception {
        val body = try { response.errorBody()?.string()?.take(300) } catch (_: Exception) { null }
        val detail = serverMessage(body)
        return Exception(detail ?: "$operation failed (HTTP ${response.code()})")
    }

    private fun serverMessage(body: String?): String? {
        if (body.isNullOrBlank()) return null
        return Regex("\"message\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.getOrNull(1)
            ?: Regex("\"msg\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.getOrNull(1)
            ?: Regex("\"error\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.getOrNull(1)
    }
}
