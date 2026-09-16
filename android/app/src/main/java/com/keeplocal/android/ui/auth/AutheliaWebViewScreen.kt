package com.keeplocal.android.ui.auth

import android.util.Log
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.keeplocal.android.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AutheliaWebViewScreen(
    serverUrl: String,
    onCookiesReceived: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val normalizedUrl = remember(serverUrl) {
        val trimmed = serverUrl.trim().trimEnd('/')
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed
        else "https://$trimmed"
    }

    Column(modifier = Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(stringResource(R.string.authelia_login)) },
            navigationIcon = {
                IconButton(onClick = onDismiss) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                }
            }
        )

        AndroidView(
            factory = { context ->
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    // Hardening: match the Authelia WebView in SetupScreen. SSL
                    // errors are not overridden here, so the default (cancel)
                    // applies.
                    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.javaScriptCanOpenWindowsAutomatically = false

                    val cookieManager = CookieManager.getInstance()
                    cookieManager.setAcceptCookie(true)
                    cookieManager.setAcceptThirdPartyCookies(this, false)

                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val url = request.url.toString()
                            Log.d("AutheliaWebView", "shouldOverrideUrlLoading: $url")
                            // After successful Authelia login, user is redirected back to the server URL
                            if (url.startsWith(normalizedUrl) && !url.contains("authelia") && !url.contains("auth.")) {
                                val cookies = CookieManager.getInstance().getCookie(url) ?: ""
                                Log.d("AutheliaWebView", "Cookies captured (override): ${if (cookies.isBlank()) "none" else "present"}")
                                if (cookies.isNotBlank()) {
                                    onCookiesReceived(cookies)
                                    return true
                                }
                            }
                            return false
                        }

                        override fun onPageFinished(view: WebView, url: String) {
                            super.onPageFinished(view, url)
                            Log.d("AutheliaWebView", "onPageFinished: $url")
                            // After successful Authelia login, user is redirected back to the server URL
                            if (url.startsWith(normalizedUrl) && !url.contains("authelia") && !url.contains("auth.")) {
                                val cookies = CookieManager.getInstance().getCookie(url) ?: ""
                                Log.d("AutheliaWebView", "Cookies captured (finished): ${if (cookies.isBlank()) "none" else "present"}")
                                if (cookies.isNotBlank()) {
                                    onCookiesReceived(cookies)
                                }
                            }
                        }
                    }

                    loadUrl(normalizedUrl)
                }
            },
            modifier = Modifier
                .fillMaxSize()
                .padding(0.dp)
        )
    }
}
