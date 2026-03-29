package com.aite.studio

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class GoogleAuthActivity : AppCompatActivity() {

    private lateinit var authWebView: WebView

    companion object {
        const val EXTRA_AUTH_URL = "auth_url"
        const val EXTRA_TARGET_HOST = "target_host"
        const val EXTRA_RESULT_URL = "result_url"
        const val RESULT_AUTH_SUCCESS = 1001
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val authUrl = intent.getStringExtra(EXTRA_AUTH_URL) ?: run {
            finish()
            return
        }
        val targetHost = intent.getStringExtra(EXTRA_TARGET_HOST) ?: ""

        // Create a full-screen layout with the WebView
        val layout = LinearLayout(this)
        layout.orientation = LinearLayout.VERTICAL
        layout.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )

        authWebView = WebView(this)
        authWebView.layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.MATCH_PARENT
        )

        val settings = authWebView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.setSupportZoom(true)
        settings.builtInZoomControls = true
        settings.displayZoomControls = false
        settings.setSupportMultipleWindows(false)
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        // Use a real browser user agent so Google does not block WebView
        settings.userAgentString = "Mozilla/5.0 (Linux; Android ${Build.VERSION.RELEASE}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"

        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(authWebView, true)

        authWebView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val reqUrl = request?.url.toString()
                // When OAuth redirects back to the app's target host, return the URL to MainActivity
                if (targetHost.isNotEmpty() && reqUrl.contains(targetHost)) {
                    cookieManager.flush()
                    val resultIntent = Intent()
                    resultIntent.putExtra(EXTRA_RESULT_URL, reqUrl)
                    setResult(RESULT_AUTH_SUCCESS, resultIntent)
                    finish()
                    return true
                }
                // Let all other URLs (Google OAuth pages) load inside this Activity's WebView
                return false
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                if (request?.isForMainFrame == true) {
                    Toast.makeText(this@GoogleAuthActivity, "\u062E\u0637\u0623 \u0641\u064A \u0627\u0644\u0627\u062A\u0635\u0627\u0644", Toast.LENGTH_SHORT).show()
                }
            }
        }

        authWebView.webChromeClient = object : WebChromeClient() {
            override fun onCloseWindow(window: WebView?) {
                finish()
            }
        }

        layout.addView(authWebView)
        setContentView(layout)

        authWebView.loadUrl(authUrl)
    }

    override fun onBackPressed() {
        if (authWebView.canGoBack()) {
            authWebView.goBack()
        } else {
            setResult(Activity.RESULT_CANCELED)
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        authWebView.stopLoading()
        authWebView.destroy()
        super.onDestroy()
    }
}
