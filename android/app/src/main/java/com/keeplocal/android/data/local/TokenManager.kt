package com.keeplocal.android.data.local

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

private const val SECURE_PREFS_NAME = "keeplocal_secure_prefs"

/**
 * Creates the shared encrypted prefs file, deleting and recreating a
 * corrupted file once before giving up.
 */
private fun createEncryptedPrefs(context: Context): SharedPreferences? {
    return try {
        EncryptedSharedPreferences.create(
            SECURE_PREFS_NAME,
            MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
            context,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    } catch (e: Exception) {
        Log.w("TokenManager", "EncryptedSharedPreferences failed, trying to recover", e)
        try {
            // Clear potentially corrupted prefs file
            context.deleteSharedPreferences(SECURE_PREFS_NAME)
            EncryptedSharedPreferences.create(
                SECURE_PREFS_NAME,
                MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC),
                context,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        } catch (e2: Exception) {
            Log.e("TokenManager", "EncryptedSharedPreferences recovery failed", e2)
            null
        }
    }
}

/** The login credentials kept for silent re-login when the JWT has expired. */
data class SavedCredentials(val email: String, val password: String)

/**
 * Persistence for [SavedCredentials]. Split out as an interface so the
 * round-trip logic can be unit tested with a fake instead of Android's
 * EncryptedSharedPreferences, which needs a keystore-backed device.
 */
interface CredentialsStore {
    fun save(email: String, password: String)
    fun load(): SavedCredentials?
    fun clear()
}

/**
 * Production [CredentialsStore] on top of EncryptedSharedPreferences. It
 * shares the "keeplocal_secure_prefs" file with the tokens so a full
 * [TokenManager.clearAll] wipes the credentials together with the session.
 * The API authenticates by email, so that is what gets stored.
 */
@Singleton
class EncryptedCredentialsStore @Inject constructor(
    @ApplicationContext private val context: Context
) : CredentialsStore {

    private val prefs: SharedPreferences by lazy {
        createEncryptedPrefs(context)
            ?: error("EncryptedSharedPreferences unavailable; refusing to store credentials in plaintext")
    }

    override fun save(email: String, password: String) {
        prefs.edit()
            .putString(KEY_EMAIL, email)
            .putString(KEY_PASSWORD, password)
            .apply()
    }

    override fun load(): SavedCredentials? {
        val email = prefs.getString(KEY_EMAIL, null) ?: return null
        val password = prefs.getString(KEY_PASSWORD, null) ?: return null
        if (email.isBlank() || password.isBlank()) return null
        return SavedCredentials(email, password)
    }

    override fun clear() {
        try {
            prefs.edit().remove(KEY_EMAIL).remove(KEY_PASSWORD).apply()
        } catch (_: Exception) {}
    }

    private companion object {
        const val KEY_EMAIL = "saved_email"
        const val KEY_PASSWORD = "saved_password"
    }
}

@Singleton
class TokenManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val credentialsStore: CredentialsStore
) {
    private val prefs: SharedPreferences by lazy {
        createEncryptedPrefs(context) ?: error("EncryptedSharedPreferences unavailable; refusing to store secrets in plaintext")
    }

    fun saveJwtToken(token: String) {
        prefs.edit().putString(KEY_JWT, token).apply()
    }

    fun getJwtToken(): String? = try {
        prefs.getString(KEY_JWT, null)
    } catch (e: Exception) {
        Log.w("TokenManager", "Error reading JWT token", e)
        null
    }

    fun saveCsrfToken(token: String) {
        prefs.edit().putString(KEY_CSRF, token).apply()
    }

    fun getCsrfToken(): String? = try {
        prefs.getString(KEY_CSRF, null)
    } catch (e: Exception) {
        Log.w("TokenManager", "Error reading CSRF token", e)
        null
    }

    fun saveAutheliaCookies(cookies: String) {
        prefs.edit().putString(KEY_AUTHELIA_COOKIES, cookies).apply()
    }

    fun getAutheliaCookies(): String? = try {
        prefs.getString(KEY_AUTHELIA_COOKIES, null)
    } catch (e: Exception) {
        Log.w("TokenManager", "Error reading Authelia cookies", e)
        null
    }

    /**
     * Persists the login credentials so a fresh app start can re-login
     * silently once the JWT expired. Blank values are ignored — a half-saved
     * pair would only produce a broken auto-login later.
     */
    fun saveCredentials(email: String, password: String) {
        val trimmedEmail = email.trim()
        if (trimmedEmail.isBlank() || password.isBlank()) return
        try {
            credentialsStore.save(trimmedEmail, password)
        } catch (_: Exception) {}
    }

    fun getSavedCredentials(): SavedCredentials? = try {
        credentialsStore.load()
    } catch (e: Exception) {
        Log.w("TokenManager", "Error reading saved credentials", e)
        null
    }

    fun clearCredentials() {
        try {
            credentialsStore.clear()
        } catch (_: Exception) {}
    }

    /** True when either a JWT or harvested Authelia cookies are stored. */
    fun hasStoredSession(): Boolean =
        !getJwtToken().isNullOrBlank() || !getAutheliaCookies().isNullOrBlank()

    fun clearAll() {
        try {
            clearCredentials()
            prefs.edit().clear().apply()
        } catch (_: Exception) {}
    }

    companion object {
        private const val KEY_JWT = "jwt_token"
        private const val KEY_CSRF = "csrf_token"
        private const val KEY_AUTHELIA_COOKIES = "authelia_cookies"
    }
}
