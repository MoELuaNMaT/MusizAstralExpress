// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use regex::Regex;
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::Emitter;
use tauri_plugin_store::{Error as StoreError, StoreBuilder};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const AUTH_STORE_FILE: &str = "auth_store.json";
const NETEASE_API_PORT: u16 = 3000;
const QQ_API_PORT: u16 = 3001;
const LOCAL_API_EVENT_NAME: &str = "local-api-progress";

#[derive(Serialize, Clone)]
struct LocalApiProgressPayload {
    stage: String,
    service: Option<String>,
    message: String,
    percent: u8,
    level: String,
    timestamp: u64,
}

fn now_timestamp_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis().min(u64::MAX as u128) as u64,
        Err(_) => 0,
    }
}

fn emit_local_api_progress(
    app: &tauri::AppHandle,
    stage: &str,
    service: Option<&str>,
    message: impl Into<String>,
    percent: u8,
    level: &str,
) {
    let payload = LocalApiProgressPayload {
        stage: stage.to_string(),
        service: service.map(|value| value.to_string()),
        message: message.into(),
        percent,
        level: level.to_string(),
        timestamp: now_timestamp_ms(),
    };

    let _ = app.emit(LOCAL_API_EVENT_NAME, payload);
}

#[derive(Default)]
struct LocalServiceManager {
    project_root: Option<PathBuf>,
    netease_child: Option<Child>,
    qq_child: Option<Child>,
}

static LOCAL_SERVICE_MANAGER: OnceLock<Mutex<LocalServiceManager>> = OnceLock::new();

fn local_service_manager() -> &'static Mutex<LocalServiceManager> {
    LOCAL_SERVICE_MANAGER.get_or_init(|| Mutex::new(LocalServiceManager::default()))
}

fn can_connect_to_port(port: u16) -> bool {
    let loopback = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&loopback, Duration::from_millis(250)).is_ok()
}

fn service_is_ready(service: &str) -> bool {
    match service {
        "netease" => can_connect_to_port(NETEASE_API_PORT),
        "qq" => can_connect_to_port(QQ_API_PORT),
        _ => false,
    }
}

fn is_process_running(process: &mut Child) -> bool {
    match process.try_wait() {
        Ok(Some(_)) => false,
        Ok(None) => true,
        Err(_) => false,
    }
}

fn clean_exited_processes(manager: &mut LocalServiceManager) {
    if let Some(child) = manager.netease_child.as_mut() {
        if !is_process_running(child) {
            manager.netease_child = None;
        }
    }
    if let Some(child) = manager.qq_child.as_mut() {
        if !is_process_running(child) {
            manager.qq_child = None;
        }
    }
}

fn looks_like_project_root(path: &Path) -> bool {
    path.join("scripts").join("start-netease-api.cjs").exists()
        && path.join("scripts").join("start-qmusic-adapter.cjs").exists()
}

fn find_project_root() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let mut cursor = Some(exe_dir.to_path_buf());
            for _ in 0..6 {
                if let Some(path) = cursor {
                    candidates.push(path.clone());
                    cursor = path.parent().map(|parent| parent.to_path_buf());
                } else {
                    break;
                }
            }
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.clone());
        if let Some(parent) = current_dir.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    let mut seen = HashSet::new();
    for candidate in candidates {
        let normalized = candidate.to_string_lossy().to_string();
        if !seen.insert(normalized) {
            continue;
        }

        if looks_like_project_root(&candidate) {
            return Some(candidate);
        }
    }

    None
}

fn spawn_node_script(project_root: &Path, script_name: &str) -> Result<Child, String> {
    let script_path = project_root.join("scripts").join(script_name);
    if !script_path.exists() {
        return Err(format!("script not found: {}", script_path.display()));
    }

    let mut command = Command::new("node");
    command
        .arg(script_path)
        .current_dir(project_root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|error| format!("failed to spawn node script: {}", error))
}

fn ensure_node_modules(project_root: &Path) -> Result<(), String> {
    let netease_entry = project_root
        .join("node_modules")
        .join("NeteaseCloudMusicApi")
        .join("app.js");

    if !netease_entry.exists() {
        return Err(
            "local API dependencies are missing (node_modules). Please run `npm install` in project root."
                .to_string(),
        );
    }

    Ok(())
}

