package com.keeplocal.android.domain.model

data class AdminStats(
    val userCount: Int,
    val noteCount: Int
)

data class AdminSettings(
    val registrationEnabled: Boolean
)
