$ErrorActionPreference = "Stop"

Set-Location "$PSScriptRoot\.."

& ".\scripts\test-thin-installer-local.ps1" -BuildBackendIfMissing -ResetRuntime
