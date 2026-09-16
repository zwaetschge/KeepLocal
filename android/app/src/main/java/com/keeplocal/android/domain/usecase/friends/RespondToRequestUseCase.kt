package com.keeplocal.android.domain.usecase.friends

import com.keeplocal.android.domain.repository.FriendRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class RespondToRequestUseCase @Inject constructor(
    private val friendRepository: FriendRepository
) {
    suspend fun accept(id: String): Result<Unit> = friendRepository.acceptRequest(id)
    suspend fun reject(id: String): Result<Unit> = friendRepository.rejectRequest(id)
}
