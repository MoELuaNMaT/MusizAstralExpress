package com.allmusic.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat

data class PlaybackSnapshot(
  val title: String,
  val artist: String,
  val album: String,
  val coverUrl: String,
  val isPlaying: Boolean,
  val positionMs: Long,
  val durationMs: Long,
)

class AllMusicPlaybackService : Service() {
  private var currentSnapshot: PlaybackSnapshot? = null
  private var isForegroundRunning = false
  private lateinit var notificationManager: NotificationManager
  private lateinit var mediaSession: MediaSessionCompat

  override fun onCreate() {
    super.onCreate()
    notificationManager = getSystemService(NotificationManager::class.java)
    ensureNotificationChannel()

    mediaSession = MediaSessionCompat(this, MEDIA_SESSION_TAG).apply {
      setCallback(object : MediaSessionCompat.Callback() {
        override fun onPlay() {
          dispatchAndUpdate(ACTION_PLAY)
        }

        override fun onPause() {
          dispatchAndUpdate(ACTION_PAUSE)
        }

        override fun onSkipToNext() {
          dispatchAndUpdate(ACTION_NEXT)
        }

        override fun onSkipToPrevious() {
          dispatchAndUpdate(ACTION_PREVIOUS)
        }
      })
      isActive = true
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_SYNC -> {
        val snapshot = snapshotFromIntent(intent)
        if (snapshot == null) {
          stopPlaybackService()
        } else {
          currentSnapshot = snapshot
          publishSnapshot(snapshot)
        }
      }

      ACTION_PLAY,
      ACTION_PAUSE,
      ACTION_NEXT,
      ACTION_PREVIOUS -> {
        dispatchAndUpdate(intent.action ?: "")
      }

      ACTION_STOP -> {
        stopPlaybackService()
      }
    }

    return START_STICKY
  }

  override fun onDestroy() {
    stopPlaybackService()
    mediaSession.release()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun dispatchAndUpdate(action: String) {
    val snapshot = currentSnapshot ?: return

    when (action) {
      ACTION_PLAY -> currentSnapshot = snapshot.copy(isPlaying = true)
      ACTION_PAUSE -> currentSnapshot = snapshot.copy(isPlaying = false)
      ACTION_NEXT -> currentSnapshot = snapshot.copy(positionMs = 0L)
      ACTION_PREVIOUS -> currentSnapshot = snapshot.copy(positionMs = 0L)
    }

    val updated = currentSnapshot
    if (updated != null) {
      publishSnapshot(updated)
    }

    AllMusicPlaybackBridge.dispatchPlayerAction(action)
  }

  private fun publishSnapshot(snapshot: PlaybackSnapshot) {
    updateMediaSession(snapshot)
    val notification = buildNotification(snapshot)

    if (snapshot.isPlaying) {
      if (isForegroundRunning) {
        notificationManager.notify(NOTIFICATION_ID, notification)
      } else {
        startForeground(NOTIFICATION_ID, notification)
        isForegroundRunning = true
      }
      return
    }

    if (isForegroundRunning) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        stopForeground(STOP_FOREGROUND_DETACH)
      } else {
        @Suppress("DEPRECATION")
        stopForeground(false)
      }
      isForegroundRunning = false
    }

