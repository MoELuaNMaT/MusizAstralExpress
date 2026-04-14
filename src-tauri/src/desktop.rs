use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

use crate::constants::*;
use crate::services::shutdown_local_services;
use crate::utils::emit_media_control_event;

// COM 线程公寓 RAII 守卫，确保 CoUninitialize 配对调用
struct ComGuard;
impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

#[cfg(all(target_os = "windows", not(target_pointer_width = "64")))]
compile_error!("Windows desktop integration requires 64-bit target");

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
        Graphics::Dwm::*,
        UI::{
            Shell::*,
            WindowsAndMessaging::*,
        },
    },
};


#[cfg(target_os = "windows")]
pub(crate) fn setup_thumbnail_toolbar<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    // 初始化 COM（RAII 守卫确保 CoUninitialize 配对调用）
    let _com_guard = unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED)
            .ok()
            .map_err(|e| format!("Failed to initialize COM: {}", e))?;
        ComGuard
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

    unsafe {
        let force_iconic: i32 = 1;
        let has_iconic_bitmap: i32 = 1;
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_FORCE_ICONIC_REPRESENTATION,
            &force_iconic as *const _ as _,
            std::mem::size_of_val(&force_iconic) as u32,
        ).map_err(|e| format!("Failed to enable iconic representation: {:?}", e))?;
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_HAS_ICONIC_BITMAP,
            &has_iconic_bitmap as *const _ as _,
            std::mem::size_of_val(&has_iconic_bitmap) as u32,
        ).map_err(|e| format!("Failed to enable iconic bitmap: {:?}", e))?;
    }

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

    // 仅保留缩略图工具栏按钮，不再驱动封面位图链路。
    // 根因：当前 Tauri 主窗口接入 DWM iconic thumbnail cover 会触发额外缩略图渲染消息，
    // 在播放态下会干扰主窗口稳定性，优先保证主窗口与播放器工作正常。
    let _ = app;
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
use once_cell::sync::{Lazy, OnceCell};
#[cfg(target_os = "windows")]
use std::sync::{
    mpsc::{channel, Sender},
    Mutex,
};
#[cfg(target_os = "windows")]
static THUMBNAIL_BUTTON_SENDER: OnceCell<Sender<u32>> = OnceCell::new();

#[cfg(target_os = "windows")]
static ORIGINAL_MAIN_WNDPROC: OnceCell<isize> = OnceCell::new();

#[cfg(target_os = "windows")]
#[derive(Clone, Copy)]
struct MainWindowAspectRatio {
    width: i32,
    height: i32,
    min_width: i32,
    min_height: i32,
}

#[cfg(target_os = "windows")]
impl MainWindowAspectRatio {
    fn new(width: i32, height: i32) -> Self {
        let safe_width = width.max(1);
        let safe_height = height.max(1);
        let min_height = 600;
        let min_width = (((min_height as f64) * (safe_width as f64)) / (safe_height as f64)).round() as i32;
        Self {
            width: safe_width,
            height: safe_height,
            min_width: min_width.max(1),
            min_height,
        }
    }

    fn ratio(self) -> f64 {
        self.width as f64 / self.height as f64
    }
}

#[cfg(target_os = "windows")]
static MAIN_WINDOW_ASPECT_RATIO: Lazy<Mutex<MainWindowAspectRatio>> =
    Lazy::new(|| Mutex::new(MainWindowAspectRatio::new(1280, 800)));

#[cfg(target_os = "windows")]
fn read_main_window_aspect_ratio() -> MainWindowAspectRatio {
    MAIN_WINDOW_ASPECT_RATIO
        .lock()
        .map(|guard| *guard)
        .unwrap_or_else(|_| MainWindowAspectRatio::new(1280, 800))
}

#[cfg(target_os = "windows")]
fn write_main_window_aspect_ratio(width: i32, height: i32) {
    if let Ok(mut guard) = MAIN_WINDOW_ASPECT_RATIO.lock() {
        *guard = MainWindowAspectRatio::new(width, height);
    }
}

