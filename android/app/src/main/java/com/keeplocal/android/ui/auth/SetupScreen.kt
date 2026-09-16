package com.keeplocal.android.ui.auth

import android.content.Intent
import android.graphics.Bitmap
import android.net.http.SslError
import android.webkit.CookieManager
import android.webkit.SslErrorHandler
import android.webkit.WebSettings
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.hilt.navigation.compose.hiltViewModel
import com.keeplocal.android.R
import com.keeplocal.android.util.FileLogger

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetupScreen(
    onNavigateToNotes: () -> Unit,
    viewModel: SetupViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var passwordVisible by remember { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current

    LaunchedEffect(Unit) {
        viewModel.navigateToMain.collect { onNavigateToNotes() }
    }

    if (uiState.showAutheliaWebView) {
        AutheliaWebView(
            serverUrl = uiState.serverUrl,
            onCookiesObtained = { cookies -> viewModel.onAutheliaComplete(cookies) },
            onDismiss = { viewModel.onAutheliaDismissed() }
        )
        return
    }

    if (uiState.showOAuthWebView && uiState.oauthProvider != null) {
        OAuthWebView(
            serverUrl = uiState.serverUrl,
            provider = uiState.oauthProvider!!,
            onCookiesObtained = { cookies -> viewModel.onOAuthComplete(cookies) },
            onDismiss = { viewModel.onOAuthWebViewDismissed() }
        )
        return
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(64.dp))

            Text(
                text = stringResource(R.string.setup_title),
                style = MaterialTheme.typography.headlineLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onBackground
            )

            Spacer(modifier = Modifier.height(32.dp))

            OutlinedTextField(
                value = uiState.serverUrl,
                onValueChange = viewModel::updateServerUrl,
                label = { Text(stringResource(R.string.setup_server_url)) },
                placeholder = { Text(stringResource(R.string.setup_server_url_hint)) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Uri,
                    imeAction = ImeAction.Done
                ),
                keyboardActions = KeyboardActions(onDone = { viewModel.testConnection() }),
                trailingIcon = {
                    when (uiState.connectionStatus) {
                        ConnectionStatus.CONNECTED -> Icon(
                            Icons.Default.CheckCircle,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary
                        )
                        ConnectionStatus.ERROR -> Icon(
                            Icons.Default.Error,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.error
                        )
                        else -> {}
                    }
                }
            )

            Spacer(modifier = Modifier.height(12.dp))

            FilledTonalButton(
                onClick = viewModel::testConnection,
                modifier = Modifier.fillMaxWidth(),
                enabled = uiState.connectionStatus != ConnectionStatus.TESTING
            ) {
                if (uiState.connectionStatus == ConnectionStatus.TESTING) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Text(
                    if (uiState.connectionStatus == ConnectionStatus.TESTING)
                        stringResource(R.string.setup_testing)
                    else stringResource(R.string.setup_test_connection)
                )
            }

            AnimatedVisibility(visible = uiState.connectionStatus == ConnectionStatus.CONNECTED) {
                Column(modifier = Modifier.animateContentSize()) {
                    Spacer(modifier = Modifier.height(8.dp))

                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(
                            containerColor = MaterialTheme.colorScheme.primaryContainer
                        )
                    ) {
                        Text(
                            text = if (uiState.autheliaDetected)
                                stringResource(R.string.setup_authelia_detected)
                            else stringResource(R.string.setup_no_authelia),
                            modifier = Modifier.padding(16.dp),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }

                    if (uiState.autheliaDetected) {
                        Spacer(modifier = Modifier.height(12.dp))
                        FilledTonalButton(
                            onClick = viewModel::openAutheliaWebView,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(stringResource(R.string.auth_authelia_title))
                        }
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    // Login / Register toggle
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center
                    ) {
                        SingleChoiceSegmentedButtonRow {
                            SegmentedButton(
                                selected = !uiState.isRegisterMode,
                                onClick = { viewModel.setRegisterMode(false) },
                                shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2)
                            ) {
                                Text(stringResource(R.string.auth_login))
                            }
                            SegmentedButton(
                                selected = uiState.isRegisterMode,
                                onClick = { viewModel.setRegisterMode(true) },
                                shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2)
                            ) {
                                Text(stringResource(R.string.auth_register))
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    Text(
                        text = if (uiState.isRegisterMode)
                            stringResource(R.string.auth_register_title)
                        else stringResource(R.string.auth_title),
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onBackground
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // The API authenticates by email; a username is only needed
                    // when creating the account.
                    AnimatedVisibility(visible = uiState.isRegisterMode) {
                        Column {
                            OutlinedTextField(
                                value = uiState.username,
                                onValueChange = viewModel::updateUsername,
                                label = { Text(stringResource(R.string.auth_username)) },
                                supportingText = {
                                    Text(stringResource(R.string.auth_username_hint))
                                },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                keyboardActions = KeyboardActions(
                                    onNext = { focusManager.moveFocus(FocusDirection.Down) }
                                )
                            )
                            Spacer(modifier = Modifier.height(12.dp))
                        }
                    }

                    OutlinedTextField(
                        value = uiState.email,
                        onValueChange = viewModel::updateEmail,
                        label = { Text(stringResource(R.string.auth_email)) },
                        placeholder = { Text(stringResource(R.string.auth_email_hint)) },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Email,
                            autoCorrect = false,
                            imeAction = ImeAction.Next
                        ),
                        keyboardActions = KeyboardActions(
                            onNext = { focusManager.moveFocus(FocusDirection.Down) }
                        )
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    OutlinedTextField(
                        value = uiState.password,
                        onValueChange = viewModel::updatePassword,
                        label = { Text(stringResource(R.string.auth_password)) },
                        supportingText = if (uiState.isRegisterMode) {
                            { Text(stringResource(R.string.auth_password_hint)) }
                        } else {
                            null
                        },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        visualTransformation = if (passwordVisible) VisualTransformation.None
                            else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction = if (uiState.isRegisterMode) ImeAction.Next else ImeAction.Done
                        ),
                        keyboardActions = KeyboardActions(
                            onDone = { if (!uiState.isRegisterMode) viewModel.login() },
                            onNext = { focusManager.moveFocus(FocusDirection.Down) }
                        ),
                        trailingIcon = {
                            IconButton(onClick = { passwordVisible = !passwordVisible }) {
                                Icon(
                                    if (passwordVisible) Icons.Default.VisibilityOff
                                    else Icons.Default.Visibility,
                                    contentDescription = null
                                )
                            }
                        }
                    )

                    // Confirm password for registration
                    AnimatedVisibility(visible = uiState.isRegisterMode) {
                        Column {
                            Spacer(modifier = Modifier.height(12.dp))
                            OutlinedTextField(
                                value = uiState.confirmPassword,
                                onValueChange = viewModel::updateConfirmPassword,
                                label = { Text(stringResource(R.string.auth_confirm_password)) },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                visualTransformation = if (passwordVisible) VisualTransformation.None
                                    else PasswordVisualTransformation(),
                                keyboardOptions = KeyboardOptions(
                                    keyboardType = KeyboardType.Password,
                                    imeAction = ImeAction.Done
                                ),
                                keyboardActions = KeyboardActions(onDone = { viewModel.register() }),
                                isError = uiState.confirmPassword.isNotBlank() && uiState.password != uiState.confirmPassword,
                                supportingText = {
                                    if (uiState.confirmPassword.isNotBlank() && uiState.password != uiState.confirmPassword) {
                                        Text(stringResource(R.string.auth_passwords_no_match))
                                    }
                                }
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(20.dp))

                    // Remember credentials: controls whether email + password
                    // are stored (encrypted) for silent re-login.
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = stringResource(R.string.settings_remember_credentials),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onBackground,
                            modifier = Modifier.weight(1f)
                        )
                        Switch(
                            checked = uiState.rememberCredentials,
                            onCheckedChange = { viewModel.toggleRememberCredentials() }
                        )
                    }

                    Spacer(modifier = Modifier.height(20.dp))

                    Button(
                        onClick = { if (uiState.isRegisterMode) viewModel.register() else viewModel.login() },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !uiState.isLoading
                    ) {
                        if (uiState.isLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                        }
                        Text(
                            if (uiState.isRegisterMode)
                                stringResource(R.string.auth_register)
                            else stringResource(R.string.auth_login)
                        )
                    }

                    // OAuth: only providers the server has configured get a
                    // button (GET /api/auth/providers).
                    if (!uiState.isRegisterMode && (uiState.oauthProviders.google || uiState.oauthProviders.github)) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            if (uiState.oauthProviders.google) {
                                OutlinedButton(
                                    onClick = { viewModel.startOAuth("google") },
                                    modifier = Modifier.weight(1f),
                                    enabled = !uiState.isLoading
                                ) {
                                    Text(stringResource(R.string.auth_oauth_google))
                                }
                            }
                            if (uiState.oauthProviders.github) {
                                OutlinedButton(
                                    onClick = { viewModel.startOAuth("github") },
                                    modifier = Modifier.weight(1f),
                                    enabled = !uiState.isLoading
                                ) {
                                    Text(stringResource(R.string.auth_oauth_github))
                                }
                            }
                        }
                    }
                }
            }

            uiState.errorMessage?.let { error ->
                Spacer(modifier = Modifier.height(16.dp))
                Card(
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer
                    )
                ) {
                    Text(
                        text = error,
                        modifier = Modifier.padding(16.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
fun AutheliaWebView(
    serverUrl: String,
    onCookiesObtained: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var hasCompleted by remember { mutableStateOf(false) }
    val normalizedUrl = remember(serverUrl) {
        val trimmed = serverUrl.trim().trimEnd('/')
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed
        else "https://$trimmed"
    }
    // Build the auth URL: load auth domain directly with redirect back to app
    val authUrl = remember(normalizedUrl) {
        val host = try { android.net.Uri.parse(normalizedUrl).host ?: "" } catch (_: Exception) { "" }
        // Derive auth domain: replace first subdomain with "auth" or prepend "auth."
        val parts = host.split(".")
        val authHost = if (parts.size >= 3) "auth." + parts.drop(1).joinToString(".") else "auth.$host"
        val encodedRd = android.net.Uri.encode(normalizedUrl)
        "https://$authHost/?rd=$encodedRd&rm=GET"
    }
    // Only the auth domain and the server domain may be navigated and may
    // hand over cookies inside this WebView.
    val allowedHosts = remember(normalizedUrl, authUrl) {
        computeAllowedHosts(normalizedUrl, authUrl)
    }
    // Hosts the user explicitly trusted despite an invalid SSL certificate:
    // one deliberate opt-in per host for this WebView instance only, never
    // persisted, never global.
    val sslBypassedHosts = remember { mutableStateMapOf<String, Boolean>() }
    var pendingSslHost by remember { mutableStateOf<String?>(null) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }

    Scaffold(
        topBar = {
            @OptIn(ExperimentalMaterial3Api::class)
            TopAppBar(
                title = { Text(stringResource(R.string.auth_authelia_title)) },
                navigationIcon = {
                    IconButton(onClick = onDismiss) {
                        Icon(
                            Icons.Default.Error,
                            contentDescription = stringResource(R.string.cd_close)
                        )
                    }
                }
            )
        }
    ) { padding ->
        AndroidView(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            factory = { context ->
                val log = FileLogger.get()
                log?.log("WebView", "=== Creating WebView for Authelia auth ===")
                log?.log("WebView", "normalizedUrl=$normalizedUrl authUrl=$authUrl")
                WebView.setWebContentsDebuggingEnabled(com.keeplocal.android.BuildConfig.DEBUG)
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.databaseEnabled = true
                    settings.loadWithOverviewMode = true
                    settings.useWideViewPort = true
                    settings.setSupportZoom(true)
                    settings.builtInZoomControls = true
                    settings.displayZoomControls = false
                    // Hardening: no mixed content, no local file/content
                    // access, no windows opened by scripts, no third-party
                    // cookies.
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.allowContentAccess = false
                    settings.allowFileAccess = false
                    settings.javaScriptCanOpenWindowsAutomatically = false
                    settings.cacheMode = WebSettings.LOAD_NO_CACHE

                    val cookieManager = CookieManager.getInstance()
                    cookieManager.setAcceptCookie(true)
                    cookieManager.setAcceptThirdPartyCookies(this, false)

                    // Collect cookies, but only from the allowed hosts
                    val allCookies = mutableMapOf<String, String>()
                    var visitedAuthDomain = false

                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage?): Boolean {
                            log?.log("WebView-JS", "${consoleMessage?.messageLevel()}: ${consoleMessage?.message()} [${consoleMessage?.sourceId()}:${consoleMessage?.lineNumber()}]")
                            return true
                        }
                    }

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                            val uri = request?.url ?: return false
                            val url = uri.toString()
                            log?.log("WebView", "shouldOverrideUrlLoading: $url")
                            val host = uri.host ?: ""
                            val isWebScheme = uri.scheme == "http" || uri.scheme == "https"
                            if (isWebScheme && isAllowedHost(host, allowedHosts)) {
                                return false // load inside the auth WebView
                            }
                            // Foreign http(s) links leave the app via the
                            // browser; anything else (mailto:, intent:, …) is
                            // blocked outright.
                            if (isWebScheme) {
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                                }
                            }
                            return true
                        }

                        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                            super.onPageStarted(view, url, favicon)
                            log?.log("WebView", "onPageStarted: $url")
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            log?.log("WebView", "onPageFinished: url=$url hasCompleted=$hasCompleted")
                            val cookies = CookieManager.getInstance().getCookie(url ?: "")
                            log?.log("WebView", "cookies for $url: ${if (cookies.isNullOrBlank()) "none" else "present"}")

                            // Track auth domain visits
                            if (url != null && (url.contains("auth.") || url.contains("authelia"))) {
                                visitedAuthDomain = true
                            }

                            // Take over cookies of the auth domain and the
                            // server domain only, never of other visited hosts.
                            val domain = try { android.net.Uri.parse(url ?: "").host ?: "" } catch (_: Exception) { "" }
                            if (url != null && !cookies.isNullOrBlank() && isAllowedHost(domain, allowedHosts)) {
                                allCookies[domain] = cookies
                            }

                            // Complete when we arrive at the app URL (redirect from Authelia after successful login)
                            if (url != null && url.startsWith(normalizedUrl) && !url.contains("auth.") && !hasCompleted) {
                                val mergedCookies = allCookies.values
                                    .flatMap { it.split("; ") }
                                    .distinct()
                                    .joinToString("; ")
                                log?.log("WebView", "Arrived at app URL with ${if (mergedCookies.isBlank()) "no" else "captured"} cookies")
                                hasCompleted = true
                                onCookiesObtained(mergedCookies)
                            }
                        }

                        @android.annotation.SuppressLint("WebViewClientOnReceivedSslError")
                        override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                            log?.error("WebView", "SSL error: ${error?.primaryError} url=${error?.url}")
                            val host = try {
                                android.net.Uri.parse(error?.url ?: "").host ?: ""
                            } catch (_: Exception) { "" }
                            if (host.isNotBlank() && sslBypassedHosts[host] == true) {
                                // Explicitly trusted by the user for this host
                                // in this WebView session.
                                handler?.proceed()
                            } else {
                                // Default-deny: cancel and ask the user.
                                handler?.cancel()
                                pendingSslHost = host.ifBlank { error?.url ?: "" }
                            }
                        }

                        override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                            log?.error("WebView", "Error loading: code=${error?.errorCode} desc=${error?.description} url=${request?.url} isForMain=${request?.isForMainFrame}")
                            super.onReceivedError(view, request, error)
                        }

                        override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: android.webkit.WebResourceResponse?) {
                            log?.error("WebView", "HTTP error: status=${errorResponse?.statusCode} reason=${errorResponse?.reasonPhrase} url=${request?.url} isForMain=${request?.isForMainFrame}")
                            super.onReceivedHttpError(view, request, errorResponse)
                        }
                    }
                    webViewRef = this
                    // Load auth URL directly instead of relying on redirect
                    log?.log("WebView", "Loading auth URL directly: $authUrl")
                    loadUrl(authUrl)
                }
            }
        )
    }

    // Explicit (unsafe) opt-in for self-signed certificates: per host, for
    // this WebView only. Reload then re-enters onReceivedSslError with the
    // bypass set and proceeds.
    pendingSslHost?.let { host ->
        AlertDialog(
            onDismissRequest = { pendingSslHost = null },
            title = { Text(stringResource(R.string.ssl_error_title)) },
            text = { Text(stringResource(R.string.ssl_error_message)) },
            confirmButton = {
                TextButton(onClick = {
                    sslBypassedHosts[host] = true
                    pendingSslHost = null
                    webViewRef?.reload()
                }) { Text(stringResource(R.string.ssl_error_continue)) }
            },
            dismissButton = {
                TextButton(onClick = { pendingSslHost = null }) { Text(stringResource(R.string.cancel)) }
            }
        )
    }
}

