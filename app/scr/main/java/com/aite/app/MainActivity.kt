package com.aite.studio

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        webView = WebView(this)
        setContentView(webView)

        val webSettings = webView.settings
        webSettings.javaScriptEnabled = true
        webSettings.domStorageEnabled = true
        webSettings.displayZoomControls = false
        webSettings.builtInZoomControls = false
        webSettings.useWideViewPort = true
        webSettings.loadWithOverviewMode = true

        webView.webViewClient = WebViewClient()
        
        // سيقوم GitHub Action باستبدال الرابط أدناه
        webView.loadUrl("WEB_URL_PLACEHOLDER")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
