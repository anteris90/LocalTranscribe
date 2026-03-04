@echo off
setlocal
powershell -ExecutionPolicy Bypass -File "%~dp0local_test.ps1"
endlocal
