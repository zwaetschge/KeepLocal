package com.keeplocal.android.widget

import android.app.PendingIntent
import android.content.Intent
import android.service.quicksettings.TileService
import com.keeplocal.android.ui.MainActivity
import com.keeplocal.android.util.IncomingIntents

/**
 * Quick-settings tile "Neue Notiz": one tap from anywhere in the system
 * opens the editor. Stateless by design — no need to bind while inactive.
 */
class NewNoteTileService : TileService() {

    override fun onClick() {
        super.onClick()
        val intent = Intent(this, MainActivity::class.java).apply {
            putExtra(IncomingIntents.EXTRA_NEW_NOTE, true)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        // API 33+: only the PendingIntent overload of startActivityAndCollapse.
        val pending = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        startActivityAndCollapse(pending)
    }
}
