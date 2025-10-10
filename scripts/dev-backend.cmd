@echo off
setlocal
set "GOCACHE=%~dp0..\.gocache"
set "GOMODCACHE=%~dp0..\.gomodcache"

cd /d "%~dp0.."

if exist memos.exe (
  echo Starting memos.exe on port 8081...
  memos.exe --mode dev --port 8081
) else (
  echo Building and starting via go run on port 8081...
  go run ./bin/memos --mode dev --port 8081
)

endlocal