#[cfg(target_os = "windows")]
unsafe fn apply_locked_aspect_ratio(edge: u32, rect: &mut RECT, aspect_ratio: MainWindowAspectRatio) {
    let mut width = rect.right - rect.left;
    let mut height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        return;
    }

    let target_ratio = aspect_ratio.ratio();
    let current_ratio = width as f64 / height as f64;
    let adjust_width = matches!(edge, WMSZ_TOP | WMSZ_BOTTOM)
        || (matches!(edge, WMSZ_TOPLEFT | WMSZ_TOPRIGHT | WMSZ_BOTTOMLEFT | WMSZ_BOTTOMRIGHT)
            && current_ratio < target_ratio);

    if adjust_width {
        width = ((height as f64) * target_ratio).round() as i32;
    } else {
        height = ((width as f64) / target_ratio).round() as i32;
    }

    width = width.max(aspect_ratio.min_width);
    height = height.max(aspect_ratio.min_height);

    match edge {
        WMSZ_LEFT => {
            rect.left = rect.right - width;
            rect.bottom = rect.top + height;
        }
        WMSZ_RIGHT => {
            rect.right = rect.left + width;
            rect.bottom = rect.top + height;
        }
        WMSZ_TOP => {
            rect.top = rect.bottom - height;
            rect.right = rect.left + width;
        }
        WMSZ_BOTTOM => {
            rect.bottom = rect.top + height;
            rect.right = rect.left + width;
        }
        WMSZ_TOPLEFT => {
            rect.left = rect.right - width;
            rect.top = rect.bottom - height;
        }
        WMSZ_TOPRIGHT => {
            rect.right = rect.left + width;
            rect.top = rect.bottom - height;
        }
        WMSZ_BOTTOMLEFT => {
            rect.left = rect.right - width;
            rect.bottom = rect.top + height;
        }
        WMSZ_BOTTOMRIGHT => {
            rect.right = rect.left + width;
            rect.bottom = rect.top + height;
        }
        _ => {}
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn setup_main_window_message_handler<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, GetWindowLongPtrW, SetWindowLongPtrW, GWLP_WNDPROC,
        HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTCLIENT, HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT,
        HTTOPRIGHT, MINMAXINFO, WM_COMMAND, WM_GETMINMAXINFO, WM_NCHITTEST, WM_SIZING,
    };

    if ORIGINAL_MAIN_WNDPROC.get().is_some() {
        return;
    }

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let hwnd = match window.hwnd() {
        Ok(handle) => HWND(handle.0 as *mut core::ffi::c_void),
        Err(error) => {
            eprintln!("[ALLMusic] failed to get main window handle for resize hook: {}", error);
            return;
        }
    };

    unsafe extern "system" fn main_window_wndproc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
    ) -> LRESULT {
        if msg == WM_NCHITTEST {
            let x = (lparam.0 & 0xFFFF) as i16 as i32;
            let y = ((lparam.0 >> 16) & 0xFFFF) as i16 as i32;
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect).is_ok() {
                const RESIZE_BORDER: i32 = 8;
                let left = x < rect.left + RESIZE_BORDER;
                let right = x >= rect.right - RESIZE_BORDER;
                let top = y < rect.top + RESIZE_BORDER;
                let bottom = y >= rect.bottom - RESIZE_BORDER;

                if top && left {
                    return LRESULT(HTTOPLEFT as isize);
                }
                if top && right {
                    return LRESULT(HTTOPRIGHT as isize);
                }
                if bottom && left {
                    return LRESULT(HTBOTTOMLEFT as isize);
                }
                if bottom && right {
                    return LRESULT(HTBOTTOMRIGHT as isize);
                }
                if left {
                    return LRESULT(HTLEFT as isize);
                }
                if right {
                    return LRESULT(HTRIGHT as isize);
                }
                if top {
                    return LRESULT(HTTOP as isize);
                }
                if bottom {
                    return LRESULT(HTBOTTOM as isize);
                }
            }

            return LRESULT(HTCLIENT as isize);
        }

        if msg == WM_COMMAND {
            let button_id = (wparam.0 & 0xFFFF) as u32;
            if let Some(sender) = THUMBNAIL_BUTTON_SENDER.get() {
                let _ = sender.send(button_id);
            }
        }

        if msg == WM_SIZING {
            let rect_ptr = lparam.0 as *mut RECT;
            if !rect_ptr.is_null() {
                let aspect_ratio = read_main_window_aspect_ratio();
                apply_locked_aspect_ratio(wparam.0 as u32, &mut *rect_ptr, aspect_ratio);
                return LRESULT(1);
            }
        }

        if msg == WM_GETMINMAXINFO {
            let minmax_ptr = lparam.0 as *mut MINMAXINFO;
            if !minmax_ptr.is_null() {
                let aspect_ratio = read_main_window_aspect_ratio();
                (*minmax_ptr).ptMinTrackSize.x = aspect_ratio.min_width;
                (*minmax_ptr).ptMinTrackSize.y = aspect_ratio.min_height;
                return LRESULT(0);
            }
        }

        if let Some(original) = ORIGINAL_MAIN_WNDPROC.get() {
            let original_proc: unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT =
                std::mem::transmute(*original);
            return CallWindowProcW(Some(original_proc), hwnd, msg, wparam, lparam);
        }

        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    unsafe {
        let original_wndproc = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
        let _ = ORIGINAL_MAIN_WNDPROC.set(original_wndproc);
        SetWindowLongPtrW(hwnd, GWLP_WNDPROC, main_window_wndproc as isize);
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn sync_main_window_aspect_ratio<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    width: u32,
    height: u32,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, SetWindowPos, SWP_NOMOVE, SWP_NOZORDER, SWP_NOACTIVATE,
    };

    if width == 0 || height == 0 {
        return Ok(());
    }

    write_main_window_aspect_ratio(width as i32, height as i32);

    let window = app.get_webview_window("main").ok_or("Main window not found")?;
    let hwnd = HWND(window.hwnd()?.0 as *mut core::ffi::c_void);

    let mut rect = RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut rect)?;
    }

    let aspect_ratio = read_main_window_aspect_ratio();
    let current_width = (rect.right - rect.left).max(1);
    let current_height = (rect.bottom - rect.top).max(1);
    let current_ratio = current_width as f64 / current_height as f64;
    let target_ratio = aspect_ratio.ratio();

    let mut target_width = current_width;
    let mut target_height = current_height;
    if current_ratio > target_ratio {
        target_width = ((current_height as f64) * target_ratio).round() as i32;
    } else {
        target_height = ((current_width as f64) / target_ratio).round() as i32;
    }

    target_width = target_width.max(aspect_ratio.min_width);
    target_height = target_height.max(aspect_ratio.min_height);

    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            target_width,
            target_height,
            SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
        )?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub(crate) fn setup_thumbnail_message_handler<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    app_handle: tauri::AppHandle<R>,
) {
    // 创建通道
    let (tx, rx) = channel::<u32>();
    THUMBNAIL_BUTTON_SENDER.set(tx).ok();

    // 启动后台线程处理按钮点击
    std::thread::spawn(move || {
        while let Ok(button_id) = rx.recv() {
            handle_thumbnail_button_click(&app_handle, button_id);
        }
    });
    let _ = window;
}


