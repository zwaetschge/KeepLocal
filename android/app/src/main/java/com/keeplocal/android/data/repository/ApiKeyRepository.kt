package com.keeplocal.android.data.repository

import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.dto.ApiKeyDto
import com.keeplocal.android.data.api.dto.CreateApiKeyRequestDto
import com.keeplocal.android.util.Result
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Wraps the /api/keys endpoints for the Settings screen. The plaintext key
 * is only contained in the response of POST /api/keys — every other response
 * reports just name and prefix, so the UI must treat creation as the one
 * chance to show it.
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
            throw apiErrorException("GET /api/keys", response)
        }
    }

    suspend fun createApiKey(name: String, expiresInDays: Int?): Result<ApiKeyDto> = Result.catching {
        val response = api.createApiKey(CreateApiKeyRequestDto(name, expiresInDays))
        if (response.isSuccessful) {
            response.body() ?: throw Exception("No API key data in response")
        } else {
            throw apiErrorException("POST /api/keys", response)
        }
    }

    suspend fun revokeApiKey(id: String): Result<Unit> = Result.catching {
        val response = api.revokeApiKey(id)
        if (!response.isSuccessful) {
            throw apiErrorException("DELETE /api/keys/$id", response)
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
