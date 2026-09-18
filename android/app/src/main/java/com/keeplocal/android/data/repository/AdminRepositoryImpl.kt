package com.keeplocal.android.data.repository

import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.dto.LoginRequestDto
import com.keeplocal.android.data.api.dto.toDomain
import com.keeplocal.android.data.api.dto.toDto
import com.keeplocal.android.domain.model.AdminSettings
import com.keeplocal.android.domain.model.AdminStats
import com.keeplocal.android.domain.model.User
import com.keeplocal.android.domain.repository.AdminRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class AdminRepositoryImpl @Inject constructor(
    private val api: KeepLocalApi
) : AdminRepository {

    override suspend fun getStats(): Result<AdminStats> = Result.catching {
        val response = api.getAdminStats()
        if (response.isSuccessful) {
            response.body()?.toDomain() ?: throw Exception("No stats data")
        } else {
            throw Exception("Failed to fetch stats: ${response.code()}")
        }
    }

    override suspend fun getUsers(): Result<List<User>> = Result.catching {
        val response = api.getAdminUsers()
        if (response.isSuccessful) {
            response.body()?.map { it.toDomain() } ?: emptyList()
        } else {
            throw Exception("Failed to fetch users: ${response.code()}")
        }
    }

    override suspend fun createUser(username: String, password: String): Result<User> = Result.catching {
        val response = api.createUser(LoginRequestDto(username, password))
        if (response.isSuccessful) {
            response.body()?.toDomain() ?: throw Exception("No user data")
        } else {
            throw Exception("Failed to create user: ${response.code()}")
        }
    }

    override suspend fun deleteUser(id: String): Result<Unit> = Result.catching {
        val response = api.deleteUser(id)
        if (!response.isSuccessful) throw Exception("Failed to delete user: ${response.code()}")
    }

    override suspend fun toggleAdmin(id: String): Result<Unit> = Result.catching {
        val response = api.toggleAdmin(id)
        if (!response.isSuccessful) throw Exception("Failed to toggle admin: ${response.code()}")
    }

    override suspend fun createPasswordResetToken(id: String): Result<String> = Result.catching {
        val response = api.createPasswordResetToken(id)
        if (response.isSuccessful) {
            response.body()?.resetToken ?: throw Exception("No token in response")
        } else {
            throw Exception("Failed to create reset token: ${response.code()}")
        }
    }

    override suspend fun getSettings(): Result<AdminSettings> = Result.catching {
        val response = api.getAdminSettings()
        if (response.isSuccessful) {
            response.body()?.toDomain() ?: throw Exception("No settings data")
        } else {
            throw Exception("Failed to fetch settings: ${response.code()}")
        }
    }

    override suspend fun updateSettings(settings: AdminSettings): Result<Unit> = Result.catching {
        val response = api.updateAdminSettings(settings.toDto())
        if (!response.isSuccessful) throw Exception("Failed to update settings: ${response.code()}")
    }
}
