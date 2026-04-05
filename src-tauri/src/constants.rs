pub(crate) const AUTH_STORE_FILE: &str = "auth_store.json";
pub(crate) const NETEASE_API_PORT: u16 = 3000;
pub(crate) const QQ_API_PORT: u16 = 3001;
pub(crate) const LOCAL_API_EVENT_NAME: &str = "local-api-progress";
pub(crate) const LOCAL_API_ENV_ERROR_PREFIX: &str = "LOCAL_API_ENVIRONMENT_MISSING::";
pub(crate) const NODEJS_INSTALL_URL: &str = "https://nodejs.org/zh-cn/download";
pub(crate) const PYTHON_INSTALL_URL: &str = "https://mirrors.aliyun.com/python-release/";
pub(crate) const NPM_REGISTRY_CN: &str = "https://registry.npmmirror.com";
pub(crate) const NPM_REGISTRY_DEFAULT: &str = "https://registry.npmjs.org";
#[cfg(target_os = "windows")]
pub(crate) const NPM_COMMAND: &str = "npm.cmd";
#[cfg(not(target_os = "windows"))]
pub(crate) const NPM_COMMAND: &str = "npm";
#[cfg(target_os = "windows")]
pub(crate) const WINGET_NODE_ID: &str = "OpenJS.NodeJS.LTS";
#[cfg(target_os = "windows")]
pub(crate) const WINGET_PYTHON_ID: &str = "Python.Python.3.11";
pub(crate) const COVER_CACHE_DIR: &str = "cover-cache";
pub(crate) const MEDIA_CONTROL_EVENT_NAME: &str = "allmusic:media-control";
#[cfg(desktop)]
pub(crate) const TRAY_ICON_ID: &str = "allmusic-tray-main";
#[cfg(desktop)]
pub(crate) const TRAY_MENU_TOGGLE_WINDOW: &str = "tray_toggle_window";
#[cfg(desktop)]
pub(crate) const TRAY_MENU_PLAY_PAUSE: &str = "tray_play_pause";
#[cfg(desktop)]
pub(crate) const TRAY_MENU_PREVIOUS: &str = "tray_previous";
#[cfg(desktop)]
pub(crate) const TRAY_MENU_NEXT: &str = "tray_next";
#[cfg(desktop)]
pub(crate) const TRAY_MENU_QUIT: &str = "tray_quit";
pub(crate) const COVER_EXT_CANDIDATES: [&str; 7] = ["jpg", "jpeg", "png", "webp", "bmp", "gif", "avif"];

// Thumbnail toolbar button IDs
#[cfg(target_os = "windows")]
pub(crate) const THUMB_BUTTON_PREVIOUS: u32 = 0;
#[cfg(target_os = "windows")]
pub(crate) const THUMB_BUTTON_PLAY_PAUSE: u32 = 1;
#[cfg(target_os = "windows")]
pub(crate) const THUMB_BUTTON_NEXT: u32 = 2;

// Thumbnail toolbar event source
#[cfg(target_os = "windows")]
pub(crate) const MEDIA_CONTROL_SOURCE_THUMBNAIL: &str = "thumbnail-toolbar";