/** The auth and the server host, used as the WebView's trust boundary. */
private fun computeAllowedHosts(normalizedUrl: String, authUrl: String): Set<String> =
    listOf(normalizedUrl, authUrl).mapNotNull { url ->
        try { android.net.Uri.parse(url).host } catch (_: Exception) { null }
    }.filter { it.isNotBlank() }.toSet()

/**
 * OAuth provider login inside the same hardened WebView skeleton as the
 * Authelia flow: JS on, no file/content access, no third-party cookies,
 * foreign hosts handed to the browser. Only the server host plus the
 * provider's login hosts are navigable. Completion = redirect back onto the
 * server host outside the flow's own api/auth pages (the last redirect
 * targets {clientURL}/oauth/callback, same origin as the API here);
 * at that point only the SERVER-domain cookie is harvested — provider
 * cookies never reach the API client.
 */
@Composable
fun OAuthWebView(
    serverUrl: String,
    provider: String,
    onCookiesObtained: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var hasCompleted by remember { mutableStateOf(false) }
    val normalizedUrl = remember(serverUrl) {
        val trimmed = serverUrl.trim().trimEnd('/')
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed
        else "https://$trimmed"
    }
    val startUrl = "${normalizedUrl}/api/auth/$provider"
    val serverHost = remember(normalizedUrl) {
        try { android.net.Uri.parse(normalizedUrl).host ?: "" } catch (_: Exception) { "" }
    }
    val allowedHosts = remember(serverHost, provider) {
        when (provider) {
            "github" -> setOf("github.com")
            "google" -> setOf("accounts.google.com", "googleusercontent.com")
            else -> emptySet()
        } + serverHost
    }
    val sslBypassedHosts = remember { mutableStateMapOf<String, Boolean>() }
    var pendingSslHost by remember { mutableStateOf<String?>(null) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }

    Scaffold(
        topBar = {
            @OptIn(ExperimentalMaterial3Api::class)
            TopAppBar(
                title = { Text(stringResource(R.string.auth_oauth_title)) },
                navigationIcon = {
                    IconButton(onClick = onDismiss) {
                        Icon(
                            Icons.Default.Error,
                            contentDescription = stringResource(R.string.cd_close)
                        )
                    }
                }
            )
        }
    ) { padding ->
        AndroidView(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            factory = { context ->
                val log = FileLogger.get()
                log?.log("OAuthWebView", "=== Creating OAuth WebView for $provider ===")
                WebView.setWebContentsDebuggingEnabled(com.keeplocal.android.BuildConfig.DEBUG)
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.allowContentAccess = false
                    settings.allowFileAccess = false
                    settings.javaScriptCanOpenWindowsAutomatically = false
                    settings.cacheMode = WebSettings.LOAD_NO_CACHE

                    val cookieManager = CookieManager.getInstance()
                    cookieManager.setAcceptCookie(true)
                    cookieManager.setAcceptThirdPartyCookies(this, false)

                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage?): Boolean {
                            log?.log("OAuthWebView-JS", "${consoleMessage?.messageLevel()}: ${consoleMessage?.message()}")
                            return true
                        }
                    }

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                            val uri = request?.url ?: return false
                            val host = uri.host ?: ""
                            val isWebScheme = uri.scheme == "http" || uri.scheme == "https"
                            if (isWebScheme && isAllowedHost(host, allowedHosts)) {
                                return false
                            }
                            if (isWebScheme) {
                                runCatching {
                                    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                                }
                            }
                            return true
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            super.onPageFinished(view, url)
                            log?.log("OAuthWebView", "onPageFinished: url=$url hasCompleted=$hasCompleted")
                            if (url == null || hasCompleted) return

                            // Back on the server host, outside the flow's own
                            // /api/auth/* pages: the callback has happened and
                            // the session cookie is set.
                            val host = try { android.net.Uri.parse(url).host ?: "" } catch (_: Exception) { "" }
                            val isServerPage = host == serverHost && !url.contains("/api/auth/")
                            if (isServerPage) {
                                val cookies = CookieManager.getInstance().getCookie(normalizedUrl)
                                log?.log(
                                    "OAuthWebView",
                                    "OAuth flow returned to app: server cookies ${if (cookies.isNullOrBlank()) "none" else "present"}"
                                )
                                hasCompleted = true
                                onCookiesObtained(cookies ?: "")
                            }
                        }

                        @android.annotation.SuppressLint("WebViewClientOnReceivedSslError")
                        override fun onReceivedSslError(view: WebView?, handler: SslErrorHandler?, error: SslError?) {
                            val host = try {
                                android.net.Uri.parse(error?.url ?: "").host ?: ""
                            } catch (_: Exception) { "" }
                            if (host.isNotBlank() && sslBypassedHosts[host] == true) {
                                handler?.proceed()
                            } else {
                                handler?.cancel()
                                pendingSslHost = host.ifBlank { error?.url ?: "" }
                            }
                        }
                    }
                    webViewRef = this
                    loadUrl(startUrl)
                }
            }
        )
    }

    pendingSslHost?.let { host ->
        AlertDialog(
            onDismissRequest = { pendingSslHost = null },
            title = { Text(stringResource(R.string.ssl_error_title)) },
            text = { Text(stringResource(R.string.ssl_error_message)) },
            confirmButton = {
                TextButton(onClick = {
                    sslBypassedHosts[host] = true
                    pendingSslHost = null
                    webViewRef?.reload()
                }) { Text(stringResource(R.string.ssl_error_continue)) }
            },
            dismissButton = {
                TextButton(onClick = { pendingSslHost = null }) { Text(stringResource(R.string.cancel)) }
            }
        )
    }
}

/**
 * Host-suffix match against the auth and server domain: a host is trusted
 * when it is equal to, a subdomain of, or a parent domain of either.
 */
private fun isAllowedHost(host: String, allowedHosts: Set<String>): Boolean {
    if (host.isBlank()) return false
    return allowedHosts.any { allowed ->
        host == allowed || host.endsWith(".$allowed") || allowed.endsWith(".$host")
    }
}