fn qq_log_stage(line: &str) -> &'static str {
    let normalized = line.to_ascii_lowercase();
    if normalized.contains("creating python virtualenv") {
        return "qq_creating_venv";
    }
    if normalized.contains("installing python dependencies")
        || normalized.contains("collecting ")
        || normalized.contains("downloading ")
        || normalized.contains("building wheel")
        || normalized.contains("installing collected packages")
    {
        return "qq_installing";
    }
    if normalized.contains("dependencies already up-to-date")
        || normalized.contains("starting at http://")
    {
        return "qq_starting";
    }
    "qq_log"
}

fn netease_log_stage(line: &str) -> &'static str {
    let normalized = line.to_ascii_lowercase();
    if normalized.contains("starting neteasecloudmusicapi")
        || normalized.contains("listening")
        || normalized.contains("server run")
    {
        return "netease_starting";
    }
    "netease_log"
}

fn stage_percent(stage: &str, default: u8) -> u8 {
    match stage {
        "prepare" => 5,
        "checking_deps" => 10,
        "netease_starting" => 25,
        "qq_creating_venv" => 40,
        "qq_installing" => 48,
        "qq_starting" => 60,
        "netease_ready" => 70,
        "qq_ready" => 90,
        "ready" => 100,
        "error" => 100,
        _ => default,
    }
}

fn attach_process_log_forwarders(app: &tauri::AppHandle, service: &'static str, child: &mut Child) {
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(reader) = stdout {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let buffered = BufReader::new(reader);
            for line_result in buffered.lines() {
                let Ok(raw_line) = line_result else {
                    continue;
                };
                let line = raw_line.trim();
                if line.is_empty() {
                    continue;
                }

                let stage = if service == "qq" {
                    qq_log_stage(line)
                } else {
                    netease_log_stage(line)
                };
                let percent = stage_percent(stage, 55);
                emit_local_api_progress(
                    &app_handle,
                    stage,
                    Some(service),
                    line.to_string(),
                    percent,
                    "info",
                );
            }
        });
    }

    if let Some(reader) = stderr {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let buffered = BufReader::new(reader);
            for line_result in buffered.lines() {
                let Ok(raw_line) = line_result else {
                    continue;
                };
                let line = raw_line.trim();
                if line.is_empty() {
                    continue;
                }

                emit_local_api_progress(
                    &app_handle,
                    "log_warning",
                    Some(service),
                    line.to_string(),
                    60,
                    "warn",
                );
            }
        });
    }
}

fn shutdown_local_services_inner(manager: &mut LocalServiceManager) {
    if let Some(mut child) = manager.netease_child.take() {
        let _ = child.kill();
    }
    if let Some(mut child) = manager.qq_child.take() {
        let _ = child.kill();
    }
}

