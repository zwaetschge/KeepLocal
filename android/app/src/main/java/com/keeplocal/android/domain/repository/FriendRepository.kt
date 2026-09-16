package com.keeplocal.android.domain.repository

import com.keeplocal.android.domain.model.Friend
import com.keeplocal.android.domain.model.FriendRequest
import com.keeplocal.android.util.Result

interface FriendRepository {
    suspend fun getFriends(): Result<List<Friend>>
    suspend fun getRequests(): Result<List<FriendRequest>>
    suspend fun sendRequest(username: String): Result<Unit>
    suspend fun acceptRequest(id: String): Result<Unit>
    suspend fun rejectRequest(id: String): Result<Unit>
    suspend fun removeFriend(id: String): Result<Unit>
    suspend fun searchUsers(query: String): Result<List<Friend>>
}
