package com.keeplocal.android.domain.usecase.admin

import com.keeplocal.android.domain.model.AdminSettings
import com.keeplocal.android.domain.model.AdminStats
import com.keeplocal.android.domain.model.User
import com.keeplocal.android.domain.repository.AdminRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class GetAdminDataUseCase @Inject constructor(
    private val adminRepository: AdminRepository
) {
    suspend fun getStats(): Result<AdminStats> = adminRepository.getStats()
    suspend fun getUsers(): Result<List<User>> = adminRepository.getUsers()
    suspend fun getSettings(): Result<AdminSettings> = adminRepository.getSettings()
}
