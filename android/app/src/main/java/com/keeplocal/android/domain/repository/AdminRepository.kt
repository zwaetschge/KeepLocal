package com.keeplocal.android.domain.repository

import com.keeplocal.android.domain.model.AdminSettings
import com.keeplocal.android.domain.model.AdminStats
import com.keeplocal.android.domain.model.User
import com.keeplocal.android.util.Result

interface AdminRepository {
    suspend fun getStats(): Result<AdminStats>
    suspend fun getUsers(): Result<List<User>>
    suspend fun createUser(username: String, password: String): Result<User>
    suspend fun deleteUser(id: String): Result<Unit>
    suspend fun toggleAdmin(id: String): Result<Unit>
    suspend fun getSettings(): Result<AdminSettings>
    suspend fun updateSettings(settings: AdminSettings): Result<Unit>
}
