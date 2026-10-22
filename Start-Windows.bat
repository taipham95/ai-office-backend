@echo off
chcp 65001 >nul
title AI Tech Office - Local Server
echo ========================================================
echo         AI TECH OFFICE - KHOI DONG HE THONG LOCAL
echo ========================================================
echo.

cd /d "%~dp0"

:: 1. Kiem tra va tao file .env neu chua co
if not exist ".env" (
    echo [*] Dang tao file .env tu .env.example...
    copy ".env.example" ".env" >nul
    echo [*] Da khoi tao .env thanh cong!
)

:: 2. Kiem tra Node.js tren may
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist ".node\node.exe" (
        set "PATH=%~dp0.node;%PATH%"
    ) else (
        echo [!] Chua tim thay Node.js tren may cua ban.
        echo [*] Dang tu dong tai ban Node.js Portable chinh thuc ve thu muc ung dung...
        echo [*] Qua trinh nay chi dien ra 1 lan duy nhat va KHONG can quyen Admin.
        powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; $url='https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip'; $zip='node.zip'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile($url, $zip); Expand-Archive -Path $zip -DestinationPath .node_temp -Force; Move-Item .node_temp\node-v* .node -Force; Remove-Item $zip, .node_temp -Recurse -Force"
        if exist ".node\node.exe" (
            set "PATH=%~dp0.node;%PATH%"
            echo [*] Cai dat Node.js Portable thanh cong!
        ) else (
            echo [X] Khong the tu dong tai Node.js. Vui long cai dat Node tu: https://nodejs.org
            pause
            exit /b 1
        )
    )
)

:: 3. Tu dong mo trinh duyet toi giao dien Web
echo [*] Dang mo giao dien web tai http://localhost:3000 ...
start http://localhost:3000

:: 4. Khoi dong Backend Server
echo [*] AI Tech Office dang chay tren cong 3000.
echo [*] Dong cua so nay neu muon tat he thong.
echo ========================================================
echo.
node server.js
pause
