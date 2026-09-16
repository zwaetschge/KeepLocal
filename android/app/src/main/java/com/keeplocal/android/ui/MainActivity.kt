package com.keeplocal.android.ui

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.keeplocal.android.R
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.TokenManager
import com.keeplocal.android.ui.adaptive.LocalAppWindowInfo
import com.keeplocal.android.ui.adaptive.rememberAppWindowInfo
import com.keeplocal.android.ui.navigation.AppNavigation
import com.keeplocal.android.ui.theme.KeepLocalTheme
import com.keeplocal.android.ui.theme.ThemeMode
import com.keeplocal.android.ui.theme.doodleCanvas
import com.keeplocal.android.util.IncomingIntents
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : FragmentActivity() {

    @Inject lateinit var settingsDataStore: SettingsDataStore
    @Inject lateinit var tokenManager: TokenManager

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Share target (ACTION_SEND), widget and quick-settings tile entries.
        IncomingIntents.handle(intent)
        setContent {
            val themeModeString by settingsDataStore.themeMode.collectAsState(initial = "system")
            val themeMode = ThemeMode.fromKey(themeModeString)
            // Material You re-tint (v1.7.0 design round): reactive so the
            // settings switch re-colors the app without a restart.
            val materialYou by settingsDataStore.materialYou.collectAsState(initial = false)

            // Read both gate inputs once synchronously so the very first
            // frame already knows whether to lock; the flow keeps it reactive.
            var biometricLock by remember {
                mutableStateOf(runBlocking { settingsDataStore.biometricLock.first() })
            }
            var hasSession by remember { mutableStateOf(tokenManager.hasStoredSession()) }
            var isUnlocked by remember { mutableStateOf(false) }
            var promptShowing by remember { mutableStateOf(false) }

            LaunchedEffect(Unit) {
                settingsDataStore.biometricLock.collect { biometricLock = it }
            }

            // Re-check the gate whenever the app returns to the foreground:
            // the phone must not show notes behind the recents preview.
            val lifecycleOwner = LocalLifecycleOwner.current
            DisposableEffect(lifecycleOwner) {
                val observer = LifecycleEventObserver { _, event ->
                    if (event == Lifecycle.Event.ON_RESUME) {
                        hasSession = tokenManager.hasStoredSession()
                        // Skip while our own prompt is on top — it does not
                        // pause the activity, but OEMs differ.
                        if (!promptShowing) isUnlocked = false
                    }
                }
                lifecycleOwner.lifecycle.addObserver(observer)
                onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
            }

            val needsGate = biometricLock && hasSession && !isUnlocked

            KeepLocalTheme(themeMode = themeMode, dynamicColor = materialYou) {
                // Recomposes (without an activity restart) on every configuration
                // change: rotate, fold, resize, split-screen.
                val windowInfo = rememberAppWindowInfo()
                CompositionLocalProvider(LocalAppWindowInfo provides windowInfo) {
                    Surface(
                        modifier = Modifier.fillMaxSize(),
                        color = MaterialTheme.colorScheme.background
                    ) {
                        // Inside the Surface so the doodle graph paper sits on top of
                        // the background fill instead of being painted over by it.
                        Box(modifier = Modifier.fillMaxSize().doodleCanvas()) {
                            if (needsGate) {
                                BiometricGate(
                                    activity = this@MainActivity,
                                    onPromptStateChanged = { active -> promptShowing = active },
                                    onUnlocked = {
                                        promptShowing = false
                                        isUnlocked = true
                                    },
                                    onLocked = {
                                        promptShowing = false
                                        // No data behind a dismissed prompt: minimize.
                                        moveTaskToBack(true)
                                    }
                                )
                            } else {
                                AppNavigation()
                            }
                        }
                    }
                }
            }
        }
    }

    /**
     * singleTask in the manifest: a share/widget/tile intent while the app is
     * running lands here instead of stacking a second MainActivity.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        IncomingIntents.handle(intent)
    }
}

/**
 * Full-screen veil plus the system biometric prompt. Authenticates with
 * weak biometrics or the device credential; cancelling (any error) sends
 * the app to the background instead of revealing data.
 */
@Composable
private fun BiometricGate(
    activity: FragmentActivity,
    onPromptStateChanged: (Boolean) -> Unit,
    onUnlocked: () -> Unit,
    onLocked: () -> Unit
) {
    val authenticators = BiometricManager.Authenticators.BIOMETRIC_WEAK or
        BiometricManager.Authenticators.DEVICE_CREDENTIAL
    val canAuthenticate = remember {
        BiometricManager.from(activity).canAuthenticate(authenticators) ==
            BiometricManager.BIOMETRIC_SUCCESS
    }

    LaunchedEffect(Unit) {
        if (!canAuthenticate) {
            // Nothing to authenticate with (hardware gone or nothing
            // enrolled): rather than lock the user out of their notes, let
            // them in. Settings disables the toggle for such devices.
            onUnlocked()
            return@LaunchedEffect
        }
        onPromptStateChanged(true)
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onUnlocked()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    onLocked()
                }
            }
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(activity.getString(R.string.biometric_prompt_title))
            .setSubtitle(activity.getString(R.string.biometric_prompt_subtitle))
            .setAllowedAuthenticators(authenticators)
            .setConfirmationRequired(false)
            .build()
        prompt.authenticate(info)
    }

    DisposableEffect(Unit) {
        onDispose { onPromptStateChanged(false) }
    }

    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}
