use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, Once, OnceLock};
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::constants::*;
use crate::types::*;
use crate::utils::*;
use tauri::Manager;

#[derive(Default)]
pub(crate) struct LocalServiceManager {
    pub(crate) project_root: Option<PathBuf>,
    pub(crate) python_command: Option<String>,
    pub(crate) netease_child: Option<Child>,
    pub(crate) qq_child: Option<Child>,
}

pub(crate) static LOCAL_SERVICE_MANAGER: OnceLock<Mutex<LocalServiceManager>> = OnceLock::new();

pub(crate) fn local_service_manager() -> &'static Mutex<LocalServiceManager> {
    LOCAL_SERVICE_MANAGER.get_or_init(|| Mutex::new(LocalServiceManager::default()))
}

pub(crate) fn service_is_ready(service: &str) -> bool {
    match service {
        "netease" => can_connect_to_port(NETEASE_API_PORT),
        "qq" => can_connect_to_port(QQ_API_PORT),
        _ => false,
    }
}

pub(crate) fn is_process_running(process: &mut Child) -> bool {
    match process.try_wait() {
        Ok(Some(_)) => false,
        Ok(None) => true,
        Err(_) => false,
    }
}

pub(crate) fn clean_exited_processes(manager: &mut LocalServiceManager) {
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

pub(crate) fn resolve_project_root_for_manager(manager: &mut LocalServiceManager) -> Option<PathBuf> {
    match manager.project_root.clone() {
        Some(path) if looks_like_project_root(&path) => Some(path),
        _ => {
            let found = find_project_root()?;
            manager.project_root = Some(found.clone());
            Some(found)
        }
    }
}

pub(crate) fn detect_node_runtime() -> LocalApiRuntimeStatus {
    let (available, version, error) = probe_runtime_command("node", &["--version"]);
    LocalApiRuntimeStatus {
        name: "Node.js".to_string(),
        command: "node".to_string(),
        available,
        version,
        hint: error,
        install_url: NODEJS_INSTALL_URL.to_string(),
    }
}

pub(crate) fn detect_python_runtime() -> (LocalApiRuntimeStatus, Option<String>) {
    let (available, version, error) = probe_runtime_command("python", &["--version"]);
    if available {
        return (
            LocalApiRuntimeStatus {
                name: "Python".to_string(),
                command: "python".to_string(),
                available: true,
                version,
                hint: None,
                install_url: PYTHON_INSTALL_URL.to_string(),
            },
            Some("python".to_string()),
        );
    }

    #[cfg(target_os = "windows")]
    {
        let (launcher_available, launcher_version, launcher_error) =
            probe_runtime_command("py", &["--version"]);
        if launcher_available {
            return (
                LocalApiRuntimeStatus {
                    name: "Python".to_string(),
                    command: "py".to_string(),
                    available: true,
                    version: launcher_version,
                    hint: Some("检测到 py 启动器，将用于 QQ 本地 API。".to_string()),
                    install_url: PYTHON_INSTALL_URL.to_string(),
                },
                Some("py".to_string()),
            );
        }

        return (
            LocalApiRuntimeStatus {
                name: "Python".to_string(),
                command: "python".to_string(),
                available: false,
                version: None,
                hint: launcher_error.or(error),
                install_url: PYTHON_INSTALL_URL.to_string(),
            },
            None,
        );
    }

    #[cfg(not(target_os = "windows"))]
    {
        (
            LocalApiRuntimeStatus {
                name: "Python".to_string(),
                command: "python".to_string(),
                available: false,
                version: None,
                hint: error,
                install_url: PYTHON_INSTALL_URL.to_string(),
            },
            None,
        )
    }
}

pub(crate) fn ensure_node_modules(project_root: &Path) -> Result<(), String> {
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

pub(crate) fn inspect_local_api_environment(project_root: Option<&Path>) -> LocalApiEnvironmentInspection {
    let node = detect_node_runtime();
    let (python, python_command) = detect_python_runtime();

    let mut missing = Vec::new();
    if !node.available {
        missing.push(LocalApiMissingRequirement {
            key: "node".to_string(),
            title: "缺少 Node.js".to_string(),
            detail: "无法启动网易本地 API，请先安装 Node.js（建议 LTS 版本）。".to_string(),
            install_url: Some(node.install_url.clone()),
        });
    }

    if !python.available {
        missing.push(LocalApiMissingRequirement {
            key: "python".to_string(),
            title: "缺少 Python".to_string(),
            detail: "无法启动 QQ 本地 API，请先安装 Python 3.10+ 并确保命令可用。".to_string(),
            install_url: Some(python.install_url.clone()),
        });
    }

    let mut node_modules_ready = false;
    let mut project_root_display = None;
    match project_root {
        Some(root) => {
            project_root_display = Some(root.display().to_string());
            match ensure_node_modules(root) {
                Ok(_) => {
                    node_modules_ready = true;
                }
                Err(error) => {
                    missing.push(LocalApiMissingRequirement {
                        key: "node_modules".to_string(),
                        title: "缺少本地依赖".to_string(),
                        detail: error,
                        install_url: None,
                    });
                }
            }
        }
        None => {
            missing.push(LocalApiMissingRequirement {
                key: "project_root".to_string(),
                title: "未找到项目目录".to_string(),
                detail: "无法定位 scripts 目录，请从项目根目录启动 ALLMusic。".to_string(),
                install_url: None,
            });
        }
    }

    let ok = missing.is_empty();
    let summary = if ok {
        "本地 API 运行环境检查通过。".to_string()
    } else {
        format!("检测到 {} 项环境问题，请修复后重试。", missing.len())
    };

    LocalApiEnvironmentInspection {
        check: LocalApiEnvironmentCheckResult {
            ok,
            summary,
            project_root: project_root_display,
            node_modules_ready,
            node,
            python,
            missing,
        },
        python_command,
    }
}

pub(crate) fn spawn_node_script(
    project_root: &Path,
    script_name: &str,
    env_overrides: &[(String, String)],
) -> Result<Child, String> {
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

    if !env_overrides.is_empty() {
        for (key, value) in env_overrides {
            command.env(key, value);
        }
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
        .spawn()
        .map_err(|error| format!("failed to spawn node script: {}", error))
}

fn build_qq_adapter_env_overrides(python_command: &str, venv_dir: &Path) -> Vec<(String, String)> {
    vec![
        (
            "QQ_ADAPTER_PYTHON".to_string(),
            python_command.to_string(),
        ),
        (
            "QQ_ADAPTER_VENV_DIR".to_string(),
            venv_dir.display().to_string(),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qq_adapter_env_overrides_include_venv_dir() {
        let venv_dir = PathBuf::from("C:\\Users\\test\\AppData\\Local\\ALLMusic\\.vendor\\qq-adapter-venv");
        let overrides = build_qq_adapter_env_overrides("python", &venv_dir);
        assert!(
            overrides.iter().any(|(key, _)| key == "QQ_ADAPTER_VENV_DIR"),
            "Expected QQ_ADAPTER_VENV_DIR in env overrides, got: {overrides:?}"
        );
        let resolved = overrides
            .iter()
            .find(|(key, _)| key == "QQ_ADAPTER_VENV_DIR")
            .map(|(_, value)| value)
            .cloned()
            .unwrap_or_default();
        assert!(
            resolved.contains("qq-adapter-venv"),
            "Unexpected QQ_ADAPTER_VENV_DIR value: {resolved}"
        );
    }
}

pub(crate) fn qq_log_stage(line: &str) -> &'static str {
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

pub(crate) fn netease_log_stage(line: &str) -> &'static str {
    let normalized = line.to_ascii_lowercase();
    if normalized.contains("starting neteasecloudmusicapi")
        || normalized.contains("listening")
        || normalized.contains("server run")
    {
        return "netease_starting";
    }
    "netease_log"
}

pub(crate) fn stage_percent(stage: &str, default: u8) -> u8 {
    match stage {
        "prepare" => 5,
        "runtime_check" => 8,
        "runtime_check_ok" => 12,
        "runtime_check_error" => 100,
        "checking_deps" => 10,
        "auto_fix_prepare" => 10,
        "auto_fix_node" => 24,
        "auto_fix_python" => 40,
        "auto_fix_node_modules" => 62,
        "auto_fix_node_modules_fallback" => 72,
        "auto_fix_done" => 100,
        "auto_fix_incomplete" => 100,
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

pub(crate) fn attach_process_log_forwarders(app: &tauri::AppHandle, service: &'static str, child: &mut Child) {
    const STDOUT_STAGE_THROTTLE_MS: u64 = 350;
    const STDERR_LINE_THROTTLE_MS: u64 = 900;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(reader) = stdout {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            let buffered = BufReader::new(reader);
            let mut last_stage = String::new();
            let mut last_line = String::new();
            let mut last_emit_at = Instant::now() - Duration::from_millis(STDOUT_STAGE_THROTTLE_MS);
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
                let now = Instant::now();
                let within_throttle_window =
                    now.duration_since(last_emit_at) < Duration::from_millis(STDOUT_STAGE_THROTTLE_MS);
                let is_critical_stage =
                    stage == "ready" || stage == "error" || stage.ends_with("_ready") || stage.ends_with("_error");
                if !is_critical_stage && within_throttle_window && stage == last_stage {
                    continue;
                }
                if !is_critical_stage && within_throttle_window && line == last_line {
                    continue;
                }

                last_stage.clear();
                last_stage.push_str(stage);
                last_line.clear();
                last_line.push_str(line);
                last_emit_at = now;

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
            let mut last_warning_line = String::new();
            let mut last_warning_emit_at = Instant::now() - Duration::from_millis(STDERR_LINE_THROTTLE_MS);
            for line_result in buffered.lines() {
                let Ok(raw_line) = line_result else {
                    continue;
                };
                let line = raw_line.trim();
                if line.is_empty() {
                    continue;
                }

                let now = Instant::now();
                let duplicate_within_window =
                    line == last_warning_line
                        && now.duration_since(last_warning_emit_at)
                            < Duration::from_millis(STDERR_LINE_THROTTLE_MS);
                if duplicate_within_window {
                    continue;
                }
                last_warning_line.clear();
                last_warning_line.push_str(line);
                last_warning_emit_at = now;

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

pub(crate) fn shutdown_local_services_inner(manager: &mut LocalServiceManager) {
    if let Some(mut child) = manager.netease_child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(mut child) = manager.qq_child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub(crate) fn shutdown_local_services() {
    if let Ok(mut manager) = local_service_manager().lock() {
        shutdown_local_services_inner(&mut manager);
    }
}

pub(crate) fn install_local_service_cleanup_hook() {
    static PANIC_CLEANUP_HOOK: Once = Once::new();

    PANIC_CLEANUP_HOOK.call_once(|| {
        let default_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            shutdown_local_services();
            default_hook(info);
        }));
    });
}

pub(crate) fn ensure_local_api_services_inner(app: tauri::AppHandle) -> Result<String, String> {
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

    let root = resolve_project_root_for_manager(&mut manager).ok_or_else(|| {
        "project root not found. Make sure ALLMusic is started from project workspace.".to_string()
    })?;

    emit_local_api_progress(
        &app,
        "runtime_check",
        None,
        "正在检查 Node / Python 运行环境...",
        stage_percent("runtime_check", 8),
        "info",
    );

    let inspection = inspect_local_api_environment(Some(&root));
    manager.python_command = inspection.python_command.clone();
    if !inspection.check.ok {
        let serialized = serde_json::to_string(&inspection.check).unwrap_or_else(|_| "{}".to_string());
        emit_local_api_progress(
            &app,
            "runtime_check_error",
            None,
            inspection.check.summary.clone(),
            stage_percent("runtime_check_error", 100),
            "error",
        );
        return Err(format!("{}{}", LOCAL_API_ENV_ERROR_PREFIX, serialized));
    }
    let runtime_message = format!(
        "环境检查通过：Node={}，Python={}。",
        inspection
            .check
            .node
            .version
            .clone()
            .unwrap_or_else(|| "unknown".to_string()),
        inspection
            .check
            .python
            .version
            .clone()
            .unwrap_or_else(|| "unknown".to_string())
    );
    emit_local_api_progress(
        &app,
        "runtime_check_ok",
        None,
        runtime_message,
        stage_percent("runtime_check_ok", 12),
        "info",
    );

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
            let mut child =
                spawn_node_script(&root, "start-netease-api.cjs", &Vec::new()).map_err(|error| {
                    emit_local_api_progress(
                        &app,
                        "error",
                        Some("netease"),
                        error.clone(),
                        100,
                        "error",
                    );
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
            let python_command = manager
                .python_command
                .clone()
                .unwrap_or_else(|| "python".to_string());
            let qq_venv_dir = app
                .path()
                .app_local_data_dir()
                .or_else(|_| app.path().app_data_dir())
                .map_err(|error: tauri::Error| format!("failed to resolve app data dir: {}", error))?
                .join(".vendor")
                .join("qq-adapter-venv");
            let env_overrides = build_qq_adapter_env_overrides(python_command.as_str(), &qq_venv_dir);
            let mut child = spawn_node_script(&root, "start-qmusic-adapter.cjs", &env_overrides)
                .map_err(|error| {
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
