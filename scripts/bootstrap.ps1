$ErrorActionPreference = "Stop"

Set-Location "$PSScriptRoot\.."

if (-not (Test-Path "backend/.venv")) {
  python -m venv backend/.venv
}

& "backend/.venv/Scripts/python.exe" -m pip install --upgrade pip
& "backend/.venv/Scripts/python.exe" -m pip install -r backend/requirements.txt

npm install
npm --workspace frontend install
npm --workspace electron install

Write-Host "LocalTranscribe Stage 1 bootstrap complete."
