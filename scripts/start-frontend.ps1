$ErrorActionPreference = 'Stop'
$root = Join-Path -Path $PSScriptRoot -ChildPath '..'
$web = Join-Path -Path $root -ChildPath 'web'
Set-Location -Path $web

# 设置后端代理地址（vite.config.mts 中默认 8081，这里显式一遍便于可控）
$env:DEV_PROXY_SERVER = 'http://localhost:8081'

# 启动 Vite 开发服务器（最小化窗口运行，端口遵循 vite.config.mts → 3001）
$cmd = 'npm run dev'
$proc = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c $cmd" -WorkingDirectory $web -WindowStyle Minimized -PassThru

Start-Sleep -Seconds 3
Write-Output ("FRONTEND_START_ISSUED PID={0}" -f $proc.Id)

