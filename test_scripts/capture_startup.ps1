param(
  [string]$AppExe = "dist/packages/win-unpacked/LocalTranscribe.exe",
  [string]$OutDir = ".\test_output",
  [switch]$NoWait
)

$ErrorActionPreference = 'Stop'

# Ensure script runs from repo root
Set-Location "$PSScriptRoot\.."

$ts = (Get-Date).ToString('yyyyMMdd_HHmmss')
$outDirFull = Resolve-Path -Path $OutDir -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Path -ErrorAction SilentlyContinue
if (-not $outDirFull) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
  $outDirFull = Resolve-Path -Path $OutDir | Select-Object -ExpandProperty Path
}

$userData = Join-Path $outDirFull "user-data-$ts"
New-Item -ItemType Directory -Path $userData -Force | Out-Null

$stdout = Join-Path $outDirFull "localtranscribe_stdout_$ts.txt"
$stderr = Join-Path $outDirFull "localtranscribe_stderr_$ts.txt"

Write-Host "Launching:`n  exe: $AppExe`n  user-data: $userData`n  stdout: $stdout`n  stderr: $stderr"

$args = @("--user-data-dir", $userData, "--enable-logging", "--v=1")

try {
  $proc = Start-Process -FilePath $AppExe -ArgumentList $args -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
} catch {
  Write-Error "Failed to start process: $_"
  exit 2
}

if (-not $NoWait) {
  Write-Host "Waiting for process id $($proc.Id) to exit..."
  Wait-Process -Id $proc.Id
  Write-Host "Process exited. Files written to: $outDirFull"
  Write-Host "-- stdout --"
  if (Test-Path $stdout) { Get-Content $stdout -Raw } else { Write-Host "(no stdout file)" }
  Write-Host "-- stderr --"
  if (Test-Path $stderr) { Get-Content $stderr -Raw } else { Write-Host "(no stderr file)" }
  Write-Host "-- user-data dir listing --"
  dir $userData -Force
} else {
  Write-Host "Started pid $($proc.Id). Not waiting (use -NoWait to background)."
}

Write-Host "Done."
