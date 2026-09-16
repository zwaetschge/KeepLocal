package com.keeplocal.android.domain.usecase.auth

import com.keeplocal.android.domain.repository.AuthRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class CheckAutheliaUseCase @Inject constructor(
    private val authRepository: AuthRepository
) {
    suspend operator fun invoke(serverUrl: String): Result<Boolean> =
        authRepository.isAutheliaPresent(serverUrl)
}
