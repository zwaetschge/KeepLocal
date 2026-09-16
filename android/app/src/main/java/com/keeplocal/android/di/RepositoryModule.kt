package com.keeplocal.android.di

import com.keeplocal.android.data.repository.AdminRepositoryImpl
import com.keeplocal.android.data.repository.AuthRepositoryImpl
import com.keeplocal.android.data.repository.FriendRepositoryImpl
import com.keeplocal.android.data.repository.MediaRepositoryImpl
import com.keeplocal.android.data.repository.NoteRepositoryImpl
import com.keeplocal.android.domain.repository.AdminRepository
import com.keeplocal.android.domain.repository.AuthRepository
import com.keeplocal.android.domain.repository.FriendRepository
import com.keeplocal.android.domain.repository.MediaRepository
import com.keeplocal.android.domain.repository.NoteRepository
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {

    @Binds
    @Singleton
    abstract fun bindNoteRepository(impl: NoteRepositoryImpl): NoteRepository

    @Binds
    @Singleton
    abstract fun bindAuthRepository(impl: AuthRepositoryImpl): AuthRepository

    @Binds
    @Singleton
    abstract fun bindFriendRepository(impl: FriendRepositoryImpl): FriendRepository

    @Binds
    @Singleton
    abstract fun bindAdminRepository(impl: AdminRepositoryImpl): AdminRepository

    @Binds
    @Singleton
    abstract fun bindMediaRepository(impl: MediaRepositoryImpl): MediaRepository
}
