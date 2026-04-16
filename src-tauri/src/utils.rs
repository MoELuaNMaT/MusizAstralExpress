use std::collections::{hash_map::DefaultHasher, HashSet};
use std::hash::{Hash, Hasher};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use regex::Regex;
use tauri::Emitter;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::constants::*;
use crate::types::*;

pub(crate) fn now_timestamp_ms() -> u64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => duration.as_millis().min(u64::MAX as u128) as u64,
        Err(_) => 0,
    }
}

pub(crate) fn emit_local_api_progress(
    app: &tauri::AppHandle,
    stage: &str,
    service: Option<&str>,
    message: impl Into<String>,
    percent: u8,
    level: &str,
) {
    let payload = LocalApiProgressPayload {
        stage: stage.to_string(),
        service: service.map(|value| value.to_string()),
        message: message.into(),
        percent,
        level: level.to_string(),
        timestamp: now_timestamp_ms(),
    };

    let _ = app.emit(LOCAL_API_EVENT_NAME, payload);
}

pub(crate) fn emit_media_control_event<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    action: &str,
    source: &str,
) {
    let payload = MediaControlPayload {
        action: action.to_string(),
        source: source.to_string(),
        timestamp: now_timestamp_ms(),
    };
    let _ = app.emit(MEDIA_CONTROL_EVENT_NAME, payload);
}

pub(crate) fn can_connect_to_port(port: u16) -> bool {
    let loopback = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&loopback, Duration::from_millis(250)).is_ok()
}

pub(crate) fn get_local_api_status_code(port: u16, path: &str) -> Option<u16> {
    let loopback = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = match TcpStream::connect_timeout(&loopback, Duration::from_millis(500)) {
        Ok(stream) => stream,
        Err(_) => return None,
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(500)));

    let request = format!(
        "GET {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\nAccept: application/json\r\n\r\n",
        path, port
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return None;
    }

    let mut buffer = [0_u8; 256];
    let bytes_read = match stream.read(&mut buffer) {
        Ok(bytes) if bytes > 0 => bytes,
        _ => return None,
    };

    let response_head = String::from_utf8_lossy(&buffer[..bytes_read]);
    response_head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|token| token.parse::<u16>().ok())
}

pub(crate) fn can_get_ok_from_local_api(port: u16, path: &str) -> bool {
    matches!(get_local_api_status_code(port, path), Some(200))
}

pub(crate) fn local_api_route_exists(port: u16, path: &str) -> bool {
    matches!(get_local_api_status_code(port, path), Some(status) if status != 404)
}

pub(crate) fn measure_tcp_connect_latency_ms(host: &str, port: u16, timeout: Duration) -> Option<u128> {
    let start = Instant::now();
    let mut addresses = (host, port).to_socket_addrs().ok()?;
    let address = addresses.next()?;
    TcpStream::connect_timeout(&address, timeout).ok()?;
    Some(start.elapsed().as_millis())
}

pub(crate) fn rank_network_sources_by_latency(
    options: &[NetworkSourceOption],
    port: u16,
    timeout: Duration,
) -> Vec<(NetworkSourceOption, Option<u128>)> {
    let mut measured: Vec<(NetworkSourceOption, Option<u128>)> = options
        .iter()
        .map(|option| {
            (
                *option,
                measure_tcp_connect_latency_ms(option.probe_host, port, timeout),
            )
        })
        .collect();

    measured.sort_by(|left, right| match (left.1, right.1) {
        (Some(a), Some(b)) => a.cmp(&b),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });

    measured
}

pub(crate) fn looks_like_project_root(path: &Path) -> bool {
    path.join("scripts").join("start-netease-api.cjs").exists()
        && path.join("scripts").join("start-qmusic-adapter.cjs").exists()
}

pub(crate) fn find_project_root() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let mut cursor = Some(exe_dir.to_path_buf());
            for _ in 0..6 {
                if let Some(path) = cursor {
                    candidates.push(path.clone());
                    cursor = path.parent().map(|parent| parent.to_path_buf());
                } else {
                    break;
                }
            }
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.clone());
        if let Some(parent) = current_dir.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    let mut seen = HashSet::new();
    for candidate in candidates {
        let normalized = candidate.to_string_lossy().to_string();
        if !seen.insert(normalized) {
            continue;
        }

        if looks_like_project_root(&candidate) {
            return Some(candidate);
        }
    }

    None
}

pub(crate) fn extract_command_output_message(output: &std::process::Output) -> Option<String> {
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout.lines().next().map(|line| line.trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr.lines().next().map(|line| line.trim().to_string());
    }

    None
}

pub(crate) fn probe_runtime_command(command: &str, args: &[&str]) -> (bool, Option<String>, Option<String>) {
    let mut runtime_command = Command::new(command);
    runtime_command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        runtime_command.creation_flags(CREATE_NO_WINDOW);
    }

    match runtime_command.output() {
        Ok(output) => {
            if output.status.success() {
                (true, extract_command_output_message(&output), None)
            } else {
                let error = extract_command_output_message(&output).unwrap_or_else(|| {
                    format!(
                        "{} exited with code {}",
                        command,
                        output.status.code().unwrap_or_default()
                    )
                });
                (false, None, Some(error))
            }
        }
        Err(error) => (false, None, Some(error.to_string())),
    }
}

