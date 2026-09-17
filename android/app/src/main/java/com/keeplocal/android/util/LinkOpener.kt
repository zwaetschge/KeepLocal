package com.keeplocal.android.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

/**
 * Opens a URL from note content (v1.8.0 Nr. 6) in a Chrome Custom Tab — the
 * page loads in the app's context instead of dumping the user into a browser.
 * Falls back to the plain VIEW intent when no Custom Tabs provider exists,
 * and stays silent when the device has no handler at all.
 */
object LinkOpener {

    fun open(context: Context, url: String) {
        val uri = Uri.parse(url)
        try {
            CustomTabsIntent.Builder()
                .setShowTitle(true)
                .build()
                .launchUrl(context, uri)
        } catch (_: Exception) {
            runCatching {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
        }
    }
}
