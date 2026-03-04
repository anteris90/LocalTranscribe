param(
  [string]$AppExe = "dist/packages/win-unpacked/LocalTranscribe.exe",
  [string]$BackendArtifact = "backend/dist/windows/backend.exe",
  [int]$Port = 8765,
  [switch]$BuildBackendIfMissing,
  [switch]$ResetRuntime
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Set-Location "$PSScriptRoot\.."

function Test-FileLocked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )
  if (-not (Test-Path $Path)) {
    return $false
  }

  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    $stream.Close()
    return $false
  } catch {
    return $true
  }
}

function Get-LatestValidFallbackExecutable {
  $fallbackRoots = Get-ChildItem -Path "dist" -Directory -Filter "packages-thin-local-*" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending

  foreach ($root in $fallbackRoots) {
    $candidateExe = Join-Path $root.FullName "win-unpacked\LocalTranscribe.exe"
    $candidateAsar = Join-Path $root.FullName "win-unpacked\resources\app.asar"
    if ((Test-Path $candidateExe) -and (Test-Path $candidateAsar) -and ((Get-Item $candidateAsar).Length -gt 1024)) {
      return $candidateExe
    }
  }

  return $null
}

function Cleanup-OldFallbackPackages {
  param(
    [int]$Keep = 3
  )

  $fallbackRoots = Get-ChildItem -Path "dist" -Directory -Filter "packages-thin-local-*" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending

  if (-not $fallbackRoots -or $fallbackRoots.Count -le $Keep) {
    return
  }

  $toRemove = $fallbackRoots | Select-Object -Skip $Keep
  foreach ($dir in $toRemove) {
    try {
      Remove-Item $dir.FullName -Recurse -Force -ErrorAction Stop
      Write-Host "Removed old fallback package: $($dir.FullName)"
    } catch {
      Write-Host "Skipping cleanup for locked fallback package: $($dir.FullName)"
    }
  }
}

function Ensure-ValidAppPackage {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
  )

  $exeExists = Test-Path $ExecutablePath
  $asarPath = Join-Path (Split-Path $ExecutablePath -Parent) "resources\app.asar"
  $asarLength = if (Test-Path $asarPath) { (Get-Item $asarPath).Length } else { 0 }

  if ($exeExists -and $asarLength -gt 1024) {
    return $ExecutablePath
  }

  $latestFallbackExe = Get-LatestValidFallbackExecutable
  if ($latestFallbackExe) {
    Write-Host "Using existing fallback app package: $latestFallbackExe"
    return $latestFallbackExe
  }

  Write-Host "App package missing or invalid (app.asar size: $asarLength). Rebuilding unpacked Electron app..."
  npm --workspace frontend run build | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to build frontend workspace"
  }

  npm --workspace electron run build | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to build Electron workspace"
  }

  $defaultAsarLocked = Test-FileLocked -Path $asarPath
  $defaultPackFailed = $false

  if ($defaultAsarLocked) {
    Write-Host "Default package output is locked; using fallback output directory..."
    $defaultPackFailed = $true
  } else {
    npm --workspace electron run pack:dir | Out-Host
    if ($LASTEXITCODE -ne 0) {
      $defaultPackFailed = $true
    }
  }

  if ($defaultPackFailed) {
    if (-not $defaultAsarLocked) {
      Write-Host "Default pack failed; attempting fallback output directory..."
    }

    $fallbackOut = "dist/packages-thin-local-$(Get-Date -Format 'yyyyMMdd_HHmmss')"

    $builderCmdPath = Resolve-Path ".\\node_modules\\.bin\\electron-builder.cmd" -ErrorAction SilentlyContinue
    if (-not $builderCmdPath) {
      throw "electron-builder binary not found at .\\node_modules\\.bin\\electron-builder.cmd"
    }

    $builderCmd = $builderCmdPath.Path
    & $builderCmd --dir --projectDir .\electron --config electron-builder.json --config.directories.output=../$fallbackOut | Out-Host
    $fallbackExit = $LASTEXITCODE
    if ($fallbackExit -ne 0) {
      throw "Failed to pack Electron app directory (fallback exit code $fallbackExit)"
    }

    $fallbackExe = "$fallbackOut/win-unpacked/LocalTranscribe.exe"
    if (-not (Test-Path $fallbackExe)) {
      throw "Fallback app executable not found at $fallbackExe"
    }

    $fallbackAsar = "$fallbackOut/win-unpacked/resources/app.asar"
    if (-not (Test-Path $fallbackAsar) -or (Get-Item $fallbackAsar).Length -le 1024) {
      throw "Fallback packaged app is invalid (app.asar at $fallbackAsar)"
    }

    return $fallbackExe
  }

  if (-not (Test-Path $ExecutablePath)) {
    throw "App executable not found at $ExecutablePath after repack"
  }

  if (-not (Test-Path $asarPath) -or (Get-Item $asarPath).Length -le 1024) {
    throw "Packaged app is still invalid after repack (app.asar at $asarPath)"
  }

  return $ExecutablePath
}

$AppExe = Ensure-ValidAppPackage -ExecutablePath $AppExe

if (-not (Test-Path $AppExe)) {
  throw "App executable not found at $AppExe"
}

Cleanup-OldFallbackPackages -Keep 3

if (-not (Test-Path $BackendArtifact)) {
  if ($BuildBackendIfMissing.IsPresent) {
    & "$PSScriptRoot/build-backend-onefile.ps1"
  } else {
    throw "Backend artifact not found at $BackendArtifact. Run scripts/build-backend-onefile.ps1 or pass -BuildBackendIfMissing"
  }
}

$runtimeRoot = Join-Path $env:APPDATA "localtranscribe-electron\runtime"
if ($ResetRuntime.IsPresent -and (Test-Path $runtimeRoot)) {
  Get-Process -Name "backend" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 250
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

  # Capture app stdout/stderr for diagnostics and wait for GUI process explicitly
  $outStd = Join-Path $tempDir "localtranscribe_app_stdout.txt"
  $outErr = Join-Path $tempDir "localtranscribe_app_stderr.txt"

  Write-Host "Launching app and capturing stdout/stderr to:`n  $outStd`n  $outErr"

  $appProcess = Start-Process -FilePath $AppExe -RedirectStandardOutput $outStd -RedirectStandardError $outErr -PassThru
  Wait-Process -Id $appProcess.Id
  $exit = $appProcess.ExitCode
  if ($null -eq $exit) {
    Write-Host "App exited with code: (unknown)"
  } else {
    Write-Host "App exited with code: $exit"
  }
}
finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
  }
}