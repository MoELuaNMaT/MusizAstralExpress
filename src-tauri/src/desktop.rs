use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

use crate::constants::*;
use crate::services::shutdown_local_services;
use crate::utils::emit_media_control_event;

pub(crate) fn toggle_main_window_visibility<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let visible = window.is_visible().unwrap_or(true);
    if visible {
        let _ = window.hide();
        return;
    }

    let _ = window.show();
    let _ = window.set_focus();
}

pub(crate) fn register_global_media_shortcuts<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let shortcuts: [(Shortcut, &str); 3] = [
        (Shortcut::new(None, Code::MediaPlayPause), "toggle"),
        (Shortcut::new(None, Code::MediaTrackNext), "next"),
        (Shortcut::new(None, Code::MediaTrackPrevious), "previous"),
    ];

    for (shortcut, action) in shortcuts {
        let action_name = action.to_string();
        let register_result = app
            .global_shortcut()
            .on_shortcut(shortcut, move |app_handle, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    emit_media_control_event(app_handle, &action_name, "global-shortcut");
                }
            });

        if let Err(error) = register_result {
            eprintln!(
                "[ALLMusic] failed to register global media shortcut ({}): {}",
                action, error
            );
        }
    }
}

pub(crate) fn setup_system_tray<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let toggle_item = MenuItem::with_id(
        app,
        TRAY_MENU_TOGGLE_WINDOW,
        "Show / Hide",
        true,
        None::<&str>,
    )?;
    let play_pause_item = MenuItem::with_id(
        app,
        TRAY_MENU_PLAY_PAUSE,
        "Play / Pause",
        true,
        None::<&str>,
    )?;
    let previous_item = MenuItem::with_id(app, TRAY_MENU_PREVIOUS, "Previous", true, None::<&str>)?;
    let next_item = MenuItem::with_id(app, TRAY_MENU_NEXT, "Next", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, TRAY_MENU_QUIT, "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_item,
            &play_pause_item,
            &previous_item,
            &next_item,
            &quit_item,
        ],
    )?;

    let mut tray_builder = TrayIconBuilder::with_id(TRAY_ICON_ID)
        .menu(&menu)
        .tooltip("ALLMusic")
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| {
            if event.id() == TRAY_MENU_TOGGLE_WINDOW {
                toggle_main_window_visibility(app_handle);
                return;
            }

            if event.id() == TRAY_MENU_PLAY_PAUSE {
                emit_media_control_event(app_handle, "toggle", "tray");
                return;
            }

            if event.id() == TRAY_MENU_PREVIOUS {
                emit_media_control_event(app_handle, "previous", "tray");
                return;
            }

            if event.id() == TRAY_MENU_NEXT {
                emit_media_control_event(app_handle, "next", "tray");
                return;
            }

            if event.id() == TRAY_MENU_QUIT {
                shutdown_local_services();
                app_handle.exit(0);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window_visibility(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    tray_builder.build(app)?;
    Ok(())
}

// Windows Thumbnail Toolbar Implementation
#[cfg(target_os = "windows")]
use windows::{
    Win32::{
        Foundation::*,
        System::Com::*,
        UI::{
            Shell::*,
            WindowsAndMessaging::*,
        },
        Graphics::Gdi::HBITMAP,
    },
};


#[cfg(target_os = "windows")]
pub(crate) fn setup_thumbnail_toolbar<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    // 初始化 COM
    unsafe {
        let result = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if result.is_err() {
            return Err(format!("Failed to initialize COM: {:?}", result).into());
        }
    };

    // 创建 ITaskbarList3 实例
    let taskbar: ITaskbarList3 = unsafe {
        CoCreateInstance(&TaskbarList, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create ITaskbarList3: {:?}", e))?
    };
    unsafe {
        taskbar.HrInit()
            .map_err(|e| format!("Failed to initialize ITaskbarList3: {:?}", e))?
    };

    // 获取窗口句柄
    let window = app.get_webview_window("main")
        .ok_or("Main window not found")?;
    let hwnd = HWND(window.hwnd()?.0 as *mut core::ffi::c_void);

    // 创建按钮（暂时使用默认图标，后续需要加载自定义图标）
    let buttons = [
        THUMBBUTTON {
            dwMask: THB_FLAGS | THB_TOOLTIP,
            iId: THUMB_BUTTON_PREVIOUS,
            iBitmap: 0,
            hIcon: HICON::default(),
            szTip: encode_wide("上一首"),
            dwFlags: THBF_ENABLED,
            ..Default::default()
        },
        THUMBBUTTON {
            dwMask: THB_FLAGS | THB_TOOLTIP,
            iId: THUMB_BUTTON_PLAY_PAUSE,
            iBitmap: 0,
            hIcon: HICON::default(),
            szTip: encode_wide("播放"),
            dwFlags: THBF_ENABLED,
            ..Default::default()
        },
        THUMBBUTTON {
            dwMask: THB_FLAGS | THB_TOOLTIP,
            iId: THUMB_BUTTON_NEXT,
            iBitmap: 0,
            hIcon: HICON::default(),
            szTip: encode_wide("下一首"),
            dwFlags: THBF_ENABLED,
            ..Default::default()
        },
    ];

    unsafe {
        taskbar.ThumbBarAddButtons(hwnd, &buttons)
            .map_err(|e| format!("Failed to add thumbnail buttons: {:?}", e))?
    };

    eprintln!("[ALLMusic] Thumbnail toolbar initialized successfully");

    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn update_thumbnail_toolbar<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    state: &crate::commands::thumbnail::ThumbnailState,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    // 每次调用时重新创建 ITaskbarList3 实例（COM 对象标准做法）
    let taskbar: ITaskbarList3 = unsafe {
        CoCreateInstance(&TaskbarList, None, CLSCTX_ALL)
            .map_err(|e| format!("Failed to create ITaskbarList3: {:?}", e))?
    };
    unsafe {
        taskbar.HrInit()
            .map_err(|e| format!("Failed to initialize ITaskbarList3: {:?}", e))?
    };

    let window = app.get_webview_window("main")
        .ok_or("Main window not found")?;
    let hwnd = HWND(window.hwnd()?.0 as *mut core::ffi::c_void);

    // 更新播放/暂停按钮
    let play_pause_button = THUMBBUTTON {
        dwMask: THB_FLAGS | THB_TOOLTIP,
        iId: THUMB_BUTTON_PLAY_PAUSE,
        iBitmap: 0,
        hIcon: HICON::default(),
        szTip: encode_wide(if state.is_playing { "暂停" } else { "播放" }),
        dwFlags: THBF_ENABLED,
        ..Default::default()
    };

    // 更新上一首按钮状态
    let previous_button = THUMBBUTTON {
        dwMask: THB_FLAGS,
        iId: THUMB_BUTTON_PREVIOUS,
        iBitmap: 0,
        hIcon: HICON::default(),
        szTip: [0; 260],
        dwFlags: if state.can_previous { THBF_ENABLED } else { THBF_DISABLED },
        ..Default::default()
    };

    // 更新下一首按钮状态
    let next_button = THUMBBUTTON {
        dwMask: THB_FLAGS,
        iId: THUMB_BUTTON_NEXT,
        iBitmap: 0,
        hIcon: HICON::default(),
        szTip: [0; 260],
        dwFlags: if state.can_next { THBF_ENABLED } else { THBF_DISABLED },
        ..Default::default()
    };

    let buttons = [previous_button, play_pause_button, next_button];
    unsafe {
        taskbar.ThumbBarUpdateButtons(hwnd, &buttons)
            .map_err(|e| format!("Failed to update thumbnail buttons: {:?}", e))?
    };

    // 更新封面缩略图
    if let Some(cover_url) = &state.cover_url {
        if !cover_url.is_empty() {
            match update_thumbnail_cover(app, hwnd, cover_url) {
                Ok(_) => eprintln!("[ALLMusic] Thumbnail cover updated"),
                Err(e) => eprintln!("[ALLMusic] Failed to update cover: {}", e),
            }
        } else {
            let _ = clear_thumbnail_cover(hwnd);
        }
    } else {
        let _ = clear_thumbnail_cover(hwnd);
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn encode_wide(s: &str) -> [u16; 260] {
    let mut buffer = [0u16; 260];
    let encoded: Vec<u16> = s.encode_utf16().collect();
    let len = encoded.len().min(259);
    buffer[..len].copy_from_slice(&encoded[..len]);
    buffer
}

#[cfg(target_os = "windows")]
pub(crate) fn handle_thumbnail_button_click<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    button_id: u32,
) {
    let action = match button_id {
        THUMB_BUTTON_PREVIOUS => "previous",
        THUMB_BUTTON_PLAY_PAUSE => "toggle",
        THUMB_BUTTON_NEXT => "next",
        _ => return,
    };

    emit_media_control_event(app, action, MEDIA_CONTROL_SOURCE_THUMBNAIL);
}

#[cfg(target_os = "windows")]
use once_cell::sync::OnceCell;
#[cfg(target_os = "windows")]
use std::sync::mpsc::{channel, Sender};
#[cfg(target_os = "windows")]
use std::sync::Mutex;

#[cfg(target_os = "windows")]
static THUMBNAIL_BUTTON_SENDER: OnceCell<Sender<u32>> = OnceCell::new();

#[cfg(target_os = "windows")]
static CURRENT_COVER_URL: OnceCell<Mutex<String>> = OnceCell::new();

#[cfg(target_os = "windows")]
static ORIGINAL_MAIN_WNDPROC: OnceCell<isize> = OnceCell::new();

#[cfg(target_os = "windows")]
pub(crate) fn setup_thumbnail_message_handler<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    app_handle: tauri::AppHandle<R>,
) {
    use windows::Win32::UI::WindowsAndMessaging::{
        WM_COMMAND, SetWindowLongPtrW, GetWindowLongPtrW, GWLP_WNDPROC, CallWindowProcW
    };
    use windows::Win32::Foundation::{LPARAM, WPARAM, LRESULT};

    // 创建通道
    let (tx, rx) = channel::<u32>();
    THUMBNAIL_BUTTON_SENDER.set(tx).ok();

    // 启动后台线程处理按钮点击
    std::thread::spawn(move || {
        while let Ok(button_id) = rx.recv() {
            handle_thumbnail_button_click(&app_handle, button_id);
        }
    });

    // 获取窗口句柄
    let hwnd = match window.hwnd() {
        Ok(handle) => HWND(handle.0 as *mut core::ffi::c_void),
        Err(e) => {
            eprintln!("[ALLMusic] Failed to get window handle: {}", e);
            return;
        }
    };

    unsafe {
        // 保存原始窗口过程
        let original_wndproc = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
        let _ = ORIGINAL_MAIN_WNDPROC.set(original_wndproc);

        // 创建新的窗口过程
        unsafe extern "system" fn thumbnail_wndproc(
            hwnd: HWND,
            msg: u32,
            wparam: WPARAM,
            lparam: LPARAM,
        ) -> LRESULT {
            if msg == WM_COMMAND {
                let button_id = (wparam.0 & 0xFFFF) as u32;
                if let Some(sender) = THUMBNAIL_BUTTON_SENDER.get() {
                    let _ = sender.send(button_id);
                }
            }

            // Forward to the original WndProc so Tauri keeps native resize/layout behavior.
            if let Some(original) = ORIGINAL_MAIN_WNDPROC.get() {
                let original_proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT =
                    std::mem::transmute(*original);
                return CallWindowProcW(Some(original_proc), hwnd, msg, wparam, lparam);
            }

            use windows::Win32::UI::WindowsAndMessaging::DefWindowProcW;
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }

        // 设置新的窗口过程
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC, thumbnail_wndproc as isize);

        eprintln!("[ALLMusic] Thumbnail message handler installed");
    }
}

// ========== Phase 2: 封面缩略图功能 ==========

#[cfg(target_os = "windows")]
fn load_cover_image(path: &str) -> Result<image::DynamicImage, String> {
    image::open(path).map_err(|e| format!("Failed to load image: {}", e))
}

#[cfg(target_os = "windows")]
fn resize_cover_image(img: image::DynamicImage, width: u32, height: u32) -> image::DynamicImage {
    img.resize_exact(width, height, image::imageops::FilterType::Lanczos3)
}

#[cfg(target_os = "windows")]
fn image_to_hbitmap(img: &image::DynamicImage) -> Result<HBITMAP, String> {
    use windows::Win32::Graphics::Gdi::*;

    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    unsafe {
        let hdc = GetDC(HWND::default());
        if hdc.is_invalid() {
            return Err("Failed to get device context".to_string());
        }

        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // 负值表示自顶向下
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0 as u32,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD::default(); 1],
        };

        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let hbitmap = CreateDIBSection(
            hdc,
            &bmi,
            DIB_RGB_COLORS,
            &mut bits,
            None,
            0,
        ).map_err(|e| {
            ReleaseDC(HWND::default(), hdc);
            format!("Failed to create DIB section: {:?}", e)
        })?;

        if hbitmap.is_invalid() || bits.is_null() {
            ReleaseDC(HWND::default(), hdc);
            return Err("Failed to create DIB section".to_string());
        }

        // 复制像素数据（RGBA -> BGRA）
        let pixel_data = rgba.as_raw();
        let dest = std::slice::from_raw_parts_mut(bits as *mut u8, (width * height * 4) as usize);

        for i in 0..(width * height) as usize {
            let src_idx = i * 4;
            let dst_idx = i * 4;
            dest[dst_idx] = pixel_data[src_idx + 2];     // B
            dest[dst_idx + 1] = pixel_data[src_idx + 1]; // G
            dest[dst_idx + 2] = pixel_data[src_idx];     // R
            dest[dst_idx + 3] = pixel_data[src_idx + 3]; // A
        }

        ReleaseDC(HWND::default(), hdc);
        Ok(hbitmap)
    }
}

