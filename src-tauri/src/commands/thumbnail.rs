use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailState {
    pub song_id: Option<String>,
    pub title: String,
    pub artist: String,
    pub is_playing: bool,
    pub can_previous: bool,
    pub can_next: bool,
    pub cover_url: Option<String>,
}

#[tauri::command]
pub fn sync_windows_thumbnail_state<R: Runtime>(
    app: AppHandle<R>,
    state: ThumbnailState,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::desktop::update_thumbnail_toolbar(&app, &state)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
