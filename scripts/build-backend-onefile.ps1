$ErrorActionPreference = "Stop"

Set-Location "$PSScriptRoot\.."

if (-not (Test-Path "backend/.venv/Scripts/python.exe")) {
  throw "Backend venv not found. Run scripts/bootstrap.ps1 first."
}

& "backend/.venv/Scripts/python.exe" -m PyInstaller --onefile --name backend --distpath backend/dist/windows --workpath backend/build/windows --specpath backend/build/windows --paths backend backend/app/main.py

if (-not (Test-Path "backend/dist/windows/backend.exe")) {
  throw "Expected backend artifact not found at backend/dist/windows/backend.exe"
}

Write-Host "Built backend onefile artifact: backend/dist/windows/backend.exe"