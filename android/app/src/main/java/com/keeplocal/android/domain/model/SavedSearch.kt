package com.keeplocal.android.domain.model

/**
 * One saved search / smart folder (v1.10.0): a search term, type filter and
 * tag pinned under a name. Synced through the account
 * (`preferences.savedSearches`), so every device offers the same set.
 * [typeFilter] is one of the server's literal keys: all/text/lists/images/
 * reminders/pinned.
 */
data class SavedSearch(
    val id: String,
    val name: String,
    val query: String = "",
    val typeFilter: String = "all",
    val tag: String = ""
)