#[cfg(target_os = "windows")]
fn cleanup_hbitmap(hbitmap: HBITMAP) {
    use windows::Win32::Graphics::Gdi::DeleteObject;

    if !hbitmap.is_invalid() {
        unsafe {
            let _ = DeleteObject(hbitmap);
        }
    }
}

#[cfg(target_os = "windows")]
fn set_thumbnail_cover(hwnd: HWND, hbitmap: HBITMAP) -> Result<(), String> {
    use windows::Win32::Graphics::Dwm::{DwmSetIconicThumbnail, DWM_SIT_DISPLAYFRAME};

    unsafe {
        DwmSetIconicThumbnail(hwnd, hbitmap, DWM_SIT_DISPLAYFRAME)
            .map_err(|e| format!("Failed to set thumbnail cover: {:?}", e))
    }
}

#[cfg(target_os = "windows")]
fn clear_thumbnail_cover(hwnd: HWND) -> Result<(), String> {
    use windows::Win32::Graphics::Dwm::DwmSetIconicThumbnail;

    unsafe {
        DwmSetIconicThumbnail(hwnd, HBITMAP::default(), 0)
            .map_err(|e| format!("Failed to clear thumbnail cover: {:?}", e))
    }
}

#[cfg(target_os = "windows")]
fn update_thumbnail_cover<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    hwnd: HWND,
    cover_url: &str,
) -> Result<(), String> {
    // 初始化缓存
    CURRENT_COVER_URL.get_or_init(|| Mutex::new(String::new()));

    // 检查是否需要更新
    let cache = CURRENT_COVER_URL.get().unwrap();
    let mut cache_guard = cache.lock().unwrap();

    if *cache_guard == cover_url {
        // URL 未变化，跳过更新
        return Ok(());
    }

    // 调用 cache_cover_image 命令获取本地路径
    // 注意：这里需要将泛型 AppHandle<R> 转换为具体类型
    let app_handle = unsafe {
        std::mem::transmute::<&tauri::AppHandle<R>, &tauri::AppHandle>(app)
    };

    let local_path = tauri::async_runtime::block_on(async {
        crate::commands::cache_cover_image(app_handle.clone(), cover_url.to_string()).await
    }).map_err(|e| format!("Failed to cache cover image: {}", e))?;

    // 加载图片
    let img = load_cover_image(&local_path)?;

    // 缩放到 200x200
    let resized = resize_cover_image(img, 200, 200);

    // 转换为 HBITMAP
    let hbitmap = image_to_hbitmap(&resized)?;

    // 设置封面
    set_thumbnail_cover(hwnd, hbitmap)?;

    // 清理 HBITMAP（注意：设置后立即清理可能导致显示问题，但避免内存泄漏）
    // 实际上，Windows 会持有 HBITMAP 的引用，所以这里不应该立即清理
    // cleanup_hbitmap(hbitmap);

    // 更新缓存
    *cache_guard = cover_url.to_string();

    Ok(())
}

