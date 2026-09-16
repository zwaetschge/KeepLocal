package com.keeplocal.android.domain.usecase.auth

import com.keeplocal.android.domain.repository.AuthRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class ChangePasswordUseCase @Inject constructor(
    private val authRepository: AuthRepository
) {
    suspend operator fun invoke(currentPassword: String, newPassword: String): Result<Unit> =
        authRepository.changePassword(currentPassword, newPassword)
}
