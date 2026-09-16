package com.keeplocal.android.domain.model

/**
 * Which OAuth providers the deployment has configured
 * (GET /api/auth/providers). Only enabled ones get a login button — the
 * server disables a provider when its client ID/secret is not set.
 */
data class OAuthProviders(
    val google: Boolean = false,
    val github: Boolean = false,
    val demo: Boolean = false
) {
    val hasAnyProvider: Boolean get() = google || github || demo
}
