package com.keeplocal.android.domain.usecase.admin

import com.keeplocal.android.domain.model.AdminSettings
import com.keeplocal.android.domain.model.User
import com.keeplocal.android.domain.repository.AdminRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class ManageUsersUseCase @Inject constructor(
    private val adminRepository: AdminRepository
) {
    suspend fun createUser(username: String, password: String): Result<User> =
        adminRepository.createUser(username, password)

    suspend fun deleteUser(id: String): Result<Unit> = adminRepository.deleteUser(id)

    suspend fun toggleAdmin(id: String): Result<Unit> = adminRepository.toggleAdmin(id)

    suspend fun updateSettings(settings: AdminSettings): Result<Unit> =
        adminRepository.updateSettings(settings)
}
