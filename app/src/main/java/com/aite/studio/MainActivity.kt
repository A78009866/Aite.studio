package com.aite.studio

import android.Manifest
import android.annotation.SuppressLint
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
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var isOfflinePageShowing = false
    private var lastTargetUrl = ""
    private var pendingRetryUrl = ""

    // Google/OAuth domains that should open in a separate auth page
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

    // Launcher for Google Auth Activity - when auth succeeds, load the returned URL (build page)
    private val googleAuthLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == GoogleAuthActivity.RESULT_AUTH_SUCCESS) {
            val resultUrl = result.data?.getStringExtra(GoogleAuthActivity.EXTRA_RESULT_URL)
            if (!resultUrl.isNullOrEmpty() && ::webView.isInitialized) {
                CookieManager.getInstance().flush()
                webView.loadUrl(resultUrl)
            }
        }
    }

    private fun loadOfflinePage() {
        if (isOfflinePageShowing) return
        isOfflinePageShowing = true
        webView.stopLoading()
        webView.loadUrl("file:///android_asset/offline.html")
    }

    private fun openGoogleAuthPage(url: String) {
        val intent = Intent(this, GoogleAuthActivity::class.java)
        intent.putExtra(GoogleAuthActivity.EXTRA_AUTH_URL, url)
        intent.putExtra(GoogleAuthActivity.EXTRA_TARGET_HOST, Uri.parse(lastTargetUrl).host ?: "")
        googleAuthLauncher.launch(intent)
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
                            openGoogleAuthPage(popupUrl)
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

                // Handle Google/OAuth URLs - open in separate auth page
                if (isAuthUrl(url)) {
                    openGoogleAuthPage(url)
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
        super.onDestroy()
    }
}
