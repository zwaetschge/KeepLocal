package com.keeplocal.android.domain.model

sealed class AuthState {
    object Unauthenticated : AuthState()
    object AutheliaRequired : AuthState()
    data class Authenticated(val user: User) : AuthState()
}
