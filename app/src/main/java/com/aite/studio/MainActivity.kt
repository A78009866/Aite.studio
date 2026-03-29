package com.aite.studio

import android.Manifest
import android.annotation.SuppressLint
import android.app.Dialog
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var isOfflinePageShowing = false
    private var lastTargetUrl = ""
    private var pendingRetryUrl = ""
    private var googleAuthDialog: Dialog? = null

    // Google/OAuth domains that should open in a separate auth window
    private val authDomains = listOf(
        "accounts.google.com",
        "accounts.youtube.com",
        "login.microsoftonline.com",
        "github.com/login",
        "auth0.com",
        "appleid.apple.com"
    )

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            val data = result.data?.data
            if (data != null) {
                fileUploadCallback?.onReceiveValue(arrayOf(data))
            } else {
                fileUploadCallback?.onReceiveValue(null)
            }
        } else {
            fileUploadCallback?.onReceiveValue(null)
        }
        fileUploadCallback = null
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = cm.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } else {
            @Suppress("DEPRECATION")
            val ni = cm.activeNetworkInfo
            return ni != null && ni.isConnected
        }
    }

    private fun isAuthUrl(url: String): Boolean {
        return authDomains.any { domain -> url.contains(domain) }
    }

    private fun loadOfflinePage() {
        if (isOfflinePageShowing) return
        isOfflinePageShowing = true
        webView.stopLoading()
        webView.loadUrl("file:///android_asset/offline.html")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun openGoogleAuthInDialog(url: String) {
        googleAuthDialog?.dismiss()

        val dialog = Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val authWebView = WebView(this)

        val settings = authWebView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.setSupportZoom(true)
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        settings.setSupportMultipleWindows(false)
        // Use a real browser user agent to avoid Google blocking WebView
        settings.userAgentString = "Mozilla/5.0 (Linux; Android ${Build.VERSION.RELEASE}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(authWebView, true)

        authWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val reqUrl = request?.url.toString()
                // If redirecting back to the target app URL, load it in the main WebView
                val targetHost = Uri.parse(lastTargetUrl).host ?: ""
                if (targetHost.isNotEmpty() && reqUrl.contains(targetHost)) {
                    cookieManager.flush()
                    webView.loadUrl(reqUrl)
                    dialog.dismiss()
                    return true
                }
                // Allow all other URLs (Google OAuth flow) to load in auth WebView
                return false
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    Toast.makeText(this@MainActivity, "\u062E\u0637\u0623 \u0641\u064A \u0627\u0644\u0627\u062A\u0635\u0627\u0644", Toast.LENGTH_SHORT).show()
                }
            }
        }

        authWebView.webChromeClient = object : WebChromeClient() {
            override fun onCloseWindow(window: WebView?) {
                dialog.dismiss()
            }
        }

        dialog.setContentView(authWebView, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ))
        dialog.setOnDismissListener {
            authWebView.stopLoading()
            authWebView.destroy()
            googleAuthDialog = null
        }

        googleAuthDialog = dialog
        dialog.show()
        authWebView.loadUrl(url)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val enableZoom = "ENABLE_ZOOM_PLACEHOLDER".toBoolean()
        val enableTextSelection = "ENABLE_TEXT_SELECTION_PLACEHOLDER".toBoolean()
        val enableSplashScreen = "ENABLE_SPLASH_SCREEN_PLACEHOLDER".toBoolean()
        val enableFullScreen = "false".toBoolean()
        val targetUrl = "WEB_URL_PLACEHOLDER"
        lastTargetUrl = targetUrl

        if (enableFullScreen) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.insetsController?.hide(WindowInsets.Type.statusBars())
            } else {
                window.setFlags(
                    WindowManager.LayoutParams.FLAG_FULLSCREEN,
                    WindowManager.LayoutParams.FLAG_FULLSCREEN
                )
            }
        }

        if (enableSplashScreen && savedInstanceState == null) {
            setContentView(R.layout.splash_screen)
            Handler(Looper.getMainLooper()).postDelayed({
                setupWebView(enableZoom, enableTextSelection, targetUrl)
            }, 2000)
        } else {
            setupWebView(enableZoom, enableTextSelection, targetUrl)
        }

        createNotificationChannel()
        checkAndRequestPermissions()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(enableZoom: Boolean, enableTextSelection: Boolean, targetUrl: String) {
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webView)
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.setSupportMultipleWindows(true)
        settings.javaScriptCanOpenWindowsAutomatically = true

        val newUA = settings.userAgentString.replace("; wv", "")
        settings.userAgentString = newUA

        settings.setSupportZoom(enableZoom)
        settings.builtInZoomControls = enableZoom
        settings.displayZoomControls = false

        if (!enableTextSelection) {
            webView.setOnLongClickListener { true }
            webView.isLongClickable = false
            webView.isHapticFeedbackEnabled = false
        } else {
            webView.setOnLongClickListener(null)
            webView.isLongClickable = true
        }

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(webView, true)

        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                request?.grant(request.resources)
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileUploadCallback = filePathCallback
                val intent = Intent(Intent.ACTION_GET_CONTENT)
                intent.type = "*/*"
                fileChooserLauncher.launch(intent)
                return true
            }

            // Handle window.open() and target="_blank" for OAuth popups
            override fun onCreateWindow(
                view: WebView?,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message?
            ): Boolean {
                val newWebView = WebView(this@MainActivity)
                newWebView.settings.javaScriptEnabled = true
                newWebView.settings.domStorageEnabled = true
                newWebView.settings.userAgentString = view?.settings?.userAgentString

                val transport = resultMsg?.obj as? WebView.WebViewTransport
                transport?.webView = newWebView
                resultMsg?.sendToTarget()

                newWebView.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                        val popupUrl = request?.url.toString()
                        if (isAuthUrl(popupUrl)) {
                            openGoogleAuthInDialog(popupUrl)
                            return true
                        }
                        val targetHost = Uri.parse(lastTargetUrl).host ?: ""
                        if (targetHost.isNotEmpty() && popupUrl.contains(targetHost)) {
                            webView.loadUrl(popupUrl)
                            return true
                        }
                        return false
                    }
                }
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url.toString()

                // Handle Google/OAuth URLs - open in separate fullscreen dialog
                if (isAuthUrl(url)) {
                    openGoogleAuthInDialog(url)
                    return true
                }

                if (url.startsWith("http") || url.startsWith("https")) {
                    val targetHost = Uri.parse(targetUrl).host ?: ""
                    if (targetHost.isNotEmpty() && url.contains(targetHost)) {
                        return false
                    }
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                    return true
                }
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                    return true
                } catch (e: Exception) {
                    return true
                }
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    val failedUrl = request.url.toString()
                    if (!failedUrl.startsWith("file:///android_asset")) {
                        pendingRetryUrl = failedUrl
                    }
                    view?.stopLoading()
                    loadOfflinePage()
                }
            }

            override fun onReceivedHttpError(view: WebView?, request: WebResourceRequest?, errorResponse: WebResourceResponse?) {
                if (request?.isForMainFrame == true) {
                    val statusCode = errorResponse?.statusCode ?: 0
                    if (statusCode >= 500) {
                        val failedUrl = request.url.toString()
                        if (!failedUrl.startsWith("file:///android_asset")) {
                            pendingRetryUrl = failedUrl
                        }
                        view?.stopLoading()
                        loadOfflinePage()
                    }
                }
            }

            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (url != null && !url.startsWith("file:///android_asset")) {
                    if (!isNetworkAvailable()) {
                        view?.stopLoading()
                        loadOfflinePage()
                    } else {
                        isOfflinePageShowing = false
                    }
                }
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                if (url != null && url.startsWith("file:///android_asset/offline.html")) {
                    val retryUrl = if (pendingRetryUrl.isNotEmpty()) pendingRetryUrl else lastTargetUrl
                    view?.evaluateJavascript(
                        """(function() {
                            var btn = document.querySelector('.retry-btn');
                            if (btn) {
                                btn.onclick = function(e) {
                                    e.preventDefault();
                                    window.location.href = '$retryUrl';
                                };
                            }
                        })();""", null
                    )
                }
                CookieManager.getInstance().flush()
            }
        }

        pendingRetryUrl = targetUrl
        if (isNetworkAvailable()) {
            webView.loadUrl(targetUrl)
        } else {
            loadOfflinePage()
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "App Notifications"
            val descriptionText = "Default Channel"
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel("DEFAULT_CHANNEL", name, importance).apply {
                description = descriptionText
                enableVibration(true)
            }
            val notificationManager: NotificationManager =
                getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    private fun checkAndRequestPermissions() {
        val permissionsToRequest = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.CAMERA)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.RECORD_AUDIO)
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissionsToRequest.add(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        if (permissionsToRequest.isNotEmpty()) {
            requestPermissionLauncher.launch(permissionsToRequest.toTypedArray())
        }
    }

    override fun onBackPressed() {
        if (googleAuthDialog?.isShowing == true) {
            googleAuthDialog?.dismiss()
            return
        }
        if (::webView.isInitialized && webView.canGoBack()) {
            val currentUrl = webView.url ?: ""
            if (currentUrl.startsWith("file:///android_asset")) {
                if (isNetworkAvailable() && pendingRetryUrl.isNotEmpty()) {
                    isOfflinePageShowing = false
                    webView.loadUrl(pendingRetryUrl)
                } else {
                    super.onBackPressed()
                }
            } else {
                webView.goBack()
            }
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        googleAuthDialog?.dismiss()
        super.onDestroy()
    }
}
