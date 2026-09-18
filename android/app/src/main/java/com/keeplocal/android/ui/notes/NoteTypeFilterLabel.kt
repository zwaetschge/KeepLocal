package com.keeplocal.android.ui.notes

import androidx.annotation.StringRes
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.NoteTypeFilter

/** Search-filter chip labels (v1.9.0 Nr. 7) — lives in the UI layer so the
 *  domain enum stays free of resource references. */
@get:StringRes
val NoteTypeFilter.labelRes: Int
    get() = when (this) {
        NoteTypeFilter.ALL -> R.string.filter_all
        NoteTypeFilter.LISTS -> R.string.filter_lists
        NoteTypeFilter.TEXT -> R.string.filter_text
        NoteTypeFilter.IMAGES -> R.string.filter_images
        NoteTypeFilter.REMINDERS -> R.string.filter_reminders
        NoteTypeFilter.PINNED -> R.string.filter_pinned
    }
