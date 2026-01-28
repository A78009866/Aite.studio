package com.aite.studio

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
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

    // Launchers for Permissions and Files
    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        // Handle permission results
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
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // --- Customization Placeholders (Will be replaced by GitHub Actions) ---
        val enableZoom = "ENABLE_ZOOM_PLACEHOLDER".toBoolean()
        val enableTextSelection = "ENABLE_TEXT_SELECTION_PLACEHOLDER".toBoolean()
        val enableSplashScreen = "ENABLE_SPLASH_SCREEN_PLACEHOLDER".toBoolean()
        val enableFullScreen = "false".toBoolean() // Keeping this as false for now, can be added later
        val targetUrl = "WEB_URL_PLACEHOLDER"
        // ----------------------------------------------------------------------

        // 1. Handle Fullscreen (if needed)
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
            }, 2000) // Display splash screen for 2 seconds
        } else {
            setupWebView(enableZoom, enableTextSelection, targetUrl)
        }
        
        // 2. Setup Notifications Channel (With Vibration)
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
        
        val newUA = settings.userAgentString.replace("; wv", "")
        settings.userAgentString = newUA
        
        // 3. Handle Zoom Customization
        settings.setSupportZoom(enableZoom)
        settings.builtInZoomControls = enableZoom
        settings.displayZoomControls = false

        // 4. Handle Text Selection Customization
        if (!enableTextSelection) {
            webView.setOnLongClickListener { true } // Disables long press context menu
            webView.isLongClickable = false // Also disable long click for text selection
            webView.isHapticFeedbackEnabled = false
        } else {
            webView.setOnLongClickListener(null)
            webView.isLongClickable = true
        }

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
        }

        // 5. Handle External Links & Apps
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url.toString()
                
                // Keep app's own links inside WebView
                if (url.startsWith("http") || url.startsWith("https")) {
                    if (url.contains(Uri.parse(targetUrl).host ?: "")) {
                        return false 
                    }
                    // Open other websites in external browser
                    try {
                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                        startActivity(intent)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                    return true
                } 
                
                // Handle Schemes (tel:, mailto:, whatsapp:, intent:)
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                    return true
                } catch (e: Exception) {
                    // App not installed
                    return true
                }
            }
        }

        webView.loadUrl(targetUrl)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "App Notifications"
            val descriptionText = "Default Channel"
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel("DEFAULT_CHANNEL", name, importance).apply {
                description = descriptionText
                enableVibration(true) // Force Vibration
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

        // Notification Permission for Android 13+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        
        if (permissionsToRequest.isNotEmpty()) {
            requestPermissionLauncher.launch(permissionsToTypedArray())
        }
    }

    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) { // Check if webView is initialized
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
