param(
  [string]$AppExe = "dist/packages/win-unpacked/LocalTranscribe.exe",
  [string]$BackendArtifact = "backend/dist/windows/backend.exe",
  [int]$Port = 8765,
  [switch]$BuildBackendIfMissing,
  [switch]$ResetRuntime
)

$ErrorActionPreference = "Stop"

Set-Location "$PSScriptRoot\.."

if (-not (Test-Path $AppExe)) {
  throw "App executable not found at $AppExe. Build at least once with npm --workspace electron run pack:dir"
}

if (-not (Test-Path $BackendArtifact)) {
  if ($BuildBackendIfMissing.IsPresent) {
    & "$PSScriptRoot/build-backend-onefile.ps1"
  } else {
    throw "Backend artifact not found at $BackendArtifact. Run scripts/build-backend-onefile.ps1 or pass -BuildBackendIfMissing"
  }
}

$runtimeRoot = Join-Path $env:APPDATA "localtranscribe-electron\runtime"
if ($ResetRuntime.IsPresent -and (Test-Path $runtimeRoot)) {
  Remove-Item $runtimeRoot -Recurse -Force
  Write-Host "Reset runtime cache: $runtimeRoot"
}

$tempDir = Join-Path $env:TEMP "localtranscribe-bootstrap-test"
if (Test-Path $tempDir) {
  Remove-Item $tempDir -Recurse -Force
}
New-Item -ItemType Directory -Path $tempDir | Out-Null

$servedBackend = Join-Path $tempDir "backend-win-x64.exe"
Copy-Item $BackendArtifact $servedBackend -Force

$server = Start-Process -FilePath "python" -ArgumentList @("-m", "http.server", "$Port", "--bind", "127.0.0.1") -WorkingDirectory $tempDir -PassThru

try {
  Start-Sleep -Seconds 1

  $env:LOCALTRANSCRIBE_BACKEND_URL = "http://127.0.0.1:$Port/backend-win-x64.exe"
  Write-Host "Using LOCALTRANSCRIBE_BACKEND_URL=$env:LOCALTRANSCRIBE_BACKEND_URL"

  $appProcess = Start-Process -FilePath $AppExe -PassThru
  Wait-Process -Id $appProcess.Id
}
finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
  }
}