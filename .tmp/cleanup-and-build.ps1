$ErrorActionPreference = 'SilentlyContinue'
$Root = 'F:\AI Project\ALLMusic'
$OldDir = Join-Path $Root 'dist-portable'

# Kill any node processes that might lock files
taskkill /F /IM node.exe /T 2>$null
Start-Sleep -Seconds 3

# Force remove old dist-portable
if (Test-Path $OldDir) {
    cmd /c "rmdir /s /q `"$OldDir`"" 2>$null
    Start-Sleep -Seconds 1
}
if (Test-Path $OldDir) {
    Remove-Item $OldDir -Recurse -Force -ErrorAction SilentlyContinue
}

$ErrorActionPreference = 'Stop'

# Assemble portable folder
$Version = '0.1.0'
$OutName = "ALLMusic-${Version}-portable-win64"
$OutDir = Join-Path $Root "dist-portable\$OutName"
$ZipPath = Join-Path $Root "dist-portable\${OutName}.zip"
$ReleaseExe = Join-Path $Root 'src-tauri\target\release\allmusic.exe'

if (-not (Test-Path $ReleaseExe)) {
    throw "Release exe not found: $ReleaseExe"
}

New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
New-Item -ItemType Directory -Path "$OutDir\scripts" -Force | Out-Null

Copy-Item $ReleaseExe "$OutDir\ALLMusic.exe"
Write-Host "  + ALLMusic.exe"

$requiredScripts = @('start-netease-api.cjs', 'start-qmusic-adapter.cjs', 'port-utils.cjs', 'qmusic_adapter_server.py')
foreach ($s in $requiredScripts) {
    $src = Join-Path $Root "scripts\$s"
    if (Test-Path $src) {
        Copy-Item $src "$OutDir\scripts\$s"
        Write-Host "  + scripts\$s"
    }
}

Copy-Item "$Root\package.json" "$OutDir\package.json"
Copy-Item "$Root\package-lock.json" "$OutDir\package-lock.json"
Write-Host "  + package.json, package-lock.json"

# Install production node_modules
Write-Host "`nInstalling production node_modules..."
Push-Location $OutDir
try {
    & npm ci --omit=dev --registry https://registry.npmmirror.com --no-fund --no-audit 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "npm ci failed, falling back to npm install"
        & npm install --omit=dev --registry https://registry.npmmirror.com --no-fund --no-audit 2>&1 | ForEach-Object { Write-Host $_ }
    }
} finally { Pop-Location }

# Create zip
Write-Host "`nCreating zip archive..."
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path $OutDir -DestinationPath $ZipPath -CompressionLevel Optimal

$zipSize = (Get-Item $ZipPath).Length / 1MB
Write-Host "`n=== Done ===" -ForegroundColor Green
Write-Host "Portable zip: $ZipPath"
Write-Host "Size: $([math]::Round($zipSize, 1)) MB"