    notificationManager.notify(NOTIFICATION_ID, notification)
  }

  private fun updateMediaSession(snapshot: PlaybackSnapshot) {
    val state = if (snapshot.isPlaying) {
      PlaybackStateCompat.STATE_PLAYING
    } else {
      PlaybackStateCompat.STATE_PAUSED
    }

    val actions = (
      PlaybackStateCompat.ACTION_PLAY
        or PlaybackStateCompat.ACTION_PAUSE
        or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
        or PlaybackStateCompat.ACTION_SKIP_TO_NEXT
      )

    val playbackRate = if (snapshot.isPlaying) 1f else 0f
    mediaSession.setPlaybackState(
      PlaybackStateCompat.Builder()
        .setActions(actions)
        .setState(state, snapshot.positionMs, playbackRate)
        .build(),
    )

    mediaSession.setMetadata(
      MediaMetadataCompat.Builder()
        .putString(MediaMetadataCompat.METADATA_KEY_TITLE, snapshot.title)
        .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, snapshot.artist)
        .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, snapshot.album)
        .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, snapshot.durationMs)
        .build(),
    )
    mediaSession.isActive = true
  }

  private fun buildNotification(snapshot: PlaybackSnapshot): Notification {
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
      ?.apply {
        addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      ?: Intent(this, MainActivity::class.java)

    val contentIntent = PendingIntent.getActivity(
      this,
      1,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val playPauseAction = if (snapshot.isPlaying) {
      NotificationCompat.Action(
        android.R.drawable.ic_media_pause,
        "暂停",
        servicePendingIntent(ACTION_PAUSE, 11),
      )
    } else {
      NotificationCompat.Action(
        android.R.drawable.ic_media_play,
        "播放",
        servicePendingIntent(ACTION_PLAY, 12),
      )
    }

    val mediaStyle = androidx.media.app.NotificationCompat.MediaStyle()
      .setMediaSession(mediaSession.sessionToken)
      .setShowActionsInCompactView(0, 1, 2)

    val subtitle = if (snapshot.artist.isNotEmpty()) {
      snapshot.artist
    } else {
      "ALLMusic"
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(snapshot.title)
      .setContentText(subtitle)
      .setSubText(snapshot.album.takeIf { it.isNotEmpty() })
      .setContentIntent(contentIntent)
      .setOnlyAlertOnce(true)
      .setOngoing(snapshot.isPlaying)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setStyle(mediaStyle)
      .addAction(
        NotificationCompat.Action(
          android.R.drawable.ic_media_previous,
          "上一首",
          servicePendingIntent(ACTION_PREVIOUS, 10),
        ),
      )
      .addAction(playPauseAction)
      .addAction(
        NotificationCompat.Action(
          android.R.drawable.ic_media_next,
          "下一首",
          servicePendingIntent(ACTION_NEXT, 13),
        ),
      )
      .build()
  }

  private fun servicePendingIntent(action: String, requestCode: Int): PendingIntent {
    val intent = Intent(this, AllMusicPlaybackService::class.java).apply {
      this.action = action
    }
    return PendingIntent.getService(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  private fun stopPlaybackService() {
    currentSnapshot = null
    mediaSession.isActive = false
    if (isForegroundRunning) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      isForegroundRunning = false
    } else {
      notificationManager.cancel(NOTIFICATION_ID)
    }
    stopSelf()
  }

  private fun snapshotFromIntent(intent: Intent): PlaybackSnapshot? {
    val title = intent.getStringExtra(EXTRA_TITLE)?.trim().orEmpty()
    if (title.isEmpty()) {
      return null
    }

    return PlaybackSnapshot(
      title = title,
      artist = intent.getStringExtra(EXTRA_ARTIST)?.trim().orEmpty(),
      album = intent.getStringExtra(EXTRA_ALBUM)?.trim().orEmpty(),
      coverUrl = intent.getStringExtra(EXTRA_COVER_URL)?.trim().orEmpty(),
      isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, false),
      positionMs = intent.getLongExtra(EXTRA_POSITION_MS, 0L).coerceAtLeast(0L),
      durationMs = intent.getLongExtra(EXTRA_DURATION_MS, 0L).coerceAtLeast(0L),
    )
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }

    val channel = NotificationChannel(
      CHANNEL_ID,
      "ALLMusic 播放控制",
      NotificationManager.IMPORTANCE_LOW,
    ).apply {
      description = "用于显示 ALLMusic 播放状态与控制按钮"
      setShowBadge(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }

    notificationManager.createNotificationChannel(channel)
  }

  companion object {
    private const val CHANNEL_ID = "allmusic_playback_channel"
    private const val NOTIFICATION_ID = 16301
    private const val MEDIA_SESSION_TAG = "ALLMusicPlaybackSession"

    const val ACTION_SYNC = "com.allmusic.app.action.SYNC"
    const val ACTION_PLAY = "com.allmusic.app.action.PLAY"
    const val ACTION_PAUSE = "com.allmusic.app.action.PAUSE"
    const val ACTION_NEXT = "com.allmusic.app.action.NEXT"
    const val ACTION_PREVIOUS = "com.allmusic.app.action.PREVIOUS"
    const val ACTION_STOP = "com.allmusic.app.action.STOP"

    private const val EXTRA_TITLE = "extra_title"
    private const val EXTRA_ARTIST = "extra_artist"
    private const val EXTRA_ALBUM = "extra_album"
    private const val EXTRA_COVER_URL = "extra_cover_url"
    private const val EXTRA_IS_PLAYING = "extra_is_playing"
    private const val EXTRA_POSITION_MS = "extra_position_ms"
    private const val EXTRA_DURATION_MS = "extra_duration_ms"

    fun startOrUpdate(context: Context, snapshot: PlaybackSnapshot) {
      val intent = Intent(context, AllMusicPlaybackService::class.java).apply {
        action = ACTION_SYNC
        putExtra(EXTRA_TITLE, snapshot.title)
        putExtra(EXTRA_ARTIST, snapshot.artist)
        putExtra(EXTRA_ALBUM, snapshot.album)
        putExtra(EXTRA_COVER_URL, snapshot.coverUrl)
        putExtra(EXTRA_IS_PLAYING, snapshot.isPlaying)
        putExtra(EXTRA_POSITION_MS, snapshot.positionMs)
        putExtra(EXTRA_DURATION_MS, snapshot.durationMs)
      }

      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      val intent = Intent(context, AllMusicPlaybackService::class.java).apply {
        action = ACTION_STOP
      }
      context.startService(intent)
    }
  }
}
