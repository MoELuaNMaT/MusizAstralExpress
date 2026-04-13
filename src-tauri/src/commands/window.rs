use tauri::{AppHandle, Runtime};

#[tauri::command]
pub fn sync_main_window_aspect_ratio<R: Runtime>(
    app: AppHandle<R>,
    width: u32,
    height: u32,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        crate::desktop::sync_main_window_aspect_ratio(&app, width, height)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}
