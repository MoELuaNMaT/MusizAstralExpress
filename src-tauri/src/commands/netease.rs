use reqwest::header::{COOKIE, REFERER, USER_AGENT};

use crate::utils::*;

/**
 * Fetch NetEase playlist page and parse displayed song order.
 * This command is intended for desktop mode where direct browser scraping is restricted by CORS.
 */
#[tauri::command]
pub(crate) async fn fetch_netease_playlist_order(
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
pub(crate) fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
