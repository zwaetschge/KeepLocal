package com.keeplocal.android.data.repository

import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.dto.FriendRequestBody
import com.keeplocal.android.data.api.dto.toDomain
import com.keeplocal.android.domain.model.Friend
import com.keeplocal.android.domain.model.FriendRequest
import com.keeplocal.android.domain.repository.FriendRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class FriendRepositoryImpl @Inject constructor(
    private val api: KeepLocalApi
) : FriendRepository {

    override suspend fun getFriends(): Result<List<Friend>> = Result.catching {
        val response = api.getFriends()
        if (response.isSuccessful) {
            response.body()?.map { it.toDomain() } ?: emptyList()
        } else {
            throw Exception("Failed to fetch friends: ${response.code()}")
        }
    }

    override suspend fun getRequests(): Result<List<FriendRequest>> = Result.catching {
        val response = api.getFriendRequests()
        if (response.isSuccessful) {
            response.body()?.map { it.toDomain("") } ?: emptyList()
        } else {
            throw Exception("Failed to fetch requests: ${response.code()}")
        }
    }

    override suspend fun sendRequest(username: String): Result<Unit> = Result.catching {
        val response = api.sendFriendRequest(FriendRequestBody(username))
        if (!response.isSuccessful) throw Exception("Failed to send request: ${response.code()}")
    }

    override suspend fun acceptRequest(id: String): Result<Unit> = Result.catching {
        val response = api.acceptFriendRequest(id)
        if (!response.isSuccessful) throw Exception("Failed to accept request: ${response.code()}")
    }

    override suspend fun rejectRequest(id: String): Result<Unit> = Result.catching {
        val response = api.rejectFriendRequest(id)
        if (!response.isSuccessful) throw Exception("Failed to reject request: ${response.code()}")
    }

    override suspend fun removeFriend(id: String): Result<Unit> = Result.catching {
        val response = api.removeFriend(id)
        if (!response.isSuccessful) throw Exception("Failed to remove friend: ${response.code()}")
    }

    override suspend fun searchUsers(query: String): Result<List<Friend>> = Result.catching {
        val response = api.searchUsers(query)
        if (response.isSuccessful) {
            response.body()?.map { it.toDomain() } ?: emptyList()
        } else {
            throw Exception("Failed to search users: ${response.code()}")
        }
    }
}
