package com.keeplocal.android.domain.model

data class Friend(
    val id: String,
    val username: String
)

data class FriendRequest(
    val id: String,
    val fromUser: String,
    val fromUsername: String,
    val toUser: String,
    val toUsername: String,
    val isIncoming: Boolean
)
