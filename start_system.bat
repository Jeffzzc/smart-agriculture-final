@echo off
setlocal

title Smart Agriculture System Launcher

pushd "%~dp0"

echo ===================================================
echo       Smart Agriculture System Launcher
echo ===================================================
echo.

echo [1/3] Starting Backend Server...
where node >nul 2>&1 || (echo Node.js not found. Install Node.js LTS first. & pause & exit /b 1)
if not exist "backend\node_modules" (
    echo Installing backend dependencies...
    call cd backend && npm install && cd ..
)
start "Backend Server (Port 3000/1883)" cmd /k "cd backend && npm start"

echo Waiting for backend ports (1883/3000)...
powershell -NoProfile -Command "$ok=$true; foreach($p in 1883,3000){$ready=$false; for($i=0;$i -lt 30;$i++){ if((Test-NetConnection 127.0.0.1 -Port $p).TcpTestSucceeded){$ready=$true; break}; Start-Sleep -Seconds 1}; if(-not $ready){Write-Host \"Port $p not ready\"; $ok=$false}}; if($ok){exit 0}else{exit 1}"
if errorlevel 1 (
    echo Backend did not start correctly. Check the Backend window for errors.
    pause
    exit /b 1
)

echo [2/3] Starting Sensor Simulators...
where python >nul 2>&1 || (echo Python not found. Install Python 3.10+ first. & pause & exit /b 1)
if not exist "simulator\.venv\Scripts\python.exe" (
    echo Creating simulator virtual environment...
    call cd simulator && python -m venv .venv && .\.venv\Scripts\pip install -r requirements.txt && cd ..
) else (
    if not exist "simulator\.venv\Lib\site-packages\paho" (
        echo Installing simulator dependencies...
        call cd simulator && .\.venv\Scripts\pip install -r requirements.txt && cd ..
    )
)
start "IoT Simulator" cmd /k "cd simulator && .venv\Scripts\python run_simulators.py --mqtt-host 127.0.0.1 --mqtt-port 1883 --time-scale 60"

echo [3/3] Starting Frontend Dashboard...
if not exist "frontend\node_modules" (
    echo Installing frontend dependencies...
    call cd frontend && npm install && cd ..
)
start "Frontend Dashboard (Port 5173)" cmd /k "cd frontend && npm run dev"

echo.
echo ===================================================
echo    All systems started!
echo    Frontend should open at: http://localhost:5173
echo ===================================================
echo.
pause

popd
