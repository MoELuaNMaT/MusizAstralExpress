use std::fs;
use std::time::Duration;

use reqwest::header::CONTENT_TYPE;
use tauri::Manager;

use crate::constants::*;
use crate::utils::*;

#[tauri::command]
pub(crate) async fn cache_cover_image(
    app: tauri::AppHandle,
    url: String,
) -> Result<String, String> {
    let normalized_url = url.trim();
    if normalized_url.is_empty() {
        return Err("cover url is empty".to_string());
    }
    if !normalized_url.starts_with("http://") && !normalized_url.starts_with("https://") {
        return Err("only http/https cover url is supported".to_string());
    }

    let app_cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("failed to resolve app cache dir: {}", error))?;
    let cover_cache_dir = app_cache_dir.join(COVER_CACHE_DIR);
    fs::create_dir_all(&cover_cache_dir)
        .map_err(|error| format!("failed to create cover cache dir: {}", error))?;

    let cache_basename = hash_text(normalized_url);
    if let Some(existing) = find_cached_cover_file(&cover_cache_dir, &cache_basename) {
        return Ok(existing.display().to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("failed to build request client: {}", error))?;
    let response = client
        .get(normalized_url)
        .send()
        .await
        .map_err(|error| format!("failed to download cover image: {}", error))?;

    if !response.status().is_success() {
        return Err(format!(
            "failed to download cover image, HTTP {}",
            response.status()
        ));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("failed to read cover image bytes: {}", error))?;
    if bytes.is_empty() {
        return Err("downloaded cover image is empty".to_string());
    }

    let extension = infer_image_extension_from_url(normalized_url)
        .or_else(|| infer_image_extension_from_content_type(&content_type))
        .unwrap_or("jpg");
    let cache_file_path = cover_cache_dir.join(format!("{}.{}", cache_basename, extension));
    fs::write(&cache_file_path, &bytes)
        .map_err(|error| format!("failed to write cover cache file: {}", error))?;

    Ok(cache_file_path.display().to_string())
}