pub(crate) fn run_hidden_command(
    command: &str,
    args: &[&str],
    current_dir: Option<&Path>,
    env_overrides: &[(&str, &str)],
) -> Result<String, String> {
    let mut runtime_command = Command::new(command);
    runtime_command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(dir) = current_dir {
        runtime_command.current_dir(dir);
    }
    if !env_overrides.is_empty() {
        runtime_command.envs(env_overrides.iter().copied());
    }

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        runtime_command.creation_flags(CREATE_NO_WINDOW);
    }

    let output = runtime_command
        .output()
        .map_err(|error| format!("{} failed to start: {}", command, error))?;

    if output.status.success() {
        return Ok(extract_command_output_message(&output)
            .unwrap_or_else(|| format!("{} finished successfully.", command)));
    }

    let code = output.status.code().unwrap_or_default();
    let details = extract_command_output_message(&output)
        .unwrap_or_else(|| format!("{} exited with code {}", command, code));
    Err(details)
}

#[cfg(target_os = "windows")]
pub(crate) fn refresh_windows_runtime_path() {
    let existing = std::env::var("PATH").unwrap_or_default();
    let mut path_items: Vec<String> = existing
        .split(';')
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.to_string())
        .collect();

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        candidates.push(PathBuf::from(program_files).join("nodejs"));
    }

    if let Some(local_app_data) = std::env::var_os("LocalAppData") {
        let python_root = PathBuf::from(local_app_data)
            .join("Programs")
            .join("Python");
        if let Ok(entries) = std::fs::read_dir(python_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    candidates.push(path.clone());
                    candidates.push(path.join("Scripts"));
                }
            }
        }
    }

    for candidate in candidates {
        if !candidate.exists() {
            continue;
        }
        let candidate_value = candidate.to_string_lossy().to_string();
        let exists = path_items
            .iter()
            .any(|item| item.eq_ignore_ascii_case(&candidate_value));
        if !exists {
            path_items.insert(0, candidate_value);
        }
    }

    std::env::set_var("PATH", path_items.join(";"));
}

pub(crate) fn hash_text(value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(crate) fn infer_image_extension_from_url(url: &str) -> Option<&'static str> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let path = parsed.path().to_ascii_lowercase();
    COVER_EXT_CANDIDATES
        .iter()
        .copied()
        .find(|ext| path.ends_with(&format!(".{}", ext)))
}

pub(crate) fn infer_image_extension_from_content_type(content_type: &str) -> Option<&'static str> {
    let normalized = content_type.to_ascii_lowercase();
    if normalized.contains("image/jpeg") || normalized.contains("image/jpg") {
        return Some("jpg");
    }
    if normalized.contains("image/png") {
        return Some("png");
    }
    if normalized.contains("image/webp") {
        return Some("webp");
    }
    if normalized.contains("image/bmp") {
        return Some("bmp");
    }
    if normalized.contains("image/gif") {
        return Some("gif");
    }
    if normalized.contains("image/avif") {
        return Some("avif");
    }
    None
}

pub(crate) fn find_cached_cover_file(cache_dir: &Path, basename: &str) -> Option<PathBuf> {
    COVER_EXT_CANDIDATES
        .iter()
        .map(|ext| cache_dir.join(format!("{}.{}", basename, ext)))
        .find(|candidate| candidate.exists())
}

pub(crate) fn parse_netease_playlist_song_ids(html: &str) -> Vec<String> {
    let list_scope_regex = match Regex::new(
        r#"(?s)<ul class="f-hide">(.*?)</ul>\s*<textarea id="song-list-pre-data""#,
    ) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let scoped_html = list_scope_regex
        .captures(html)
        .and_then(|captures| captures.get(1).map(|matched| matched.as_str()))
        .unwrap_or(html);

    let song_id_regex = match Regex::new(r"/song\?id=(\d+)") {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let mut seen = HashSet::new();
    let mut ordered_song_ids = Vec::new();

    for captures in song_id_regex.captures_iter(scoped_html) {
        let Some(matched) = captures.get(1) else {
            continue;
        };

        let song_id = matched.as_str().to_string();
        if seen.insert(song_id.clone()) {
            ordered_song_ids.push(song_id);
        }
    }

    ordered_song_ids
}

pub(crate) fn normalize_cookie_for_http_request(raw_cookie: &str) -> String {
    let ignored_attrs = [
        "path",
        "domain",
        "expires",
        "max-age",
        "secure",
        "httponly",
        "samesite",
        "priority",
        "version",
        "comment",
    ];

    let mut seen_keys = HashSet::new();
    let mut pairs = Vec::new();

    for segment in raw_cookie.split(';') {
        let trimmed = segment.trim();
        if trimmed.is_empty() || !trimmed.contains('=') {
            continue;
        }

        let mut parts = trimmed.splitn(2, '=');
        let key = parts.next().unwrap_or_default().trim();
        let value = parts.next().unwrap_or_default().trim();
        if key.is_empty() || value.is_empty() {
            continue;
        }

        let key_lower = key.to_ascii_lowercase();
        if ignored_attrs.contains(&key_lower.as_str()) {
            continue;
        }

        if seen_keys.insert(key_lower) {
            pairs.push(format!("{}={}", key, value));
        }
    }

    pairs.join("; ")
}

pub(crate) fn extract_html_title(html: &str) -> String {
    let title_regex = match Regex::new(r"(?is)<title>(.*?)</title>") {
        Ok(value) => value,
        Err(_) => return String::new(),
    };

    let Some(captures) = title_regex.captures(html) else {
        return String::new();
    };
    let Some(matched) = captures.get(1) else {
        return String::new();
    };

    matched
        .as_str()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
