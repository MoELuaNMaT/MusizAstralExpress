package com.allmusic.app

import android.content.Context
import android.webkit.JavascriptInterface

class AllMusicMediaJsBridge(private val context: Context) {
  @JavascriptInterface
  fun updatePlayback(
    title: String?,
    artist: String?,
    album: String?,
    coverUrl: String?,
    isPlaying: Boolean,
    positionMs: Double,
    durationMs: Double,
  ) {
    val resolvedTitle = (title ?: "").trim()
    if (resolvedTitle.isEmpty()) {
      clearPlayback()
      return
    }

    val snapshot = PlaybackSnapshot(
      title = resolvedTitle,
      artist = (artist ?: "").trim(),
      album = (album ?: "").trim(),
      coverUrl = (coverUrl ?: "").trim(),
      isPlaying = isPlaying,
      positionMs = clampNumber(positionMs),
      durationMs = clampNumber(durationMs),
    )

    AllMusicPlaybackService.startOrUpdate(context, snapshot)
  }

  @JavascriptInterface
  fun clearPlayback() {
    AllMusicPlaybackService.stop(context)
  }

  private fun clampNumber(value: Double): Long {
    if (!value.isFinite() || value <= 0) {
      return 0L
    }
    return value.toLong()
  }
}
