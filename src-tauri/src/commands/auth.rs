use tauri::Manager;
use tauri_plugin_store::{Error as StoreError, StoreBuilder};

use crate::constants::*;
use crate::types::*;
use crate::utils::*;

/**
 * Store user authentication credentials
 */
#[tauri::command]
pub(crate) async fn store_auth(
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
pub(crate) async fn get_auth(
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
pub(crate) async fn remove_auth(platform: String, app: tauri::AppHandle) -> Result<(), String> {
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
pub(crate) async fn get_all_auth(app: tauri::AppHandle) -> Result<Vec<AuthCredentials>, String> {
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

#[tauri::command]
pub(crate) async fn probe_auth_store(
    app: tauri::AppHandle,
) -> Result<AuthStoreProbeResult, String> {
    const PROBE_KEY: &str = "__allmusic_probe_meta";

    let store = StoreBuilder::new(&app, AUTH_STORE_FILE)
        .build()
        .map_err(|e: StoreError| e.to_string())?;

    let previous_probe_found = store.get(PROBE_KEY).is_some();
    let probe_payload = serde_json::json!({
        "timestamp": now_timestamp_ms(),
        "source": "android_probe"
    });

    store.set(PROBE_KEY, probe_payload.clone());
    store.save().map_err(|e: StoreError| e.to_string())?;

    let roundtrip_ok = store
        .get(PROBE_KEY)
        .map(|value| value == probe_payload)
        .unwrap_or(false);

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error: tauri::Error| error.to_string())?;
    let store_file_path = app_data_dir.join(AUTH_STORE_FILE);

    let result = AuthStoreProbeResult {
        app_data_dir: app_data_dir.display().to_string(),
        store_file: store_file_path.display().to_string(),
        store_file_exists: store_file_path.exists(),
        roundtrip_ok,
        previous_probe_found,
    };

    println!(
        "[AUTH_STORE_PROBE] previous_probe_found={}, roundtrip_ok={}, store_file={}",
        result.previous_probe_found, result.roundtrip_ok, result.store_file
    );

    Ok(result)
}

/**
 * Clear all authentication data
 */
#[tauri::command]
pub(crate) async fn clear_all_auth(app: tauri::AppHandle) -> Result<(), String> {
    let store = StoreBuilder::new(&app, AUTH_STORE_FILE)
        .build()
        .map_err(|e: StoreError| e.to_string())?;

    store.delete("auth_netease");
    store.delete("auth_qq");
    store.save().map_err(|e: StoreError| e.to_string())?;

    Ok(())
}
