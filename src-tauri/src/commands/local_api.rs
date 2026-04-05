use std::collections::HashSet;
use std::time::Duration;

use crate::constants::*;
use crate::services::*;
use crate::types::*;
use crate::utils::*;

#[tauri::command]
pub(crate) fn check_local_api_environment() -> Result<LocalApiEnvironmentCheckResult, String> {
    let manager_mutex = local_service_manager();
    let mut manager = manager_mutex
        .lock()
        .map_err(|_| "failed to lock local service manager".to_string())?;
    clean_exited_processes(&mut manager);

    let project_root = resolve_project_root_for_manager(&mut manager);
    let inspection = inspect_local_api_environment(project_root.as_deref());
    manager.python_command = inspection.python_command.clone();

    Ok(inspection.check)
}

#[tauri::command]
pub(crate) fn install_local_api_requirements(
    app: tauri::AppHandle,
) -> Result<LocalApiAutoFixResult, String> {
    emit_local_api_progress(
        &app,
        "auto_fix_prepare",
        None,
        "正在准备自动修复本地依赖...",
        stage_percent("auto_fix_prepare", 10),
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

    let inspection_before = inspect_local_api_environment(Some(&root));
    manager.python_command = inspection_before.python_command.clone();
    if inspection_before.check.ok {
        let result = LocalApiAutoFixResult {
            ok: true,
            summary: "当前环境已满足要求，无需自动修复。".to_string(),
            attempted: Vec::new(),
            check: inspection_before.check,
        };
        return Ok(result);
    }

    let missing_keys: HashSet<String> = inspection_before
        .check
        .missing
        .iter()
        .map(|item| item.key.clone())
        .collect();
    let mut attempted = Vec::new();

    if missing_keys.contains("node") || missing_keys.contains("python") {
        #[cfg(target_os = "windows")]
        {
            let (winget_available, _, _) = probe_runtime_command("winget", &["--version"]);
            if !winget_available {
                return Err(
                    "检测到缺少 Node/Python，但系统未找到 winget。请先安装 winget 或手动安装运行环境。"
                        .to_string(),
                );
            }

            if missing_keys.contains("node") {
                emit_local_api_progress(
                    &app,
                    "auto_fix_node",
                    Some("netease"),
                    "正在自动安装 Node.js（国内网络环境可能需要等待更久）...",
                    stage_percent("auto_fix_node", 20),
                    "info",
                );
                run_hidden_command(
                    "winget",
                    &[
                        "install",
                        "--id",
                        WINGET_NODE_ID,
                        "-e",
                        "--accept-package-agreements",
                        "--accept-source-agreements",
                        "--disable-interactivity",
                    ],
                    None,
                    &[],
                )
                .map_err(|error| format!("自动安装 Node.js 失败：{}", error))?;
                attempted.push("node".to_string());
            }

            if missing_keys.contains("python") {
                emit_local_api_progress(
                    &app,
                    "auto_fix_python",
                    Some("qq"),
                    "正在自动安装 Python（国内网络环境可能需要等待更久）...",
                    stage_percent("auto_fix_python", 36),
                    "info",
                );
                run_hidden_command(
                    "winget",
                    &[
                        "install",
                        "--id",
                        WINGET_PYTHON_ID,
                        "-e",
                        "--accept-package-agreements",
                        "--accept-source-agreements",
                        "--disable-interactivity",
                    ],
                    None,
                    &[],
                )
                .map_err(|error| format!("自动安装 Python 失败：{}", error))?;
                attempted.push("python".to_string());
            }

            refresh_windows_runtime_path();
        }

        #[cfg(not(target_os = "windows"))]
        {
            return Err(
                "当前自动安装仅支持 Windows。请先手动安装 Node.js 与 Python，再点击重试。"
                    .to_string(),
            );
        }
    }

    let inspection_after_runtime = inspect_local_api_environment(Some(&root));
    manager.python_command = inspection_after_runtime.python_command.clone();
    let should_install_node_modules = inspection_after_runtime
        .check
        .missing
        .iter()
        .any(|item| item.key == "node_modules");

    if should_install_node_modules {
        let npm_registry_options = [
            NetworkSourceOption {
                label: "mirror",
                value: NPM_REGISTRY_CN,
                probe_host: "registry.npmmirror.com",
            },
            NetworkSourceOption {
                label: "official",
                value: NPM_REGISTRY_DEFAULT,
                probe_host: "registry.npmjs.org",
            },
        ];
        let ranked_npm_sources = rank_network_sources_by_latency(
            &npm_registry_options,
            443,
            Duration::from_millis(2200),
        );
        let primary_npm_source = ranked_npm_sources
            .first()
            .map(|(option, latency)| match latency {
                Some(ms) => format!("{} (~{}ms)", option.label, ms),
                None => option.label.to_string(),
            })
            .unwrap_or_else(|| "mirror".to_string());

        emit_local_api_progress(
            &app,
            "auto_fix_node_modules",
            Some("netease"),
            format!(
                "Installing npm dependencies, preferred source by latency: {}.",
                primary_npm_source
            ),
            stage_percent("auto_fix_node_modules", 62),
            "info",
        );

        let mut install_success = false;
        let mut install_errors: Vec<String> = Vec::new();
        for (index, (source, _latency)) in ranked_npm_sources.iter().enumerate() {
            if index > 0 {
                emit_local_api_progress(
                    &app,
                    "auto_fix_node_modules_fallback",
                    Some("netease"),
                    format!(
                        "Retrying npm install with {} ({})...",
                        source.label, source.value
                    ),
                    stage_percent("auto_fix_node_modules_fallback", 72),
                    "warn",
                );
            }

            let install_result = run_hidden_command(
                NPM_COMMAND,
                &[
                    "install",
                    "--registry",
                    source.value,
                    "--no-fund",
                    "--no-audit",
                ],
                Some(&root),
                &[],
            );
            match install_result {
                Ok(_) => {
                    install_success = true;
                    break;
                }
                Err(error) => {
                    install_errors
                        .push(format!("{} ({}): {}", source.label, source.value, error));
                }
            }
        }

        if !install_success {
            let detail = if install_errors.is_empty() {
                "unknown error".to_string()
            } else {
                install_errors.join(" | ")
            };
            return Err(format!("failed to install node_modules: {}", detail));
        }
        attempted.push("node_modules".to_string());
    }

    let inspection_after = inspect_local_api_environment(Some(&root));
    manager.python_command = inspection_after.python_command.clone();
    let check_result = inspection_after.check;
    let ok = check_result.ok;
    let summary = if ok {
        "自动修复完成，本地依赖检查通过。".to_string()
    } else {
        format!(
            "自动修复已执行，但仍有 {} 项问题，请按提示手动处理。",
            check_result.missing.len()
        )
    };

    emit_local_api_progress(
        &app,
        if ok {
            "auto_fix_done"
        } else {
            "auto_fix_incomplete"
        },
        None,
        summary.clone(),
        stage_percent(
            if ok {
                "auto_fix_done"
            } else {
                "auto_fix_incomplete"
            },
            100,
        ),
        if ok { "info" } else { "warn" },
    );

    Ok(LocalApiAutoFixResult {
        ok,
        summary,
        attempted,
        check: check_result,
    })
}

#[tauri::command]
pub(crate) async fn ensure_local_api_services(
    app: tauri::AppHandle,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ensure_local_api_services_inner(app))
        .await
        .map_err(|error| format!("failed to join local api bootstrap task: {}", error))?
}

#[tauri::command]
pub(crate) fn shutdown_local_api_services() -> Result<(), String> {
    let manager_mutex = local_service_manager();
    let mut manager = manager_mutex
        .lock()
        .map_err(|_| "failed to lock local service manager".to_string())?;

    shutdown_local_services_inner(&mut manager);
    Ok(())
}
