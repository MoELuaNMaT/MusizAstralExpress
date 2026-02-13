// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use regex::Regex;
use reqwest::header::{COOKIE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri_plugin_store::{Error as StoreError, StoreBuilder};

const AUTH_STORE_FILE: &str = "auth_store.json";

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
        .invoke_handler(tauri::generate_handler![
            greet,
            store_auth,
            get_auth,
            remove_auth,
            get_all_auth,
            clear_all_auth,
            fetch_netease_playlist_order,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
