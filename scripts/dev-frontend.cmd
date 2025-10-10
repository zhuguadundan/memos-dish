@echo off
setlocal
pushd "%~dp0..\web"

echo Using npm to install and start dev server...
call npm install
call npm run dev

popd
endlocal



