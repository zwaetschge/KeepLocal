package com.keeplocal.android.domain.usecase.auth

import com.keeplocal.android.domain.model.User
import com.keeplocal.android.domain.repository.AuthRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class GetCurrentUserUseCase @Inject constructor(
    private val authRepository: AuthRepository
) {
    suspend operator fun invoke(): Result<User> =
        authRepository.getCurrentUser()
}
