const tabs = [...document.querySelectorAll('.top-tabs .win-btn')];
    const pages = {
      login: document.getElementById('page-login'),
      home: document.getElementById('page-home'),
      player: document.getElementById('page-player')
    };

    const toast = document.getElementById('toast');
    let toastTimer = null;

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('show');
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
    }

    function go(pageKey) {
      tabs.forEach((btn) => btn.classList.toggle('active-tab', btn.dataset.page === pageKey));
      Object.entries(pages).forEach(([key, el]) => el.classList.toggle('active', key === pageKey));
    }

    tabs.forEach((btn) => btn.addEventListener('click', () => go(btn.dataset.page)));

    const nowTitle = document.getElementById('now-title');
    const detailTrack = document.getElementById('detail-track');
    const detailPlatform = document.getElementById('detail-platform');
    const homeResultCount = document.getElementById('home-result-count');
    const trackMarq = document.getElementById('track-marq');
    const coverMarq = document.getElementById('cover-marq');
    const homeNowPlaying = document.getElementById('home-nowplaying');
    const homePlayToggle = document.getElementById('home-play-toggle');
    const homeProgress = document.getElementById('home-progress');
    const homeCurrentTime = document.getElementById('home-current-time');
    const homeTotalTime = document.getElementById('home-total-time');
    const tbody = document.getElementById('song-tbody');
    const rows = [...tbody.querySelectorAll('tr')];

    function setCurrentTrack(track) {
      nowTitle.textContent = track;
      if (trackMarq) {
        trackMarq.textContent = `NOW PLAYING: ${track} · ALLMusic Glam Mode`;
      }
      if (coverMarq) {
        coverMarq.textContent = `${track} · 双平台聚合播放中`;
      }
      if (homeNowPlaying) {
        homeNowPlaying.textContent = track;
      }
    }

    function selectRow(row) {
      rows.forEach((r) => r.classList.remove('selected'));
      row.classList.add('selected');
      const track = row.dataset.track || '未知歌曲';
      const platform = row.dataset.platform || 'all';
      detailTrack.textContent = track;
      detailPlatform.textContent = platform === 'qq' ? '平台: QQ' : '平台: 网易云';
    }

    rows.forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        selectRow(row);
      });

      const playBtn = row.querySelector('.play-now');
      playBtn.addEventListener('click', () => {
        const track = row.dataset.track || '未知歌曲';
        setCurrentTrack(track);
        selectRow(row);
        go('player');
        showToast(`正在播放: ${track}`);
      });
    });

    if (rows[0]) {
      selectRow(rows[0]);
      setCurrentTrack(rows[0].dataset.track || '未知歌曲');
    }

    document.getElementById('search-btn').addEventListener('click', () => {
      const kw = document.getElementById('search-input').value.trim();
      showToast(kw ? `已搜索关键词: ${kw}` : '请输入关键词');
    });

    document.getElementById('clear-btn').addEventListener('click', () => {
      document.getElementById('search-input').value = '';
      showToast('已清空搜索词');
    });

    document.getElementById('platform-filter').addEventListener('change', (e) => {
      const v = e.target.value;
      let count = 0;
      rows.forEach((row) => {
        const ok = v === 'all' || row.dataset.platform === v;
        row.style.display = ok ? '' : 'none';
        if (ok) count += 1;
      });
      homeResultCount.textContent = `结果: ${count} 首`;
      showToast(`已切换筛选: ${e.target.options[e.target.selectedIndex].text}`);
    });

    document.getElementById('play-selected').addEventListener('click', () => {
      const current = tbody.querySelector('tr.selected') || rows[0];
      if (!current) return;
      const track = current.dataset.track || '未知歌曲';
      setCurrentTrack(track);
      go('player');
      showToast(`播放所选: ${track}`);
    });

    document.getElementById('batch-like').addEventListener('click', () => showToast('已加入批量收藏队列'));
    document.getElementById('connect-all').addEventListener('click', () => showToast('双平台连接流程已启动'));

    const queueItems = [...document.querySelectorAll('#queue-list .item')];
    queueItems.forEach((item) => {
      item.addEventListener('click', () => {
        queueItems.forEach((x) => x.classList.remove('active'));
        item.classList.add('active');
        const track = item.dataset.track || '未知歌曲';
        setCurrentTrack(track);
        showToast(`已切换到: ${track}`);
      });
    });

    const togglePlay = document.getElementById('toggle-play');
    const playStateChip = document.getElementById('play-state-chip');
    const cd = document.getElementById('cd-disc');
    let isPlaying = true;

    function updatePlayState() {
      togglePlay.textContent = isPlaying ? '⏸' : '▶';
      if (homePlayToggle) {
        homePlayToggle.textContent = isPlaying ? '⏸' : '▶';
      }
      playStateChip.textContent = isPlaying ? '状态: 播放中' : '状态: 已暂停';
      cd.classList.toggle('spinning', isPlaying);
    }

    togglePlay.addEventListener('click', () => {
      isPlaying = !isPlaying;
      updatePlayState();
      showToast(isPlaying ? '继续播放' : '已暂停');
    });

    if (homePlayToggle) {
      homePlayToggle.addEventListener('click', () => {
        isPlaying = !isPlaying;
        updatePlayState();
        showToast(isPlaying ? '继续播放' : '已暂停');
      });
    }

    const homePrev = document.getElementById('home-prev');
    const homeNext = document.getElementById('home-next');
    if (homePrev) {
      homePrev.addEventListener('click', () => showToast('上一首（原型占位）'));
    }
    if (homeNext) {
      homeNext.addEventListener('click', () => showToast('下一首（原型占位）'));
    }

    const progress = document.getElementById('progress');
    const currentTime = document.getElementById('current-time');
    const totalTime = document.getElementById('total-time');

    function fmt(sec) {
      const s = Math.max(0, Number(sec) || 0);
      const m = Math.floor(s / 60);
      const r = Math.floor(s % 60);
      return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
    }

    function syncProgressLabels(seconds) {
      currentTime.textContent = fmt(seconds);
      if (homeCurrentTime) {
        homeCurrentTime.textContent = fmt(seconds);
      }
    }

    function syncProgressValue(seconds) {
      const normalized = Math.max(0, Math.min(Number(progress.max), Number(seconds) || 0));
      progress.value = String(normalized);
      if (homeProgress) {
        homeProgress.value = String(normalized);
      }
      syncProgressLabels(normalized);
    }

    totalTime.textContent = fmt(progress.max);
    if (homeTotalTime) {
      homeTotalTime.textContent = fmt(progress.max);
    }
    if (homeProgress) {
      homeProgress.max = progress.max;
    }
    syncProgressValue(progress.value);

    progress.addEventListener('input', () => {
      syncProgressValue(progress.value);
    });

    if (homeProgress) {
      homeProgress.addEventListener('input', () => {
        syncProgressValue(homeProgress.value);
      });
    }

    const volume = document.getElementById('volume');
    const volumeLabel = document.getElementById('volume-label');
    volume.addEventListener('input', () => {
      volumeLabel.textContent = `${volume.value}%`;
    });

    function updateClock() {
      const now = new Date();
      const text = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      document.getElementById('clock').textContent = text;
      document.getElementById('tray-time').textContent = text;
    }

    document.getElementById('toggle-disco').addEventListener('click', () => {
      document.body.classList.toggle('disco');
      showToast(document.body.classList.contains('disco') ? 'Disco 模式已开启' : 'Disco 模式已关闭');
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === '1') go('login');
      if (event.key === '2') go('home');
      if (event.key === '3') go('player');
      if (event.code === 'Space' && pages.player.classList.contains('active')) {
        event.preventDefault();
        isPlaying = !isPlaying;
        updatePlayState();
      }
    });

    updatePlayState();
    updateClock();
    setInterval(updateClock, 1000);
