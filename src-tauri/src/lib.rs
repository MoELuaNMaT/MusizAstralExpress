// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod constants;
#[cfg(desktop)]
mod desktop;
mod services;
mod types;
mod utils;

use commands::*;
use services::install_local_service_cleanup_hook;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_local_service_cleanup_hook();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        .setup(|app| {
            #[cfg(desktop)]
            desktop::register_global_media_shortcuts(&app.handle());

            #[cfg(desktop)]
            if let Err(error) = desktop::setup_system_tray(&app.handle()) {
                eprintln!("[ALLMusic] failed to initialize system tray: {}", error);
            }

            // 初始化 Windows 缩略图工具栏
            #[cfg(all(desktop, target_os = "windows"))]
            if let Err(error) = desktop::setup_thumbnail_toolbar(&app.handle()) {
                eprintln!("[ALLMusic] failed to initialize thumbnail toolbar: {}", error);
            }

            // 注册 Windows 消息处理器
            #[cfg(all(desktop, target_os = "windows"))]
            {
                use tauri::Manager;

                if let Some(window) = app.get_webview_window("main") {
                    let app_handle = app.handle().clone();
                    desktop::setup_thumbnail_message_handler(window, app_handle);
                }
            }

            Ok(())
        })
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                services::shutdown_local_services();
            }
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            store_auth,
            get_auth,
            remove_auth,
            get_all_auth,
            probe_auth_store,
            clear_all_auth,
            fetch_netease_playlist_order,
            check_local_api_environment,
            install_local_api_requirements,
            ensure_local_api_services,
            shutdown_local_api_services,
            cache_cover_image,
            sync_windows_thumbnail_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
