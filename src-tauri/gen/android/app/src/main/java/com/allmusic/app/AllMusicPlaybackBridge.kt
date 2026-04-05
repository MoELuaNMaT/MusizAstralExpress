package com.allmusic.app

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import java.lang.ref.WeakReference

object AllMusicPlaybackBridge {
  private val mainHandler = Handler(Looper.getMainLooper())
  private var webViewRef: WeakReference<WebView>? = null

  fun attachWebView(webView: WebView) {
    webViewRef = WeakReference(webView)
  }

  fun detachWebView(webView: WebView?) {
    val current = webViewRef?.get()
    if (webView == null || current == webView) {
      webViewRef = null
    }
  }

  fun dispatchPlayerAction(action: String) {
    val script = when (action) {
      AllMusicPlaybackService.ACTION_PREVIOUS -> "window.__ALLMUSIC_BRIDGE__?.playPrevious?.();"
      AllMusicPlaybackService.ACTION_NEXT -> "window.__ALLMUSIC_BRIDGE__?.playNext?.();"
      AllMusicPlaybackService.ACTION_PLAY -> "window.__ALLMUSIC_BRIDGE__?.getPlayerState?.().then((s)=>{ if(!s?.isPlaying){ window.__ALLMUSIC_BRIDGE__?.togglePlay?.(); } });"
      AllMusicPlaybackService.ACTION_PAUSE -> "window.__ALLMUSIC_BRIDGE__?.getPlayerState?.().then((s)=>{ if(s?.isPlaying){ window.__ALLMUSIC_BRIDGE__?.togglePlay?.(); } });"
      else -> return
    }

    val webView = webViewRef?.get() ?: return
    mainHandler.post {
      webView.evaluateJavascript(script, null)
    }
  }
}