#[tauri::command]
fn ensure_local_api_services(app: tauri::AppHandle) -> Result<String, String> {
    emit_local_api_progress(
        &app,
        "prepare",
        None,
        "准备检查本地 API 服务...",
        5,
        "info",
    );

    let manager_mutex = local_service_manager();
    let mut manager = manager_mutex
        .lock()
        .map_err(|_| "failed to lock local service manager".to_string())?;

    clean_exited_processes(&mut manager);

    let root = match manager.project_root.clone() {
        Some(path) if looks_like_project_root(&path) => path,
        _ => {
            let found = find_project_root().ok_or_else(|| {
                "project root not found. Make sure ALLMusic is started from project workspace."
                    .to_string()
            })?;
            manager.project_root = Some(found.clone());
            found
        }
    };

    emit_local_api_progress(
        &app,
        "checking_deps",
        None,
        "正在检查 Node / Python 相关依赖...",
        10,
        "info",
    );

    if let Err(error) = ensure_node_modules(&root) {
        emit_local_api_progress(&app, "error", None, error.clone(), 100, "error");
        return Err(error);
    }

    let mut started_services = Vec::new();
    let netease_was_ready = service_is_ready("netease");
    let qq_was_ready = service_is_ready("qq");

    if netease_was_ready {
        emit_local_api_progress(
            &app,
            "netease_ready",
            Some("netease"),
            "网易本地 API 已在运行。",
            70,
            "info",
        );
    }

    if !netease_was_ready {
        let should_spawn = match manager.netease_child.as_mut() {
            Some(child) => !is_process_running(child),
            None => true,
        };

        if should_spawn {
            emit_local_api_progress(
                &app,
                "netease_starting",
                Some("netease"),
                "正在启动网易本地 API（3000）...",
                25,
                "info",
            );
            let mut child = spawn_node_script(&root, "start-netease-api.cjs").map_err(|error| {
                emit_local_api_progress(&app, "error", Some("netease"), error.clone(), 100, "error");
                error
            })?;
            attach_process_log_forwarders(&app, "netease", &mut child);
            manager.netease_child = Some(child);
            started_services.push("netease");
        }
    }

    if qq_was_ready {
        emit_local_api_progress(
            &app,
            "qq_ready",
            Some("qq"),
            "QQ 本地 API 已在运行。",
            90,
            "info",
        );
    }

    if !qq_was_ready {
        let should_spawn = match manager.qq_child.as_mut() {
            Some(child) => !is_process_running(child),
            None => true,
        };

        if should_spawn {
            emit_local_api_progress(
                &app,
                "qq_starting",
                Some("qq"),
                "正在启动 QQ 本地 API（3001）...",
                35,
                "info",
            );
            let mut child = spawn_node_script(&root, "start-qmusic-adapter.cjs").map_err(|error| {
                emit_local_api_progress(&app, "error", Some("qq"), error.clone(), 100, "error");
                error
            })?;
            attach_process_log_forwarders(&app, "qq", &mut child);
            manager.qq_child = Some(child);
            started_services.push("qq");
        }
    }

    drop(manager);

    let mut netease_ready_notified = netease_was_ready;
    let mut qq_ready_notified = qq_was_ready;

    for _ in 0..960 {
        let netease_ready = can_connect_to_port(NETEASE_API_PORT);
        let qq_ready = can_connect_to_port(QQ_API_PORT);

        if netease_ready && !netease_ready_notified {
            emit_local_api_progress(
                &app,
                "netease_ready",
                Some("netease"),
                "网易本地 API 已就绪。",
                70,
                "info",
            );
            netease_ready_notified = true;
        }

        if qq_ready && !qq_ready_notified {
            emit_local_api_progress(
                &app,
                "qq_ready",
                Some("qq"),
                "QQ 本地 API 已就绪。",
                90,
                "info",
            );
            qq_ready_notified = true;
        }

        if netease_ready && qq_ready {
            let result = if started_services.is_empty() {
                "local APIs already running".to_string()
            } else {
                format!("started local APIs: {}", started_services.join(", "))
            };
            emit_local_api_progress(&app, "ready", None, result.clone(), 100, "info");
            return Ok(result);
        }

        std::thread::sleep(Duration::from_millis(250));
    }

    let timeout_error =
        "local APIs failed to become ready in time. Check Node/Python environment and script logs."
            .to_string();
    emit_local_api_progress(&app, "error", None, timeout_error.clone(), 100, "error");
    Err(timeout_error)
}

#[tauri::command]
fn shutdown_local_api_services() -> Result<(), String> {
    let manager_mutex = local_service_manager();
    let mut manager = manager_mutex
        .lock()
        .map_err(|_| "failed to lock local service manager".to_string())?;

    shutdown_local_services_inner(&mut manager);
    Ok(())
}

/// User data structure
#[derive(Debug, Serialize, Deserialize)]
pub struct AuthUser {
    pub platform: String,
    pub user_id: String,
    pub nickname: String,
    pub avatar_url: String,
    pub is_logged_in: bool,
}

/// Login credentials to store
#[derive(Debug, Serialize, Deserialize)]
pub struct AuthCredentials {
    pub user: AuthUser,
    pub cookie: String,
}

// Authentication commands

/**
 * Store user authentication credentials
 */
