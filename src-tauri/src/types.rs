use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub(crate) struct LocalApiProgressPayload {
    pub(crate) stage: String,
    pub(crate) service: Option<String>,
    pub(crate) message: String,
    pub(crate) percent: u8,
    pub(crate) level: String,
    pub(crate) timestamp: u64,
}

#[derive(Serialize, Clone)]
pub(crate) struct MediaControlPayload {
    pub(crate) action: String,
    pub(crate) source: String,
    pub(crate) timestamp: u64,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct LocalApiRuntimeStatus {
    pub(crate) name: String,
    pub(crate) command: String,
    pub(crate) available: bool,
    pub(crate) version: Option<String>,
    pub(crate) hint: Option<String>,
    pub(crate) install_url: String,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct LocalApiMissingRequirement {
    pub(crate) key: String,
    pub(crate) title: String,
    pub(crate) detail: String,
    pub(crate) install_url: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct LocalApiEnvironmentCheckResult {
    pub(crate) ok: bool,
    pub(crate) summary: String,
    pub(crate) project_root: Option<String>,
    pub(crate) node_modules_ready: bool,
    pub(crate) node: LocalApiRuntimeStatus,
    pub(crate) python: LocalApiRuntimeStatus,
    pub(crate) missing: Vec<LocalApiMissingRequirement>,
}

#[derive(Debug, Clone)]
pub(crate) struct LocalApiEnvironmentInspection {
    pub(crate) check: LocalApiEnvironmentCheckResult,
    pub(crate) python_command: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub(crate) struct LocalApiAutoFixResult {
    pub(crate) ok: bool,
    pub(crate) summary: String,
    pub(crate) attempted: Vec<String>,
    pub(crate) check: LocalApiEnvironmentCheckResult,
}

#[derive(Clone, Copy)]
pub(crate) struct NetworkSourceOption {
    pub(crate) label: &'static str,
    pub(crate) value: &'static str,
    pub(crate) probe_host: &'static str,
}

/// User data structure
#[derive(Debug, Serialize, Deserialize)]
pub struct AuthUser {
    pub platform: String,
    pub user_id: String,
    pub nickname: String,
    pub avatar_url: String,
    pub is_logged_in: bool,
}

/// Login credentials to store
#[derive(Debug, Serialize, Deserialize)]
pub struct AuthCredentials {
    pub user: AuthUser,
    pub cookie: String,
}

#[derive(Debug, Serialize)]
pub struct AuthStoreProbeResult {
    pub app_data_dir: String,
    pub store_file: String,
    pub store_file_exists: bool,
    pub roundtrip_ok: bool,
    pub previous_probe_found: bool,
}
