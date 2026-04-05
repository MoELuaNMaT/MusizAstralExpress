import type { UnifiedPlaylist } from '@/types';
import neteasePlatformIcon from '@/assets/platforms/netease.ico';
import qqPlatformIcon from '@/assets/platforms/qq.ico';

export type NeteaseLikedOrder = 'latest' | 'earliest' | 'api';
export type SearchPlatformFilter = 'all' | 'netease' | 'qq';
export type PanelTab = 'playlists' | 'daily' | 'history';
export type DailySourceTab = 'merged' | 'netease' | 'qq';

export const DEFAULT_AVATAR = 'https://p.qlogo.cn/gh/0/0/100';
export const NETEASE_LIKED_ORDER_STORAGE_KEY = 'allmusic_netease_liked_order_v1';
export const LOCAL_API_READY_EVENT = 'allmusic:local-api-ready';
export const ANDROID_BACK_PRESS_EVENT = 'allmusic:android-back-press';
export const SEARCH_RESULT_ESTIMATED_ROW_HEIGHT = 80;
export const SONG_ROW_ESTIMATED_HEIGHT = 96;
export const PLAYLIST_DETAIL_ESTIMATED_ROW_HEIGHT = 96;
export const INITIAL_PLAYLIST_BOOTSTRAP_TIMEOUT_MS = 20_000;
export const INITIAL_PLAYLIST_BOOTSTRAP_RETRY_DELAY_MS = 1_200;

export const text = {
  title: 'ALLMusic',
  subtitle: '双平台资源整合（歌单 + 搜索）',
  loading: '正在加载...',
  loginRequired: '请先完成双平台登录后再进入整合页。',
  backToLogin: '返回登录页',
  refresh: '刷新数据',
  logout: '退出',
  connected: '已连接',
  disconnected: '未连接',
  neteaseConnected: '网易云已连接',
  qqConnected: 'QQ 音乐已连接',
  cardNetease: '网易云音乐',
  cardQQ: 'QQ 音乐',
  cardPlaylists: '已整合歌单',
  connectedCount: '已连接平台',
  searchTitle: '统一搜索',
  searchDescription: '同一个关键词同时搜索网易云与 QQ 音乐。',
  searchPlaceholder: '输入歌曲名 / 歌手名，例如：晴天',
  searchBtn: '开始搜索',
  searching: '搜索中',
  playlistsTitle: '整合歌单',
  playlistsDesc: '仅保留各平台我喜欢歌单；当双平台都可用时，新增双平台混合歌单。',
  panelTabPlaylists: '整合歌单',
  panelTabDaily: '每日推荐',
  panelTabHistory: '播放历史',
  historyTitle: '播放历史',
  historyDesc: '最近播放的 100 首歌曲，支持快速找回与继续播放。',
  clearHistory: '清空历史',
  noHistorySongs: '暂无播放历史，先播放一首歌试试。',
  authStatusExpired: '登录状态可能已过期，请重新扫码登录。',
  authStatusRenewFailed: '网易云登录续期失败，建议尽快重新扫码避免失效。',
  dailySourceMerged: '双平台推荐',
  dailySourceNetease: '网易云推荐',
  dailySourceQQ: 'QQ 音乐推荐',
  noDailySongsInSource: '当前推荐源暂无歌曲。',
  loadingPlaylists: '正在加载歌单...',
  bootstrappingPlaylists: '正在等待双平台首批歌单同步...',
  bootstrappingPlaylistsHint: '首次启动将等待网易云与 QQ 歌单都完成首批加载，再进入主界面。',
  noPlaylists: '暂无可展示歌单。',
  unknownCreator: '未知创建者',
  songsUnit: '首',
  detailHint: '点击上方任意歌单，查看歌曲列表。',
  neteaseRebuildWebOrder: '重抓网页顺序',
  neteaseLikedOrderLabel: '网易云我喜欢排序',
  neteaseLikedOrderLatest: '最新优先',
  neteaseLikedOrderEarliest: '最早优先',
  neteaseLikedOrderApi: 'API 原序',
  noSelectedPlaylist: '未选择歌单。',
  loadingDetail: '正在加载歌单详情...',
  noSongsInPlaylist: '该歌单暂无歌曲。',
  searchResultsTitle: '搜索结果',
  searchResultsDesc: '当前最多展示 30 条，按平台交错排序。',
  searchFilterAll: '全部',
  searchFilterNetease: '仅网易云',
  searchFilterQQ: '仅 QQ',
  searchSuggestionTitle: '搜索建议',
  searchHistoryTitle: '搜索历史',
  clearSearchHistory: '清空搜索历史',
  noFilteredSearchResults: '当前筛选条件下暂无歌曲。',
  dailyTitle: '每日推荐',
  dailyDesc: '仅聚合网易云与 QQ 的个性化推荐。',
  dailyRefresh: '刷新推荐',
  loadingDaily: '正在加载推荐...',
  noDailySongs: '暂无推荐歌曲。',
  loadingSearchResults: '正在加载搜索结果...',
  noSearchResults: '请在上方输入关键词后搜索。',
  unknownArtist: '未知歌手',
  unknownAlbum: '未知专辑',
  enterKeyword: '请先输入搜索关键词。',
  noSongMatched: '未搜索到匹配歌曲。',
  likeSong: '\u7ea2\u5fc3\u6536\u85cf',
  likedSong: '\u5df2\u52a0\u5165\u6211\u559c\u6b22',
  likingSong: '\u5904\u7406\u4e2d...',
  playSong: '播放',
  pauseSong: '暂停',
} as const;

export const platformNameMap: Record<'netease' | 'qq' | 'merged', string> = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  merged: '双平台混合',
};

export const playlistTypeNameMap: Record<UnifiedPlaylist['type'], string> = {
  liked: '我喜欢',
  created: '我创建的',
  collected: '我收藏的',
};

export const platformBadgeStyleMap: Record<'netease' | 'qq' | 'merged', string> = {
  netease: 'bg-red-500/20 text-red-300 border-red-500/40',
  qq: 'bg-green-500/20 text-green-300 border-green-500/40',
  merged: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
};

export const platformIconUrlMap: Record<'netease' | 'qq', string> = {
  netease: neteasePlatformIcon,
  qq: qqPlatformIcon,
};

export const songSourceLabelMap: Record<'netease' | 'qq' | 'merged', string> = {
  netease: 'NODE:NETEASE',
  qq: 'NODE:QQ_MUSIC',
  merged: 'NODE:MERGED',
};

export const genericNicknamePatterns = [
  /^qq\s*音乐用户$/i,
  /^netease\s*user$/i,
  /^网易云用户$/i,
];
