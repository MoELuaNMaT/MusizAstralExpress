<#
.SYNOPSIS
  ALLMusic Windows portable package builder
.DESCRIPTION
  Build Tauri release and assemble a portable zip.
  Portable package reuses src-tauri/vendor.zip so runtime dependencies stay consistent with installer build.
.PARAMETER SkipBuild
  Skip Tauri build, use existing release exe.
#>
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$Version = (Get-Content "$Root\package.json" -Raw | ConvertFrom-Json).version
$OutName = "ALLMusic-${Version}-portable-win64"
$OutDir = Join-Path $Root "dist-portable\$OutName"
$StagingDir = Join-Path $Root "dist-portable\.staging-$OutName"
$ZipPath = Join-Path $Root "dist-portable\${OutName}.zip"
$ReleaseExe = Join-Path $Root "src-tauri\target\release\allmusic.exe"
$VendorZip = Join-Path $Root "src-tauri\vendor.zip"
$NpmCmd = (Get-Command 'npm.cmd' -ErrorAction Stop).Source

Write-Host "`n=== ALLMusic Portable Builder ===" -ForegroundColor Cyan
Write-Host "Version : $Version"
Write-Host "Output  : $OutDir"
Write-Host "Staging : $StagingDir"

# -- Step 1: Build ------------------------------------------------
if (-not $SkipBuild) {
  Write-Host "`n[1/4] Building Tauri release..." -ForegroundColor Yellow
  Push-Location $Root
  try {
    $ErrorActionPreference = 'Continue'
    & $NpmCmd run tauri build 2>&1 | ForEach-Object {
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
if (-not (Test-Path $VendorZip)) {
  throw "vendor.zip not found: $VendorZip`nRun npm run build:vendor first."
}

# -- Step 2: Assemble portable folder -----------------------------
Write-Host "`n[2/4] Assembling portable folder..." -ForegroundColor Yellow

if (Test-Path $StagingDir) { Remove-Item $StagingDir -Recurse -Force }
Expand-Archive -LiteralPath $VendorZip -DestinationPath $StagingDir -Force

Copy-Item $ReleaseExe "$StagingDir\ALLMusic.exe"
Write-Host "  + ALLMusic.exe ($('{0:N1} MB' -f ((Get-Item $ReleaseExe).Length / 1MB)))"
Write-Host "  + vendor runtime extracted"

# -- Step 3: Runtime summary --------------------------------------
Write-Host "`n[3/4] Verifying bundled runtime..." -ForegroundColor Yellow
$nodeExe = Join-Path $StagingDir "runtime\node\node.exe"
$qqAdapterExe = Join-Path $StagingDir "runtime\qq-adapter\ALLMusicQQAdapter.exe"
$neteaseEntry = Join-Path $StagingDir "node_modules\NeteaseCloudMusicApi\app.js"
if (-not (Test-Path $nodeExe)) { throw "Bundled node.exe missing: $nodeExe" }
if (-not (Test-Path $qqAdapterExe)) { throw "Bundled QQ adapter missing: $qqAdapterExe" }
if (-not (Test-Path $neteaseEntry)) { throw "Bundled NeteaseCloudMusicApi missing: $neteaseEntry" }
Write-Host "  + runtime\node\node.exe"
Write-Host "  + runtime\qq-adapter\ALLMusicQQAdapter.exe"
Write-Host "  + node_modules\NeteaseCloudMusicApi\app.js"

# -- Step 4: Zip ---------------------------------------------------
Write-Host "`n[4/4] Creating zip archive..." -ForegroundColor Yellow

if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path $StagingDir -DestinationPath $ZipPath -CompressionLevel Optimal

$deployedToOutput = $false
if (Test-Path $OutDir) {
  try {
    Remove-Item $OutDir -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Warning "Existing output folder is locked and could not be replaced: $OutDir"
  }
}
if (-not (Test-Path $OutDir)) {
  Move-Item -Path $StagingDir -Destination $OutDir
  $deployedToOutput = $true
}

$zipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Portable zip: $ZipPath"
Write-Host "Size: $('{0:N1} MB' -f $zipSize)"
if ($deployedToOutput) {
  Write-Host "Folder: $OutDir"
} else {
  Write-Warning "Staging folder retained because canonical output folder is locked: $StagingDir"
}
Write-Host "`nRecipients need:"
Write-Host "  - Windows 10 1803+ or Windows 11 (for WebView2)"
Write-Host "  - No extra Node/Python install for local API runtime"
Write-Host ""
