<#
.SYNOPSIS
  ALLMusic Windows portable package builder
.DESCRIPTION
  Build Tauri release and assemble a portable zip.
  Prerequisites: Node.js, Rust toolchain, npm deps installed.
.PARAMETER SkipBuild
  Skip Tauri build, use existing release exe.
.PARAMETER IncludeNodeModules
  Bundle node_modules (faster first launch, larger package).
  Default: true. Pass -IncludeNodeModules:$false to disable.
#>
param(
  [switch]$SkipBuild,
  [bool]$IncludeNodeModules = $true
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Version = (Get-Content "$Root\package.json" -Raw | ConvertFrom-Json).version
$OutName = "ALLMusic-${Version}-portable-win64"
$OutDir = Join-Path $Root "dist-portable\$OutName"
$ZipPath = Join-Path $Root "dist-portable\${OutName}.zip"
$ReleaseExe = Join-Path $Root "src-tauri\target\release\allmusic.exe"

Write-Host "`n=== ALLMusic Portable Builder ===" -ForegroundColor Cyan
Write-Host "Version : $Version"
Write-Host "Output  : $OutDir"

# -- Step 1: Build ------------------------------------------------
if (-not $SkipBuild) {
  Write-Host "`n[1/4] Building Tauri release..." -ForegroundColor Yellow
  Push-Location $Root
  try {
    $ErrorActionPreference = 'Continue'
    & npm run tauri build 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) {
        Write-Host $_.ToString() -ForegroundColor DarkGray
      } else {
        Write-Host $_
      }
    }
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw "Tauri build failed (exit $LASTEXITCODE)" }
  } finally { Pop-Location }
} else {
  Write-Host "`n[1/4] Skipping build (using existing exe)" -ForegroundColor DarkGray
}

if (-not (Test-Path $ReleaseExe)) {
  throw "Release exe not found: $ReleaseExe`nRun without -SkipBuild first."
}

# -- Step 2: Assemble portable folder -----------------------------
Write-Host "`n[2/4] Assembling portable folder..." -ForegroundColor Yellow

if (Test-Path $OutDir) { Remove-Item $OutDir -Recurse -Force }
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
New-Item -ItemType Directory -Path "$OutDir\scripts" -Force | Out-Null

Copy-Item $ReleaseExe "$OutDir\ALLMusic.exe"
Write-Host "  + ALLMusic.exe ($('{0:N1} MB' -f ((Get-Item $ReleaseExe).Length / 1MB)))"

# Required script files for local API services
$requiredScripts = @('start-netease-api.cjs', 'start-qmusic-adapter.cjs', 'port-utils.cjs', 'qmusic_adapter_server.py')
foreach ($s in $requiredScripts) {
  $src = Join-Path $Root "scripts\$s"
  if (Test-Path $src) {
    Copy-Item $src "$OutDir\scripts\$s"
    Write-Host "  + scripts\$s"
  } else {
    Write-Warning "Missing script: $src"
  }
}

Copy-Item "$Root\package.json" "$OutDir\package.json"
Copy-Item "$Root\package-lock.json" "$OutDir\package-lock.json"
Write-Host "  + package.json, package-lock.json"

# -- Step 3: node_modules -----------------------------------------
if ($IncludeNodeModules) {
  Write-Host "`n[3/4] Installing production node_modules..." -ForegroundColor Yellow
  Push-Location $OutDir
  try {
    $ErrorActionPreference = 'Continue'
    & npm ci --omit=dev --registry https://registry.npmmirror.com --no-fund --no-audit 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "npm ci failed, falling back to npm install"
      & npm install --omit=dev --registry https://registry.npmmirror.com --no-fund --no-audit 2>&1 | ForEach-Object { Write-Host $_ }
    }
    $ErrorActionPreference = 'Stop'
    $nmSize = (Get-ChildItem "$OutDir\node_modules" -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host "  + node_modules ($('{0:N1} MB' -f $nmSize))"
  } finally { Pop-Location }
} else {
  Write-Host "`n[3/4] Skipping node_modules (will auto-install on first launch)" -ForegroundColor DarkGray
}

# -- Step 4: Zip ---------------------------------------------------
Write-Host "`n[4/4] Creating zip archive..." -ForegroundColor Yellow

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path $OutDir -DestinationPath $ZipPath -CompressionLevel Optimal

$zipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Portable zip: $ZipPath"
Write-Host "Size: $('{0:N1} MB' -f $zipSize)"
Write-Host "`nRecipients need:"
Write-Host "  - Windows 10 1803+ or Windows 11 (for WebView2)"
Write-Host "  - Internet on first launch (auto-installs Node/Python via winget)"
Write-Host ""
