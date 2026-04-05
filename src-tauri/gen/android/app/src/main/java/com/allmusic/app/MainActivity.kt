package com.allmusic.app

import android.os.Bundle
import android.os.SystemClock
import android.webkit.WebView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var allMusicWebView: WebView? = null
  private var lastBackPressedAtMs: Long = 0L

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    onBackPressedDispatcher.addCallback(
      this,
      object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
          handleAndroidBackPressed()
        }
      },
    )
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    allMusicWebView = webView
    AllMusicPlaybackBridge.attachWebView(webView)
    webView.addJavascriptInterface(
      AllMusicMediaJsBridge(applicationContext),
      "AllMusicAndroidMedia",
    )
  }

  override fun onDestroy() {
    AllMusicPlaybackBridge.detachWebView(allMusicWebView)
    allMusicWebView = null
    super.onDestroy()
  }

  private fun handleAndroidBackPressed() {
    val webView = allMusicWebView
    if (webView == null) {
      handleExitBackPress()
      return
    }

    webView.evaluateJavascript(BACK_PRESS_CONSUME_SCRIPT) { rawResult ->
      val consumedByWeb = rawResult?.trim()?.equals("true", ignoreCase = true) == true
      if (consumedByWeb) {
        return@evaluateJavascript
      }
      handleExitBackPress()
    }
  }

  private fun handleExitBackPress() {
    val now = SystemClock.elapsedRealtime()
    if (now - lastBackPressedAtMs <= EXIT_CONFIRM_WINDOW_MS) {
      finishAffinity()
      return
    }

    lastBackPressedAtMs = now
    Toast.makeText(this, "Press back again to exit ALLMusic", Toast.LENGTH_SHORT).show()
  }

  companion object {
    private const val EXIT_CONFIRM_WINDOW_MS = 2000L
    private const val BACK_PRESS_CONSUME_SCRIPT = """
      (function () {
        try {
          var event = new CustomEvent('allmusic:android-back-press', { cancelable: true });
          if (!window.dispatchEvent(event)) {
            return true;
          }

          if (window.history && window.history.length > 1) {
            window.history.back();
            return true;
          }

          return false;
        } catch (error) {
          return false;
        }
      })();
    """
  }
}
