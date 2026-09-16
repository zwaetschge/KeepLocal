package com.keeplocal.android.domain.model

import java.time.Instant

data class User(
    val id: String,
    val username: String,
    val isAdmin: Boolean,
    val createdAt: Instant
)
