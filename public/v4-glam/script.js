(function () {
  const BRIDGE_WAIT_TIMEOUT = 8000;
  const PLAYER_SYNC_INTERVAL = 800;
  const AUTH_SYNC_INTERVAL = 8000;
  const LOCAL_API_READY_EVENT = 'allmusic:local-api-ready';
  const BRIDGE_CACHE_UPDATED_EVENT = 'allmusic:bridge-cache-updated';
  const OPEN_UI_SWITCHER_EVENT = 'allmusic:open-ui-switcher';

  const tabs = Array.from(document.querySelectorAll('.top-tabs .win-btn'));
  const pages = {
    login: document.getElementById('page-login'),
    home: document.getElementById('page-home'),
    player: document.getElementById('page-player'),
  };

  const toastEl = document.getElementById('toast');
  const statusTextEl = document.getElementById('status-text');

  const playlistListEl = document.getElementById('playlist-list');
  const songTbodyEl = document.getElementById('song-tbody');
  const queueListEl = document.getElementById('queue-list');
  const queueCountEl = document.getElementById('queue-count');

  const detailTrackEl = document.getElementById('detail-track');
  const detailPlatformEl = document.getElementById('detail-platform');
  const detailAlbumEl = document.getElementById('detail-album');
  const detailLyricEl = document.getElementById('detail-lyric');
  const homeResultCountEl = document.getElementById('home-result-count');

  const searchInputEl = document.getElementById('search-input');
  const searchBtnEl = document.getElementById('search-btn');
  const platformFilterEl = document.getElementById('platform-filter');

  const connectAllEl = document.getElementById('connect-all');
  const playSelectedEl = document.getElementById('play-selected');
  const likeSelectedEl = document.getElementById('like-selected');
  const neteaseQrBoxEl = document.getElementById('ne-qr-box');
  const neteaseRefreshQrEl = document.getElementById('ne-refresh-qr');
  const neteaseLoginStatusEl = document.getElementById('ne-login-status');
  const qqQrBoxEl = document.getElementById('qq-qr-box');
  const qqStartQrEl = document.getElementById('qq-start-qr');
  const qqLoginStatusEl = document.getElementById('qq-login-status');

  const nowTitleEl = document.getElementById('now-title');
  const trackMarqEl = document.getElementById('track-marq');
  const coverMarqEl = document.getElementById('cover-marq');
  const homeNowPlayingEl = document.getElementById('home-nowplaying');
  const cdCenterCoverEl = document.getElementById('cd-center-cover');
  const lyricLineOneEl = document.getElementById('lyric-marq-line1');
  const lyricLineTwoEl = document.getElementById('lyric-marq-line2');
  const lyricModeButtonEls = Array.from(document.querySelectorAll('.lyric-mode-btn'));

  const togglePlayEl = document.getElementById('toggle-play');
  const homePlayToggleEl = document.getElementById('home-play-toggle');
  const playStateChipEl = document.getElementById('play-state-chip');
  const cdDiscEl = document.getElementById('cd-disc');

  const progressEl = document.getElementById('progress');
  const currentTimeEl = document.getElementById('current-time');
  const totalTimeEl = document.getElementById('total-time');

  const homeProgressEl = document.getElementById('home-progress');
  const homeCurrentTimeEl = document.getElementById('home-current-time');
  const homeTotalTimeEl = document.getElementById('home-total-time');

  const volumeEl = document.getElementById('volume');
  const volumeLabelEl = document.getElementById('volume-label');
  const homeVolumeEl = document.getElementById('home-volume');
  const homeVolumeLabelEl = document.getElementById('home-volume-label');

  const homePrevEl = document.getElementById('home-prev');
  const homeNextEl = document.getElementById('home-next');
  const homePlayModeEl = document.getElementById('home-play-mode');
  const playerPlayModeEl = document.getElementById('player-play-mode');

  const clockEl = document.getElementById('clock');
  const trayTimeEl = document.getElementById('tray-time');
  const toggleDiscoEl = document.getElementById('toggle-disco');
  const openUiSwitcherEl = document.getElementById('open-ui-switcher');

  const quickStatusLeftEl = document.querySelector('.quick-status .status-left');

  const state = {
    playlistEntries: [],
    currentEntryId: '',
    allSongs: [],
    visibleSongs: [],
    selectedSongIndex: -1,
    latestDailyCount: 0,
    syncingPlayer: false,
    lyricRequestToken: 0,
    lyricMode: 'original',
    lyricCache: Object.create(null),
    lyricPending: Object.create(null),
    detailLyricSongId: '',
    detailLyricMode: 'original',
    detailLyricTimeline: [],
    detailLyricRowEls: [],
    detailLyricActiveIndex: -1,
    detailLyricScrollRafId: 0,
    detailLyricLastScrollTop: -1,
    currentPlayerSong: null,
    currentPlayerTimeMs: 0,
    playMode: 'sequential',
    lastLocalApiReadyAt: 0,
    lastBridgeCacheRefreshAt: 0,
  };

  let toastTimer = null;
  let neteaseQrAbortController = null;
  let qqQrAbortController = null;

  function resolveBridge() {
    if (window.parent && window.parent !== window && window.parent.__ALLMUSIC_BRIDGE__) {
      return window.parent.__ALLMUSIC_BRIDGE__;
    }
    if (window.__ALLMUSIC_BRIDGE__) {
      return window.__ALLMUSIC_BRIDGE__;
    }
    return null;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForBridge(timeoutMs) {
    const startAt = Date.now();
    while (Date.now() - startAt < timeoutMs) {
      if (resolveBridge()) {
        return true;
      }
      await wait(120);
    }
    return false;
  }

  async function requestOpenUiSwitcher() {
    const bridge = resolveBridge();
    if (bridge && typeof bridge.openUiSwitcher === 'function') {
      await bridge.openUiSwitcher();
      return;
    }

    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: OPEN_UI_SWITCHER_EVENT }, '*');
      return;
    }
    window.dispatchEvent(new CustomEvent(OPEN_UI_SWITCHER_EVENT));
  }

  function showToast(message) {
    if (!toastEl) {
      return;
    }
    toastEl.textContent = String(message || '');
    toastEl.classList.add('show');
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
    }, 1800);
  }

  function setStatus(message) {
    if (statusTextEl) {
      statusTextEl.textContent = `STATUS: ${message}`;
    }
  }

  function setLoginStatus(statusEl, message, isError = false) {
    if (!statusEl) {
      return;
    }
    statusEl.classList.add('auth-status');
    statusEl.textContent = String(message || '');
    statusEl.style.color = isError ? '#b60056' : '#0c4d87';
  }

  function renderQrImage(qrBoxEl, url) {
    if (!qrBoxEl) {
      return;
    }

    qrBoxEl.classList.remove('has-image');
    qrBoxEl.innerHTML = '';

    if (!url) {
      return;
    }

    const img = document.createElement('img');
    img.className = 'qr-image';
    img.alt = 'QRCode';
    img.src = String(url);
    qrBoxEl.appendChild(img);
    qrBoxEl.classList.add('has-image');
  }

  function normalizeInputValue(inputEl) {
    return inputEl && typeof inputEl.value === 'string'
      ? inputEl.value.trim()
      : '';
  }

  function isMaskedValue(value) {
    return typeof value === 'string' && value.includes('*');
  }

  function go(pageKey) {
    tabs.forEach((btn) => {
      btn.classList.toggle('active-tab', btn.dataset.page === pageKey);
    });
    Object.entries(pages).forEach(([key, el]) => {
      if (el) {
        el.classList.toggle('active', key === pageKey);
      }
    });
  }

  function bindTabEvents() {
    tabs.forEach((btn) => {
      btn.addEventListener('click', () => go(btn.dataset.page));
    });
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDurationMs(ms) {
    const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function platformLabel(platform) {
    if (platform === 'netease') {
      return 'NetEase';
    }
    if (platform === 'qq') {
      return 'QQ';
    }
    return 'Mixed';
  }

  function platformBadgeClass(platform) {
    return platform === 'qq' ? 'qq' : 'netease';
  }

  function platformShort(platform) {
    if (platform === 'netease') return '[NE]';
    if (platform === 'qq') return '[QQ]';
    return '[MX]';
  }

  function toTrackText(song) {
    if (!song) {
      return 'No track';
    }
    return `${song.name || 'Unknown Track'} - ${song.artist || 'Unknown Artist'}`;
  }

  function stripLyricLine(line) {
    return String(line || '')
      .replace(/\[[^\]]*]/g, '')
      .replace(/^\s+|\s+$/g, '');
  }

  function toLyricMillis(minuteText, secondText, decimalText) {
    const minute = Number(minuteText);
    const second = Number(secondText);
    if (!Number.isFinite(minute) || !Number.isFinite(second)) {
      return 0;
    }

    let ms = 0;
    if (decimalText) {
      const normalized = String(decimalText).padEnd(3, '0').slice(0, 3);
      ms = Number(normalized) || 0;
    }

    return (minute * 60 * 1000) + (second * 1000) + ms;
  }

  function parseLyricPayload(rawLyric) {
    const timeTagRegex = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
    const timeline = [];
    const plainLines = [];

    String(rawLyric || '')
      .split(/\r?\n/g)
      .forEach((rawLine) => {
        const line = String(rawLine || '').trim();
        if (!line) {
          return;
        }

        const matches = Array.from(line.matchAll(timeTagRegex));
        const text = stripLyricLine(line);
        if (!text) {
          return;
        }

        if (matches.length === 0) {
          plainLines.push(text);
          return;
        }

        matches.forEach((match) => {
          const minuteText = match[1];
          const secondText = match[2];
          const decimalText = match[3];
          timeline.push({
            timeMs: toLyricMillis(minuteText, secondText, decimalText),
            text,
          });
        });
      });

    timeline.sort((a, b) => a.timeMs - b.timeMs);
    if (timeline.length > 0) {
      return {
        lines: timeline.map((item) => item.text),
        timeline,
      };
    }

    return {
      lines: plainLines,
      timeline: [],
    };
  }

  function resolveLyricText(lines, timeline, currentTimeMs) {
    const safeLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
    if (safeLines.length === 0) {
      return '';
    }

    const safeTimeline = Array.isArray(timeline) ? timeline : [];
    if (safeTimeline.length > 0) {
      const target = Math.max(0, Number(currentTimeMs) || 0);
      for (let index = safeTimeline.length - 1; index >= 0; index -= 1) {
        if (target >= safeTimeline[index].timeMs) {
          return safeTimeline[index].text;
        }
      }
      return safeTimeline[0].text;
    }

    const rollingIndex = Math.floor(Math.max(0, Number(currentTimeMs) || 0) / 3000) % safeLines.length;
    return safeLines[rollingIndex] || safeLines[0] || '';
  }

  function getLyricMode() {
    return state.lyricMode === 'translated' || state.lyricMode === 'both' ? state.lyricMode : 'original';
  }

  function updateLyricModeButtons() {
    lyricModeButtonEls.forEach((buttonEl) => {
      const mode = buttonEl.getAttribute('data-lyric-mode');
      buttonEl.classList.toggle('active', mode === getLyricMode());
    });
  }

  function updateDiscCenterCover(song) {
    if (!cdCenterCoverEl) {
      return;
    }
    const coverUrl = song && song.coverUrl ? String(song.coverUrl) : '';
    if (coverUrl) {
      cdCenterCoverEl.style.backgroundImage = `url("${coverUrl}")`;
      return;
    }
    cdCenterCoverEl.style.backgroundImage = '';
  }

  function renderPlayerLyrics(song, currentTimeMs) {
    if (!lyricLineOneEl || !lyricLineTwoEl) {
      return;
    }

    if (!song) {
      lyricLineOneEl.textContent = 'No track is playing';
      lyricLineTwoEl.textContent = '';
      lyricLineTwoEl.style.display = 'none';
      return;
    }

    const cacheEntry = state.lyricCache[song.id];
    if (!cacheEntry) {
      lyricLineOneEl.textContent = 'Loading lyrics...';
      lyricLineTwoEl.textContent = '';
      lyricLineTwoEl.style.display = 'none';
      return;
    }

    const originalText = resolveLyricText(cacheEntry.originalLines, cacheEntry.originalTimeline, currentTimeMs);
    const translatedText = resolveLyricText(cacheEntry.translatedLines, cacheEntry.translatedTimeline, currentTimeMs);
    const primaryFallback = originalText || translatedText || 'No lyric available';
    const mode = getLyricMode();

    if (mode === 'original') {
      lyricLineOneEl.textContent = originalText || translatedText || 'No lyric available';
      lyricLineTwoEl.style.display = 'none';
      return;
    }

    if (mode === 'translated') {
      lyricLineOneEl.textContent = translatedText || originalText || 'No lyric available';
      lyricLineTwoEl.style.display = 'none';
      return;
    }

    lyricLineOneEl.textContent = primaryFallback;
    if (translatedText && translatedText !== primaryFallback) {
      lyricLineTwoEl.textContent = translatedText;
      lyricLineTwoEl.style.display = 'block';
      return;
    }

    lyricLineTwoEl.textContent = '';
    lyricLineTwoEl.style.display = 'none';
  }

  async function ensureLyricsLoaded(song) {
    const bridge = resolveBridge();
    if (!song || !song.id || !bridge || typeof bridge.loadSongLyrics !== 'function') {
      return null;
    }

    if (state.lyricCache[song.id]) {
      return state.lyricCache[song.id];
    }

    if (state.lyricPending[song.id]) {
      return state.lyricPending[song.id];
    }

    const task = bridge.loadSongLyrics(song)
      .then((lyricResult) => {
        const originalPayload = parseLyricPayload(lyricResult && lyricResult.lyric);
        const translatedPayload = parseLyricPayload(lyricResult && lyricResult.translatedLyric);
        const entry = {
          originalLines: originalPayload.lines,
          originalTimeline: originalPayload.timeline,
          translatedLines: translatedPayload.lines,
          translatedTimeline: translatedPayload.timeline,
        };
        state.lyricCache[song.id] = entry;
        return entry;
      })
      .catch((error) => {
        console.error('[V4 Glam] lyric load failed:', error);
        const fallback = {
          originalLines: [],
          originalTimeline: [],
          translatedLines: [],
          translatedTimeline: [],
        };
        state.lyricCache[song.id] = fallback;
        return fallback;
      })
      .finally(() => {
        delete state.lyricPending[song.id];
      });

    state.lyricPending[song.id] = task;
    return task;
  }

  function buildDetailLyricView(song, lyricEntry) {
    if (!detailLyricEl) return;

    const songId = song ? song.id : '';
    state.detailLyricSongId = songId;
    state.detailLyricTimeline = [];
    state.detailLyricRowEls = [];
    state.detailLyricActiveIndex = -1;
    state.detailLyricLastScrollTop = -1;

    if (!song || !lyricEntry) {
      detailLyricEl.innerHTML = '<div class="hint" style="padding:16px;text-align:center;">No lyrics available</div>';
      return;
    }

    const timeline = (lyricEntry.originalTimeline && lyricEntry.originalTimeline.length > 0)
      ? lyricEntry.originalTimeline
      : (lyricEntry.translatedTimeline || []);

    state.detailLyricTimeline = timeline;

    if (timeline.length === 0) {
      const lines = lyricEntry.originalLines.length > 0 ? lyricEntry.originalLines : lyricEntry.translatedLines;
      if (lines.length === 0) {
        detailLyricEl.innerHTML = '<div class="hint" style="padding:16px;text-align:center;">No lyrics available</div>';
      } else {
        detailLyricEl.innerHTML = lines.map(line => `<div class="detail-lyric-line">${escapeHtml(line)}</div>`).join('');
      }
      return;
    }

    const fragment = document.createDocumentFragment();
    const topSpacer = document.createElement('div');
    topSpacer.className = 'lyric-spacer';
    fragment.appendChild(topSpacer);

    timeline.forEach((item, index) => {
      const lineEl = document.createElement('div');
      lineEl.className = 'detail-lyric-line';
      lineEl.textContent = item.text;
      state.detailLyricRowEls.push(lineEl);
      fragment.appendChild(lineEl);
    });

    const bottomSpacer = document.createElement('div');
    bottomSpacer.className = 'lyric-spacer';
    fragment.appendChild(bottomSpacer);

    detailLyricEl.innerHTML = '';
    detailLyricEl.appendChild(fragment);
    detailLyricEl.scrollTop = 0;
  }

  function getActiveLyricIndex(timeline, currentTimeMs, hintIndex) {
    if (!timeline || timeline.length === 0) return -1;
    const target = Math.max(0, currentTimeMs);
    if (hintIndex >= 0 && hintIndex < timeline.length) {
      if (target >= timeline[hintIndex].timeMs) {
        if (hintIndex === timeline.length - 1 || target < timeline[hintIndex + 1].timeMs) return hintIndex;
        if (hintIndex + 1 < timeline.length && target >= timeline[hintIndex + 1].timeMs) {
          if (hintIndex + 2 >= timeline.length || target < timeline[hintIndex + 2].timeMs) return hintIndex + 1;
        }
      }
    }
    let low = 0, high = timeline.length - 1, ans = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (timeline[mid].timeMs <= target) { ans = mid; low = mid + 1; }
      else high = mid - 1;
    }
    return ans;
  }

  function syncDetailLyricByTime(currentSong, currentTimeMs) {
    if (!detailLyricEl || !state.detailLyricTimeline.length || !currentSong || currentSong.id !== state.detailLyricSongId) return;
    const nextIndex = getActiveLyricIndex(state.detailLyricTimeline, currentTimeMs, state.detailLyricActiveIndex);
    if (nextIndex === state.detailLyricActiveIndex) return;
    if (state.detailLyricActiveIndex >= 0 && state.detailLyricRowEls[state.detailLyricActiveIndex]) {
      state.detailLyricRowEls[state.detailLyricActiveIndex].classList.remove('is-active');
    }
    state.detailLyricActiveIndex = nextIndex;
    if (nextIndex >= 0 && state.detailLyricRowEls[nextIndex]) {
      const activeEl = state.detailLyricRowEls[nextIndex];
      activeEl.classList.add('is-active');
      if (state.detailLyricScrollRafId) cancelAnimationFrame(state.detailLyricScrollRafId);
      state.detailLyricScrollRafId = requestAnimationFrame(() => {
        const containerHeight = detailLyricEl.clientHeight;
        const lineTop = activeEl.offsetTop;
        const lineHeight = activeEl.offsetHeight;
        const safeScrollTop = Math.max(0, lineTop - (containerHeight / 2) + (lineHeight / 2));
        if (Math.abs(safeScrollTop - state.detailLyricLastScrollTop) > 0.5) {
          detailLyricEl.scrollTo({
            top: safeScrollTop,
            behavior: 'smooth'
          });
          state.detailLyricLastScrollTop = safeScrollTop;
        }
        state.detailLyricScrollRafId = 0;
      });
    }
  }

  function updateCurrentTrackDisplay(song) {
    const trackText = toTrackText(song);
    if (nowTitleEl) nowTitleEl.textContent = trackText;
    if (trackMarqEl) trackMarqEl.textContent = `NOW PLAYING: ${trackText} | ALLMusic Glam Mode`;
    if (coverMarqEl) coverMarqEl.textContent = `${trackText} | Unified playback`;
    if (homeNowPlayingEl) homeNowPlayingEl.textContent = trackText;
  }

  function renderQuickStatus(authState) {
    if (!quickStatusLeftEl) {
      return;
    }
    const neteaseConnected = Boolean(authState && authState.users && authState.users.netease);
    const qqConnected = Boolean(authState && authState.users && authState.users.qq);

    quickStatusLeftEl.innerHTML = [
      `<button class="chip ${neteaseConnected ? 'ok' : 'warn'}" type="button" data-relogin="netease" title="点击重新登录 NetEase">NetEase: ${neteaseConnected ? 'Connected' : 'Offline'}</button>`,
      `<button class="chip ${qqConnected ? 'ok' : 'warn'}" type="button" data-relogin="qq" title="点击重新登录 QQ">QQ: ${qqConnected ? 'Connected' : 'Offline'}</button>`,
      '<span class="chip info pulse">Mode: Glam UX</span>',
    ].join('');
  }

  function renderLoginHints(authState) {
    const hasNetease = Boolean(authState && authState.users && authState.users.netease);
    const hasQQ = Boolean(authState && authState.users && authState.users.qq);
    const neteaseStatus = neteaseLoginStatusEl ? String(neteaseLoginStatusEl.textContent || '') : '';
    const qqStatus = qqLoginStatusEl ? String(qqLoginStatusEl.textContent || '') : '';

    if (hasNetease) {
      setLoginStatus(neteaseLoginStatusEl, '网易云已连接，可直接进入主页。');
    } else if (!/正在|失败/.test(neteaseStatus)) {
      setLoginStatus(neteaseLoginStatusEl, '仅支持网易云 App 扫码登录。');
    }

    if (hasQQ) {
      setLoginStatus(qqLoginStatusEl, 'QQ 音乐已连接，可直接进入主页。');
    } else if (!/正在|失败/.test(qqStatus)) {
      setLoginStatus(qqLoginStatusEl, '仅支持 QQ 音乐 App 扫码登录。');
    }
  }

  async function refreshAuthState() {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.getAuthState !== 'function') {
      renderQuickStatus(null);
      return null;
    }

    try {
      const authState = await bridge.getAuthState();
      renderQuickStatus(authState);
      renderLoginHints(authState);
      return authState;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Auth state read failed');
      return null;
    }
  }

  async function handleAuthLoginSuccess(platformLabel) {
    const authState = await refreshAuthState();
    if (authState && authState.hasConnectedAllPlatforms) {
      await loadPlaylists();
      go('home');
      setStatus('双平台已连接');
    }
    showToast(`${platformLabel} 登录成功`);
  }

  async function startNeteaseQrLogin() {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.neteaseQRCodeLogin !== 'function') {
      setLoginStatus(neteaseLoginStatusEl, '当前版本暂不支持网易云扫码，请切回 Classic UI。', true);
      return;
    }

    if (neteaseQrAbortController) {
      neteaseQrAbortController.abort();
    }
    const controller = new AbortController();
    neteaseQrAbortController = controller;

    renderQrImage(neteaseQrBoxEl, '');
    setLoginStatus(neteaseLoginStatusEl, '正在生成网易云二维码...');

    try {
      const result = await bridge.neteaseQRCodeLogin(
        (url) => {
          if (controller.signal.aborted) return;
          renderQrImage(neteaseQrBoxEl, url);
          setLoginStatus(neteaseLoginStatusEl, '请使用网易云音乐 App 扫码并确认登录');
        },
        (status) => {
          if (controller.signal.aborted) return;
          setLoginStatus(neteaseLoginStatusEl, status || '等待扫码中...');
        },
        controller.signal,
      );

      if (controller.signal.aborted) {
        return;
      }

      if (result && result.success) {
        setLoginStatus(neteaseLoginStatusEl, '网易云登录成功，正在同步...');
        await handleAuthLoginSuccess('网易云');
        return;
      }

      setLoginStatus(neteaseLoginStatusEl, (result && result.error) || '网易云登录失败，请重试。', true);
      showToast((result && result.error) || 'NetEase login failed');
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : '网易云扫码失败，请重试。';
        setLoginStatus(neteaseLoginStatusEl, message, true);
        showToast(message);
      }
    } finally {
      if (neteaseQrAbortController === controller) {
        neteaseQrAbortController = null;
      }
    }
  }

  async function startQQQrLogin() {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.qqQRCodeLogin !== 'function') {
      setLoginStatus(qqLoginStatusEl, '当前版本暂不支持 QQ 扫码，请切回 Classic UI。', true);
      return;
    }

    if (qqQrAbortController) {
      qqQrAbortController.abort();
    }
    const controller = new AbortController();
    qqQrAbortController = controller;

    renderQrImage(qqQrBoxEl, '');
    setLoginStatus(qqLoginStatusEl, '正在生成 QQ 二维码...');

    try {
      const result = await bridge.qqQRCodeLogin(
        (url) => {
          if (controller.signal.aborted) return;
          renderQrImage(qqQrBoxEl, url);
          setLoginStatus(qqLoginStatusEl, '请使用 QQ 音乐 App 扫码并确认登录');
        },
        (status) => {
          if (controller.signal.aborted) return;
          setLoginStatus(qqLoginStatusEl, status || '等待扫码中...');
        },
        controller.signal,
      );

      if (controller.signal.aborted) {
        return;
      }

      if (result && result.success) {
        setLoginStatus(qqLoginStatusEl, 'QQ 登录成功，正在同步...');
        await handleAuthLoginSuccess('QQ 音乐');
        return;
      }

      setLoginStatus(qqLoginStatusEl, (result && result.error) || 'QQ 登录失败，请重试。', true);
      showToast((result && result.error) || 'QQ login failed');
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : 'QQ 扫码失败，请重试。';
        setLoginStatus(qqLoginStatusEl, message, true);
        showToast(message);
      }
    } finally {
      if (qqQrAbortController === controller) {
        qqQrAbortController = null;
      }
    }
  }

  function buildPlaylistEntries(playlists) {
    const entries = Array.isArray(playlists)
      ? playlists.map((item) => ({ ...item, entryType: 'playlist' }))
      : [];

    entries.push({
      id: 'daily_merged',
      platform: 'merged',
      type: 'daily',
      name: 'Daily Mix',
      songCount: state.latestDailyCount,
      entryType: 'daily',
    });

    return entries;
  }

  function renderPlaylistList() {
    if (!playlistListEl) {
      return;
    }

    if (state.playlistEntries.length === 0) {
      playlistListEl.innerHTML = '<div class="hint" style="padding:8px;">No playlists available</div>';
      return;
    }

    playlistListEl.innerHTML = state.playlistEntries
      .map((entry) => {
        const active = entry.id === state.currentEntryId;
        return (
          `<button class="item clickable ${active ? 'active' : ''}" type="button" data-entry-id="${escapeHtml(entry.id)}">`
          + `<span>${platformShort(entry.platform)} ${escapeHtml(entry.name)}</span>`
          + `<span>${Number(entry.songCount || 0)} tracks</span>`
          + '</button>'
        );
      })
      .join('');

    playlistListEl.querySelectorAll('.item').forEach((buttonEl) => {
      buttonEl.addEventListener('click', () => {
        const entryId = buttonEl.getAttribute('data-entry-id') || '';
        void selectPlaylistEntry(entryId);
      });
    });
  }

  function updateSongDetail(song) {
    if (detailTrackEl) {
      detailTrackEl.textContent = toTrackText(song);
    }
    if (detailPlatformEl) {
      detailPlatformEl.textContent = `Platform: ${platformLabel(song ? song.platform : 'merged')}`;
    }
    if (detailAlbumEl) {
      detailAlbumEl.textContent = `Album: ${song && song.album ? song.album : 'Unknown Album'}`;
    }
    if (likeSelectedEl) {
      if (!song) {
        likeSelectedEl.textContent = '♡ 收藏';
        likeSelectedEl.disabled = true;
        return;
      }
      likeSelectedEl.disabled = false;
      likeSelectedEl.textContent = song.isLiked ? '♥ 已收藏' : '♡ 收藏';
    }
  }

  async function refreshLyricPreview(song) {
    state.lyricRequestToken += 1;
    const requestToken = state.lyricRequestToken;

    if (!song) {
      buildDetailLyricView(null, null);
      return;
    }

    const lyricEntry = await ensureLyricsLoaded(song);
    if (requestToken !== state.lyricRequestToken) {
      return;
    }

    if (!lyricEntry) {
      buildDetailLyricView(null, null);
      return;
    }

    buildDetailLyricView(song, lyricEntry);
  }

  function selectSongByIndex(index) {
    if (index < 0 || index >= state.visibleSongs.length) {
      return;
    }

    state.selectedSongIndex = index;
    const song = state.visibleSongs[index];
    updateSongDetail(song);
    void refreshLyricPreview(song);

    if (songTbodyEl) {
      songTbodyEl.querySelectorAll('tr').forEach((row, rowIndex) => {
        row.classList.toggle('selected', rowIndex === index);
      });
    }
  }

  function renderSongTable() {
    if (!songTbodyEl) {
      return;
    }

    if (state.visibleSongs.length === 0) {
      songTbodyEl.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#666">No tracks</td></tr>';
      if (homeResultCountEl) {
        homeResultCountEl.textContent = 'Results: 0';
      }
      state.selectedSongIndex = -1;
      updateSongDetail(null);
      refreshLyricPreview(null);
      return;
    }

    songTbodyEl.innerHTML = state.visibleSongs
      .map((song, index) => {
        const selected = index === state.selectedSongIndex;
        const likedFlag = song.isLiked ? '[LIKED]' : '';
        return (
          `<tr data-song-index="${index}" data-song-id="${escapeHtml(song.id || '')}" class="${selected ? 'selected' : ''}">`
          + `<td>${escapeHtml(song.name || 'Unknown Track')}</td>`
          + `<td>${escapeHtml(song.artist || 'Unknown Artist')}</td>`
          + `<td><span class="badge ${platformBadgeClass(song.platform)}">${escapeHtml(platformLabel(song.platform))}</span></td>`
          + `<td>${formatDurationMs(song.duration || 0)}</td>`
          + `<td><button class="win-btn play-now" type="button" data-play-index="${index}">PLAY ${likedFlag}</button></td>`
          + '</tr>'
        );
      })
      .join('');

    if (homeResultCountEl) {
      homeResultCountEl.textContent = `Results: ${state.visibleSongs.length}`;
    }

    songTbodyEl.querySelectorAll('tr').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target && event.target.closest('button')) {
          return;
        }
        const idx = Number(row.getAttribute('data-song-index') || '-1');
        selectSongByIndex(idx);
      });

      row.addEventListener('dblclick', () => {
        const idx = Number(row.getAttribute('data-song-index') || '-1');
        void playSongByIndex(idx);
      });
    });

    songTbodyEl.querySelectorAll('.play-now').forEach((buttonEl) => {
      buttonEl.addEventListener('click', () => {
        const idx = Number(buttonEl.getAttribute('data-play-index') || '-1');
        void playSongByIndex(idx);
      });
    });

    if (state.selectedSongIndex < 0 || state.selectedSongIndex >= state.visibleSongs.length) {
      selectSongByIndex(0);
    } else {
      selectSongByIndex(state.selectedSongIndex);
    }
  }

  function applyPlatformFilter() {
    const filterValue = platformFilterEl ? platformFilterEl.value : 'all';
    if (filterValue === 'all') {
      state.visibleSongs = state.allSongs.slice();
    } else {
      state.visibleSongs = state.allSongs.filter((song) => song.platform === filterValue);
    }
    renderSongTable();
  }

  async function selectPlaylistEntry(entryId, options) {
    const silent = Boolean(options && options.silent);
    const forceRefresh = Boolean(options && options.forceRefresh);
    const bridge = resolveBridge();
    if (!bridge) {
      if (!silent) {
        showToast('Bridge not ready');
      }
      return;
    }

    const entry = state.playlistEntries.find((item) => item.id === entryId);
    if (!entry) {
      return;
    }

    state.currentEntryId = entry.id;
    renderPlaylistList();
    if (!silent) {
      setStatus(`Loading: ${entry.name}`);
    }

    try {
      let nextSongs = [];
      let warning = '';

      if (entry.entryType === 'daily') {
        const daily = await bridge.loadDailyRecommendations({ limit: 30, forceRefresh });
        nextSongs = Array.isArray(daily && daily.songs) ? daily.songs : [];
        state.latestDailyCount = nextSongs.length;
        warning = Array.isArray(daily && daily.warnings) ? daily.warnings[0] || '' : '';
      } else {
        const detail = await bridge.loadPlaylistDetail(entry, { silent, forceRefresh });
        nextSongs = Array.isArray(detail && detail.songs) ? detail.songs : [];
        warning = detail && detail.warning ? String(detail.warning) : '';
      }

      state.allSongs = nextSongs;
      applyPlatformFilter();
      renderPlaylistList();
      if (!silent) {
        setStatus(`Loaded: ${entry.name}`);
        showToast(`Loaded ${entry.name} (${nextSongs.length})`);
      }
      if (warning && !silent) {
        showToast(warning);
      }
    } catch (error) {
      state.allSongs = [];
      state.visibleSongs = [];
      renderSongTable();
      if (!silent) {
        setStatus('Load failed');
        showToast(error instanceof Error ? error.message : 'Playlist load failed');
      } else {
        console.warn('[ALLMusic][V4] playlist detail silent refresh failed:', error);
      }
    }
  }

  async function loadPlaylists(options) {
    const silent = Boolean(options && options.silent);
    const forceRefresh = Boolean(options && options.forceRefresh);
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.loadPlaylists !== 'function') {
      return;
    }

    try {
      if (!silent) {
        setStatus('Loading playlists');
      }
      const result = await bridge.loadPlaylists({ silent, forceRefresh });
      state.playlistEntries = buildPlaylistEntries(result && result.playlists);
      renderPlaylistList();

      if (!silent && result && Array.isArray(result.warnings) && result.warnings[0]) {
        showToast(result.warnings[0]);
      }

      const selected = state.playlistEntries.find((entry) => entry.id === state.currentEntryId);
      const merged = state.playlistEntries.find((entry) => entry.id === 'merged_liked');
      const first = selected || merged || state.playlistEntries[0];
      if (first) {
        await selectPlaylistEntry(first.id, { silent, forceRefresh });
      } else {
        state.allSongs = [];
        state.visibleSongs = [];
        renderSongTable();
      }
    } catch (error) {
      if (!silent) {
        setStatus('Playlist load failed');
        showToast(error instanceof Error ? error.message : 'Playlist load failed');
      } else {
        console.warn('[ALLMusic][V4] playlists silent refresh failed:', error);
      }
    }
  }

  async function handleBridgeCacheUpdated(payload) {
    if (!payload || payload.type !== BRIDGE_CACHE_UPDATED_EVENT) {
      return;
    }

    const now = Date.now();
    if (now - state.lastBridgeCacheRefreshAt < 400) {
      return;
    }
    state.lastBridgeCacheRefreshAt = now;

    if (payload.resource === 'playlists') {
      if (!state.currentEntryId) {
        return;
      }
      await loadPlaylists({ silent: true });
      return;
    }

    if (payload.resource === 'playlist-detail' || payload.resource === 'daily-recommend') {
      if (state.currentEntryId) {
        await selectPlaylistEntry(state.currentEntryId, { silent: true });
      }
    }
  }

  async function doSearch() {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.searchSongs !== 'function') {
      showToast('Bridge not ready');
      return;
    }

    const keyword = searchInputEl ? searchInputEl.value.trim() : '';
    if (!keyword) {
      showToast('Please type a keyword');
      return;
    }

    setStatus(`Searching: ${keyword}`);
    try {
      const result = await bridge.searchSongs(keyword, 60);
      state.currentEntryId = '';
      state.allSongs = Array.isArray(result && result.songs) ? result.songs : [];
      applyPlatformFilter();
      renderPlaylistList();
      showToast(`Search complete: ${keyword}`);
      setStatus(`Results: ${state.allSongs.length}`);

      if (result && Array.isArray(result.warnings) && result.warnings[0]) {
        showToast(result.warnings[0]);
      }
    } catch (error) {
      setStatus('Search failed');
      showToast(error instanceof Error ? error.message : 'Search failed');
    }
  }

  async function playSongByIndex(index) {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.playSongs !== 'function') {
      showToast('Bridge not ready');
      return;
    }

    if (index < 0 || index >= state.visibleSongs.length) {
      return;
    }

    const songs = state.visibleSongs;
    const song = songs[index];

    await bridge.playSongs(songs, index);
    selectSongByIndex(index);
    updateCurrentTrackDisplay(song);
    go('player');
    showToast(`Playing: ${toTrackText(song)}`);
    await syncPlayerState();
  }

  function renderQueue(queue, currentIndex) {
    if (!queueListEl) {
      return;
    }

    const list = Array.isArray(queue) ? queue : [];
    if (queueCountEl) {
      queueCountEl.textContent = `Queue ${list.length}`;
    }

    if (list.length === 0) {
      queueListEl.innerHTML = '<div class="hint" style="padding:8px;">Queue is empty</div>';
      return;
    }

    queueListEl.innerHTML = list
      .map((song, index) => {
        const active = index === currentIndex;
        return (
          `<button class="item clickable ${active ? 'active' : ''}" type="button" data-queue-index="${index}">`
          + `<span>${escapeHtml(`${index + 1}. ${toTrackText(song)}`)}</span>`
          + `<span>${active ? 'NOW' : 'NEXT'}</span>`
          + '</button>'
        );
      })
      .join('');

    queueListEl.querySelectorAll('.item').forEach((itemEl) => {
      itemEl.addEventListener('click', async () => {
        const bridge = resolveBridge();
        if (!bridge || typeof bridge.playAt !== 'function') {
          return;
        }
        const idx = Number(itemEl.getAttribute('data-queue-index') || '-1');
        if (idx >= 0) {
          await bridge.playAt(idx);
          await syncPlayerState();
        }
      });
    });
  }

  function updatePlayStateUI(isPlaying, isLoading) {
    const playing = Boolean(isPlaying);
    const loading = Boolean(isLoading);

    const text = loading ? '...' : playing ? 'PAUSE' : 'PLAY';
    if (togglePlayEl) {
      togglePlayEl.textContent = text;
    }
    if (homePlayToggleEl) {
      homePlayToggleEl.textContent = text;
    }
    if (playStateChipEl) {
      playStateChipEl.textContent = loading ? 'State: Buffering' : playing ? 'State: Playing' : 'State: Paused';
    }
    if (cdDiscEl) {
      cdDiscEl.classList.toggle('spinning', playing);
    }
  }

  function updatePlayModeUI(mode) {
    const modeMap = {
      sequential: { icon: '➡️', title: '顺序播放' },
      loop: { icon: '🔁', title: '列表循环' },
      shuffle: { icon: '🔀', title: '随机播放' },
      'loop-one': { icon: '🔂', title: '单曲循环' },
    };
    const info = modeMap[mode] || modeMap.sequential;
    if (homePlayModeEl) {
      homePlayModeEl.textContent = info.icon;
      homePlayModeEl.title = info.title;
    }
    if (playerPlayModeEl) {
      playerPlayModeEl.textContent = info.icon;
      playerPlayModeEl.title = info.title;
    }
  }

  async function cyclePlayMode() {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.setPlayMode !== 'function') {
      return;
    }

    const modes = ['sequential', 'loop', 'shuffle', 'loop-one'];
    const currentIdx = modes.indexOf(state.playMode);
    const nextMode = modes[(currentIdx + 1) % modes.length];

    try {
      await bridge.setPlayMode(nextMode);
      state.playMode = nextMode;
      updatePlayModeUI(nextMode);
      showToast(`播放模式: ${nextMode.toUpperCase()}`);
    } catch (error) {
      console.error('[V4 Glam] set play mode failed:', error);
    }
  }

  function syncProgress(currentMs, durationMs) {
    const totalMs = Math.max(0, Number(durationMs) || 0);
    const safeCurrentMs = Math.max(0, Math.min(totalMs || Number.MAX_SAFE_INTEGER, Number(currentMs) || 0));
    const totalSec = Math.max(1, Math.floor(totalMs / 1000));
    const currentSec = Math.max(0, Math.floor(safeCurrentMs / 1000));

    if (progressEl) {
      progressEl.max = String(totalSec);
      progressEl.value = String(Math.min(currentSec, totalSec));
    }
    if (homeProgressEl) {
      homeProgressEl.max = String(totalSec);
      homeProgressEl.value = String(Math.min(currentSec, totalSec));
    }

    if (currentTimeEl) currentTimeEl.textContent = formatDurationMs(safeCurrentMs);
    if (totalTimeEl) totalTimeEl.textContent = formatDurationMs(totalMs);
    if (homeCurrentTimeEl) homeCurrentTimeEl.textContent = formatDurationMs(safeCurrentMs);
    if (homeTotalTimeEl) homeTotalTimeEl.textContent = formatDurationMs(totalMs);
  }

  function syncSelectedSongByCurrentSong(currentSong) {
    if (!currentSong || state.visibleSongs.length === 0) {
      return;
    }
    const index = state.visibleSongs.findIndex((song) => song.id === currentSong.id);
    if (index >= 0 && index !== state.selectedSongIndex) {
      selectSongByIndex(index);
    }
  }

  async function syncPlayerState() {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.getPlayerState !== 'function' || state.syncingPlayer) {
      return;
    }

    state.syncingPlayer = true;
    try {
      const playerState = await bridge.getPlayerState();
      const currentSong = playerState && playerState.currentSong ? playerState.currentSong : null;
      const currentTimeMs = Number(playerState && playerState.currentTime) || 0;
      state.currentPlayerSong = currentSong;
      state.currentPlayerTimeMs = currentTimeMs;
      updateCurrentTrackDisplay(currentSong);
      updateDiscCenterCover(currentSong);
      renderPlayerLyrics(currentSong, currentTimeMs);
      if (currentSong && !state.lyricCache[currentSong.id]) {
        void ensureLyricsLoaded(currentSong).then(() => {
          if (state.currentPlayerSong && state.currentPlayerSong.id === currentSong.id) {
            renderPlayerLyrics(currentSong, state.currentPlayerTimeMs);
          }
        });
      }

      updatePlayStateUI(playerState && playerState.isPlaying, playerState && playerState.isLoading);
      syncProgress(playerState && playerState.currentTime, playerState && playerState.duration);
      renderQueue(playerState && playerState.queue, playerState && playerState.currentIndex);
      syncDetailLyricByTime(currentSong, currentTimeMs);
      syncSelectedSongByCurrentSong(currentSong);

      if (playerState && playerState.playMode && playerState.playMode !== state.playMode) {
        state.playMode = playerState.playMode;
        updatePlayModeUI(state.playMode);
      }

      if (volumeEl) {
        const volumePercent = Math.round((Number(playerState && playerState.volume) || 0) * 100);
        volumeEl.value = String(volumePercent);
        if (volumeLabelEl) {
          volumeLabelEl.textContent = `${volumePercent}%`;
        }
        if (homeVolumeEl) {
          homeVolumeEl.value = String(volumePercent);
        }
        if (homeVolumeLabelEl) {
          homeVolumeLabelEl.textContent = `${volumePercent}%`;
        }
      }
    } catch (error) {
      console.error('[V4 Glam] sync player failed:', error);
    } finally {
      state.syncingPlayer = false;
    }
  }

  async function likeSelectedSong() {
    const bridge = resolveBridge();
    if (!bridge || typeof bridge.likeSong !== 'function') {
      showToast('Like API is not available');
      return;
    }

    const selectedSong = state.visibleSongs[state.selectedSongIndex];
    if (!selectedSong) {
      showToast('Select one track first');
      return;
    }

    try {
      const nextLikeState = !selectedSong.isLiked;
      const result = await bridge.likeSong(selectedSong, nextLikeState);
      if (result && result.success) {
        selectedSong.isLiked = nextLikeState;
        renderSongTable();
        selectSongByIndex(state.selectedSongIndex);
        showToast(`${nextLikeState ? 'Liked' : 'Unliked'}: ${selectedSong.name}`);
      } else {
        showToast((result && result.warning) || 'Like failed');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Like failed');
    }
  }

  async function ensureConnectedOrGuide(authState) {
    if (authState && authState.hasConnectedAllPlatforms) {
      go('home');
      await loadPlaylists();
      return true;
    }

    go('login');
    showToast('请先在本页完成网易云与 QQ 登录');
    return false;
  }

  function bindEvents() {
    if (searchBtnEl) {
      searchBtnEl.addEventListener('click', () => {
        void doSearch();
      });
    }

    if (searchInputEl) {
      searchInputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          void doSearch();
        }
      });
    }

    if (searchInputEl) {
      searchInputEl.addEventListener('search', () => {
        if (searchInputEl.value.trim()) {
          return;
        }
        if (state.currentEntryId) {
          void selectPlaylistEntry(state.currentEntryId);
        } else {
          state.allSongs = [];
          state.visibleSongs = [];
          renderSongTable();
        }
        showToast('Search cleared');
      });
    }

    if (platformFilterEl) {
      platformFilterEl.addEventListener('change', () => {
        applyPlatformFilter();
      });
    }

    if (playSelectedEl) {
      playSelectedEl.addEventListener('click', () => {
        const idx = state.selectedSongIndex >= 0 ? state.selectedSongIndex : 0;
        void playSongByIndex(idx);
      });
    }

    if (likeSelectedEl) {
      likeSelectedEl.addEventListener('click', () => {
        void likeSelectedSong();
      });
    }

    if (neteaseRefreshQrEl) {
      neteaseRefreshQrEl.addEventListener('click', () => {
        void startNeteaseQrLogin();
      });
    }

    if (qqStartQrEl) {
      qqStartQrEl.addEventListener('click', () => {
        void startQQQrLogin();
      });
    }

    if (openUiSwitcherEl) {
      openUiSwitcherEl.addEventListener('click', async () => {
        showToast('Opening theme center...');
        await requestOpenUiSwitcher();
      });
    }

    if (quickStatusLeftEl) {
      quickStatusLeftEl.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const reloginButton = target.closest('[data-relogin]');
        if (!(reloginButton instanceof HTMLElement)) {
          return;
        }
        const platform = reloginButton.getAttribute('data-relogin') || 'platform';
        go('login');
        setStatus('已切换到登录页，请重新授权。');
        showToast(`Re-login ${platform.toUpperCase()} in Login tab`);
      });
    }

    if (connectAllEl) {
      connectAllEl.addEventListener('click', async () => {
        const auth = await refreshAuthState();
        const connected = await ensureConnectedOrGuide(auth);
        if (connected) {
          showToast('Connected and ready');
          return;
        }
        setStatus('等待登录授权');
        setLoginStatus(neteaseLoginStatusEl, '建议先点击“刷新二维码”开始网易云扫码');
        setLoginStatus(qqLoginStatusEl, '建议先点击“生成 / 刷新二维码”开始 QQ 音乐扫码');
      });
    }

    if (togglePlayEl) {
      togglePlayEl.addEventListener('click', async () => {
        const bridge = resolveBridge();
        if (!bridge || typeof bridge.togglePlay !== 'function') {
          return;
        }
        await bridge.togglePlay();
        await syncPlayerState();
      });
    }

    if (homePlayToggleEl) {
      homePlayToggleEl.addEventListener('click', async () => {
        const bridge = resolveBridge();
        if (!bridge || typeof bridge.togglePlay !== 'function') {
          return;
        }
        await bridge.togglePlay();
        await syncPlayerState();
      });
    }

    if (homePrevEl) {
      homePrevEl.addEventListener('click', async () => {
        const bridge = resolveBridge();
        if (!bridge || typeof bridge.playPrevious !== 'function') {
          return;
        }
        await bridge.playPrevious();
        await syncPlayerState();
      });
    }

    if (homeNextEl) {
      homeNextEl.addEventListener('click', async () => {
        const bridge = resolveBridge();
        if (!bridge || typeof bridge.playNext !== 'function') {
          return;
        }
        await bridge.playNext();
        await syncPlayerState();
      });
    }

    if (homePlayModeEl) {
      homePlayModeEl.addEventListener('click', () => {
        void cyclePlayMode();
      });
    }

    if (playerPlayModeEl) {
      playerPlayModeEl.addEventListener('click', () => {
        void cyclePlayMode();
      });
    }

    const playerPrevEl = document.getElementById('player-prev');
    const playerNextEl = document.getElementById('player-next');

    if (playerPrevEl) {
      playerPrevEl.addEventListener('click', async () => {
        const bridge = resolveBridge();
        if (!bridge || typeof bridge.playPrevious !== 'function') {
          return;
        }
        await bridge.playPrevious();
        await syncPlayerState();
      });
    }

    if (playerNextEl) {
      playerNextEl.addEventListener('click', async () => {
        const bridge = resolveBridge();
        if (!bridge || typeof bridge.playNext !== 'function') {
          return;
        }
        await bridge.playNext();
        await syncPlayerState();
      });
    }

    lyricModeButtonEls.forEach((buttonEl) => {
      buttonEl.addEventListener('click', () => {
        const mode = buttonEl.getAttribute('data-lyric-mode');
        if (mode !== 'original' && mode !== 'translated' && mode !== 'both') {
          return;
        }
        state.lyricMode = mode;
        updateLyricModeButtons();
        renderPlayerLyrics(state.currentPlayerSong, state.currentPlayerTimeMs);
      });
    });
    updateLyricModeButtons();

    function bindSeekInput(inputEl) {
      if (!inputEl) {
        return;
      }
      inputEl.addEventListener('change', async () => {
        const bridge = resolveBridge();
        if (!bridge || typeof bridge.seekTo !== 'function') {
          return;
        }
        const targetMs = (Number(inputEl.value) || 0) * 1000;
        await bridge.seekTo(targetMs);
        await syncPlayerState();
      });
    }
    bindSeekInput(progressEl);
    bindSeekInput(homeProgressEl);

    function bindVolumeInput(inputEl, labelEl) {
      if (!inputEl) {
        return;
      }
      inputEl.addEventListener('input', async () => {
        const bridge = resolveBridge();
        if (!bridge || typeof bridge.setVolume !== 'function') {
          return;
        }

        const value = Number(inputEl.value) || 0;
        if (labelEl) {
          labelEl.textContent = `${value}%`;
        }
        if (inputEl !== volumeEl && volumeEl) {
          volumeEl.value = String(value);
        }
        if (inputEl !== homeVolumeEl && homeVolumeEl) {
          homeVolumeEl.value = String(value);
        }
        if (labelEl !== volumeLabelEl && volumeLabelEl) {
          volumeLabelEl.textContent = `${value}%`;
        }
        if (labelEl !== homeVolumeLabelEl && homeVolumeLabelEl) {
          homeVolumeLabelEl.textContent = `${value}%`;
        }
        await bridge.setVolume(value);
      });
    }
    bindVolumeInput(volumeEl, volumeLabelEl);
    bindVolumeInput(homeVolumeEl, homeVolumeLabelEl);

    if (toggleDiscoEl) {
      toggleDiscoEl.addEventListener('click', () => {
        document.body.classList.toggle('disco');
        showToast(document.body.classList.contains('disco') ? 'Disco mode ON' : 'Disco mode OFF');
      });
    }

    window.addEventListener('keydown', (event) => {
      if (event.key === '1') go('login');
      if (event.key === '2') go('home');
      if (event.key === '3') go('player');

      if (event.code === 'Space' && pages.player && pages.player.classList.contains('active')) {
        const bridge = resolveBridge();
        if (bridge && typeof bridge.togglePlay === 'function') {
          event.preventDefault();
          void bridge.togglePlay().then(syncPlayerState);
        }
      }
    });

    window.addEventListener('message', (event) => {
      if (window.parent && event.source !== window.parent) {
        return;
      }
      const payload = event.data;
      if (!payload || typeof payload !== 'object') {
        return;
      }
      if (payload.type === LOCAL_API_READY_EVENT) {
        const now = Date.now();
        if (now - state.lastLocalApiReadyAt < 1500) {
          return;
        }
        state.lastLocalApiReadyAt = now;

        setStatus('Local APIs ready, refreshing playlists');
        showToast('Local APIs ready, refreshing');
        void loadPlaylists({ forceRefresh: true });
        void syncPlayerState();
        return;
      }

      if (payload.type === 'allmusic:auth-invalidated') {
        const platform = payload.platform === 'qq' ? 'QQ 音乐' : '网易云';
        const message = `${platform}登录已失效，请重新扫码登录。`;
        go('login');
        setStatus(message);
        setLoginStatus(payload.platform === 'qq' ? qqLoginStatusEl : neteaseLoginStatusEl, message, true);
        showToast(message);
        void refreshAuthState();
        return;
      }

      if (payload.type === BRIDGE_CACHE_UPDATED_EVENT) {
        void handleBridgeCacheUpdated(payload);
      }
    });

    window.addEventListener(BRIDGE_CACHE_UPDATED_EVENT, (event) => {
      if (event instanceof CustomEvent) {
        void handleBridgeCacheUpdated(event.detail);
      }
    });
  }

  function updateClock() {
    const now = new Date();
    const text = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (clockEl) clockEl.textContent = text;
    if (trayTimeEl) trayTimeEl.textContent = text;
  }

  async function init() {
    bindTabEvents();
    bindEvents();
    if (searchInputEl) {
      searchInputEl.value = '';
    }
    if (platformFilterEl) {
      platformFilterEl.value = 'all';
    }
    updatePlayModeUI(state.playMode);
    go('home');
    updateClock();
    setInterval(updateClock, 1000);

    const bridgeReady = await waitForBridge(BRIDGE_WAIT_TIMEOUT);
    if (!bridgeReady) {
      setStatus('Bridge missing (prototype only)');
      showToast('Bridge unavailable, please refresh later');
      return;
    }

    const authState = await refreshAuthState();
    const connected = await ensureConnectedOrGuide(authState);
    if (connected) {
      await syncPlayerState();
    }

    setInterval(() => {
      void syncPlayerState();
    }, PLAYER_SYNC_INTERVAL);

    setInterval(() => {
      void refreshAuthState();
    }, AUTH_SYNC_INTERVAL);
  }

  void init();
})();