#[tauri::command]
async fn store_auth(
    platform: String,
    user_id: String,
    nickname: String,
    avatar_url: String,
    cookie: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let store = StoreBuilder::new(&app, AUTH_STORE_FILE)
        .build()
        .map_err(|e: StoreError| e.to_string())?;

    let auth_user = AuthUser {
        platform: platform.clone(),
        user_id,
        nickname,
        avatar_url,
        is_logged_in: true,
    };

    let credentials = AuthCredentials {
        user: auth_user,
        cookie,
    };

    let key = format!("auth_{}", platform);
    let value = serde_json::to_value(&credentials).map_err(|e| e.to_string())?;

    store.set(&key, value);
    store.save().map_err(|e: StoreError| e.to_string())?;

    Ok(())
}

/**
 * Get stored authentication credentials for a platform
 */
#[tauri::command]
async fn get_auth(
    platform: String,
    app: tauri::AppHandle,
) -> Result<Option<AuthCredentials>, String> {
    let store = StoreBuilder::new(&app, AUTH_STORE_FILE)
        .build()
        .map_err(|e: StoreError| e.to_string())?;

    let key = format!("auth_{}", platform);
    let value = store.get(&key);

    match value {
        Some(v) => {
            let credentials: AuthCredentials =
                serde_json::from_value(v).map_err(|e| e.to_string())?;
            Ok(Some(credentials))
        }
        None => Ok(None),
    }
}

/**
 * Remove authentication credentials for a platform
 */
#[tauri::command]
async fn remove_auth(platform: String, app: tauri::AppHandle) -> Result<(), String> {
    let store = StoreBuilder::new(&app, AUTH_STORE_FILE)
        .build()
        .map_err(|e: StoreError| e.to_string())?;

    let key = format!("auth_{}", platform);
    store.delete(&key);
    store.save().map_err(|e: StoreError| e.to_string())?;

    Ok(())
}

/**
 * Get all stored authentication credentials
 */
#[tauri::command]
async fn get_all_auth(app: tauri::AppHandle) -> Result<Vec<AuthCredentials>, String> {
    let store = StoreBuilder::new(&app, AUTH_STORE_FILE)
        .build()
        .map_err(|e: StoreError| e.to_string())?;

    let mut result = Vec::new();

    // Check for netease credentials
    if let Some(v) = store.get("auth_netease") {
        if let Ok(credentials) = serde_json::from_value::<AuthCredentials>(v) {
            result.push(credentials);
        }
    }

    // Check for qq credentials
    if let Some(v) = store.get("auth_qq") {
        if let Ok(credentials) = serde_json::from_value::<AuthCredentials>(v) {
            result.push(credentials);
        }
    }

    Ok(result)
}

/**
 * Clear all authentication data
 */
#[tauri::command]
async fn clear_all_auth(app: tauri::AppHandle) -> Result<(), String> {
    let store = StoreBuilder::new(&app, AUTH_STORE_FILE)
        .build()
        .map_err(|e: StoreError| e.to_string())?;

    store.delete("auth_netease");
    store.delete("auth_qq");
    store.save().map_err(|e: StoreError| e.to_string())?;

    Ok(())
}

