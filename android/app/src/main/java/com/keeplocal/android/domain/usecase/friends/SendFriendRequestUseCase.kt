package com.keeplocal.android.domain.usecase.friends

import com.keeplocal.android.domain.repository.FriendRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class SendFriendRequestUseCase @Inject constructor(
    private val friendRepository: FriendRepository
) {
    suspend operator fun invoke(username: String): Result<Unit> = friendRepository.sendRequest(username)
}
