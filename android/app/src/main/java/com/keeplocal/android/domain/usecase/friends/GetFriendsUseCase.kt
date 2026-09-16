package com.keeplocal.android.domain.usecase.friends

import com.keeplocal.android.domain.model.Friend
import com.keeplocal.android.domain.repository.FriendRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class GetFriendsUseCase @Inject constructor(
    private val friendRepository: FriendRepository
) {
    suspend operator fun invoke(): Result<List<Friend>> = friendRepository.getFriends()
}
