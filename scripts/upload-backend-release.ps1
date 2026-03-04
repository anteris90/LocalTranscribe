param(
  [string]$Repo = "LocalTranscribe/LocalTranscribe",
  [string]$Tag,
  [string]$ArtifactPath = "backend/dist/windows/backend.exe",
  [string]$AssetName = "backend-win-x64.exe",
  [switch]$BuildIfMissing
)

$ErrorActionPreference = "Stop"

Set-Location "$PSScriptRoot\.."

if ([string]::IsNullOrWhiteSpace($Tag)) {
  $package = Get-Content "package.json" -Raw | ConvertFrom-Json
  $Tag = "v$($package.version)"
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  throw "GitHub CLI (gh) is required. Install from https://cli.github.com/"
}

if (-not (Test-Path $ArtifactPath)) {
  if ($BuildIfMissing.IsPresent) {
    & "$PSScriptRoot/build-backend-onefile.ps1"
  } else {
    throw "Artifact not found: $ArtifactPath. Run scripts/build-backend-onefile.ps1 or pass -BuildIfMissing"
  }
}

Write-Host "Uploading $ArtifactPath as $AssetName to $Repo release $Tag"
gh release upload $Tag "$ArtifactPath#$AssetName" --repo $Repo --clobber

Write-Host "Upload complete."