fn parse_netease_playlist_song_ids(html: &str) -> Vec<String> {
    let list_scope_regex = match Regex::new(
        r#"(?s)<ul class="f-hide">(.*?)</ul>\s*<textarea id="song-list-pre-data""#,
    ) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let scoped_html = list_scope_regex
        .captures(html)
        .and_then(|captures| captures.get(1).map(|matched| matched.as_str()))
        .unwrap_or(html);

    let song_id_regex = match Regex::new(r"/song\?id=(\d+)") {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let mut seen = HashSet::new();
    let mut ordered_song_ids = Vec::new();

    for captures in song_id_regex.captures_iter(scoped_html) {
        let Some(matched) = captures.get(1) else {
            continue;
        };

        let song_id = matched.as_str().to_string();
        if seen.insert(song_id.clone()) {
            ordered_song_ids.push(song_id);
        }
    }

    ordered_song_ids
}

fn normalize_cookie_for_http_request(raw_cookie: &str) -> String {
    let ignored_attrs = [
        "path",
        "domain",
        "expires",
        "max-age",
        "secure",
        "httponly",
        "samesite",
        "priority",
        "version",
        "comment",
    ];

    let mut seen_keys = HashSet::new();
    let mut pairs = Vec::new();

    for segment in raw_cookie.split(';') {
        let trimmed = segment.trim();
        if trimmed.is_empty() || !trimmed.contains('=') {
            continue;
        }

        let mut parts = trimmed.splitn(2, '=');
        let key = parts.next().unwrap_or_default().trim();
        let value = parts.next().unwrap_or_default().trim();
        if key.is_empty() || value.is_empty() {
            continue;
        }

        let key_lower = key.to_ascii_lowercase();
        if ignored_attrs.contains(&key_lower.as_str()) {
            continue;
        }

        if seen_keys.insert(key_lower) {
            pairs.push(format!("{}={}", key, value));
        }
    }

    pairs.join("; ")
}

fn extract_html_title(html: &str) -> String {
    let title_regex = match Regex::new(r"(?is)<title>(.*?)</title>") {
        Ok(value) => value,
        Err(_) => return String::new(),
    };

    let Some(captures) = title_regex.captures(html) else {
        return String::new();
    };
    let Some(matched) = captures.get(1) else {
        return String::new();
    };

    matched
        .as_str()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/**
 * Fetch NetEase playlist page and parse displayed song order.
 * This command is intended for desktop mode where direct browser scraping is restricted by CORS.
 */
#[tauri::command]
async fn fetch_netease_playlist_order(
    playlist_id: String,
    cookie: String,
) -> Result<Vec<String>, String> {
    let normalized_playlist_id = playlist_id.trim();
    if normalized_playlist_id.is_empty() {
        return Err("playlist_id is required".to_string());
    }

    let normalized_cookie = normalize_cookie_for_http_request(cookie.trim());
    if normalized_cookie.is_empty() {
        return Err("cookie is empty after normalization".to_string());
    }
    if !normalized_cookie.to_ascii_lowercase().contains("music_u=") {
        return Err("cookie is missing MUSIC_U; web login state is likely invalid".to_string());
    }

    let url = format!(
        "https://music.163.com/playlist?id={}",
        normalized_playlist_id
    );
    let client = reqwest::Client::builder()
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(&url)
        .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .header(REFERER, "https://music.163.com/")
        .header(COOKIE, normalized_cookie)
        .send()
        .await
        .map_err(|error| format!("Failed to request NetEase playlist page: {}", error))?;

    if !response.status().is_success() {
        return Err(format!(
            "NetEase playlist page request failed with HTTP {}",
            response.status()
        ));
    }

    let html = response
        .text()
        .await
        .map_err(|error| format!("Failed to read NetEase playlist page response: {}", error))?;

    if !html.contains("song-list-pre-data") {
        let anonymous_html = match client
            .get(&url)
            .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
            .header(REFERER, "https://music.163.com/")
            .send()
            .await
        {
            Ok(resp) => resp.text().await.unwrap_or_default(),
            Err(_) => String::new(),
        };

        if anonymous_html.contains("song-list-pre-data") {
            let anonymous_song_ids = parse_netease_playlist_song_ids(&anonymous_html);
            if !anonymous_song_ids.is_empty() {
                return Ok(anonymous_song_ids);
            }

            return Err("cookie page missing song-list block; anonymous page had block but parse failed".to_string());
        }

        let title = extract_html_title(&html);
        let anonymous_title = extract_html_title(&anonymous_html);
        return Err(
            format!(
                "playlist page has no song-list block; title='{}'; anonymous_title='{}'; url={}",
                title,
                anonymous_title,
                url
            )
            .to_string(),
        );
    }

    let song_ids = parse_netease_playlist_song_ids(&html);
    if song_ids.is_empty() {
        return Err(
            "playlist page loaded but song order could not be parsed (DOM may have changed)".to_string(),
        );
    }

    Ok(song_ids)
}

// Legacy command for testing
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Ok(mut manager) = local_service_manager().lock() {
                    shutdown_local_services_inner(&mut manager);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            store_auth,
            get_auth,
            remove_auth,
            get_all_auth,
            clear_all_auth,
            fetch_netease_playlist_order,
            ensure_local_api_services,
            shutdown_local_api_services,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
