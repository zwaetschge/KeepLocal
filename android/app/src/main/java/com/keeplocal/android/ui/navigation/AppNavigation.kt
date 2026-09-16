package com.keeplocal.android.ui.navigation

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.keeplocal.android.ui.admin.AdminScreen
import com.keeplocal.android.ui.auth.SetupScreen
import com.keeplocal.android.ui.friends.FriendsScreen
import com.keeplocal.android.ui.notes.NoteEditorScreen
import com.keeplocal.android.ui.notes.NotesScreen
import com.keeplocal.android.ui.trash.TrashScreen
import com.keeplocal.android.ui.settings.SettingsScreen
import com.keeplocal.android.util.IncomingIntents

object Routes {
    const val SETUP = "setup"
    const val NOTES = "notes"
    const val NOTE_EDITOR = "note_editor?noteId={noteId}"
    const val FRIENDS = "friends"
    const val TRASH = "trash"
    const val ADMIN = "admin"
    const val SETTINGS = "settings"

    fun noteEditor(noteId: String? = null): String =
        if (noteId != null) "note_editor?noteId=$noteId" else "note_editor"
}

private const val TRANSITION_DURATION = 300

@Composable
fun AppNavigation() {
    val navController = rememberNavController()

    // Entry intents (widget tap, quick-settings tile, note deep-link) arrive
    // via IncomingIntents regardless of which screen is showing; consumed
    // here so they also work from settings/friends/editor screens.
    LaunchedEffect(Unit) {
        IncomingIntents.navRequest.collect { request ->
            when (request) {
                is IncomingIntents.NavRequest.NewNote ->
                    navController.navigate(Routes.noteEditor(null))
                is IncomingIntents.NavRequest.OpenNote ->
                    navController.navigate(Routes.noteEditor(request.noteId))
                is IncomingIntents.NavRequest.OpenTrash ->
                    navController.navigate(Routes.TRASH)
                is IncomingIntents.NavRequest.Search ->
                    // The query itself travels via IncomingIntents.searchRequest,
                    // which the notes screen's ViewModel picks up.
                    navController.navigate(Routes.NOTES) { launchSingleTop = true }
                null -> Unit
            }
            IncomingIntents.consumeNavRequest()
        }
    }

    NavHost(
        navController = navController,
        startDestination = Routes.SETUP,
        enterTransition = {
            fadeIn(animationSpec = tween(TRANSITION_DURATION)) +
                slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.Start, tween(TRANSITION_DURATION))
        },
        exitTransition = {
            fadeOut(animationSpec = tween(TRANSITION_DURATION)) +
                slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.Start, tween(TRANSITION_DURATION))
        },
        popEnterTransition = {
            fadeIn(animationSpec = tween(TRANSITION_DURATION)) +
                slideIntoContainer(AnimatedContentTransitionScope.SlideDirection.End, tween(TRANSITION_DURATION))
        },
        popExitTransition = {
            fadeOut(animationSpec = tween(TRANSITION_DURATION)) +
                slideOutOfContainer(AnimatedContentTransitionScope.SlideDirection.End, tween(TRANSITION_DURATION))
        }
    ) {
        composable(
            Routes.SETUP,
            enterTransition = { fadeIn(tween(TRANSITION_DURATION)) },
            exitTransition = { fadeOut(tween(TRANSITION_DURATION)) }
        ) {
            SetupScreen(
                onNavigateToNotes = {
                    navController.navigate(Routes.NOTES) {
                        popUpTo(Routes.SETUP) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.NOTES) {
            NotesScreen(
                onNavigateToEditor = { noteId ->
                    navController.navigate(Routes.noteEditor(noteId))
                },
                onNavigateToFriends = {
                    navController.navigate(Routes.FRIENDS)
                },
                onNavigateToAdmin = {
                    navController.navigate(Routes.ADMIN)
                },
                onNavigateToSettings = {
                    navController.navigate(Routes.SETTINGS)
                },
                onNavigateToTrash = {
                    navController.navigate(Routes.TRASH)
                },
                onReLoginRequired = {
                    navController.navigate(Routes.SETUP) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(
            route = Routes.NOTE_EDITOR,
            arguments = listOf(
                navArgument("noteId") {
                    type = NavType.StringType
                    nullable = true
                    defaultValue = null
                }
            )
        ) {
            NoteEditorScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Routes.FRIENDS) {
            FriendsScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Routes.TRASH) {
            TrashScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Routes.ADMIN) {
            AdminScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Routes.SETTINGS) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
                onLogout = {
                    navController.navigate(Routes.SETUP) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }
    }
}
