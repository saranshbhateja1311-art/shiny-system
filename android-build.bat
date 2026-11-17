@echo off
setlocal
cd /d "%~dp0"
if not exist node_modules (
  echo Installing Capacitor dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)
if not exist android (
  echo Creating Android project...
  call npx cap add android
  if errorlevel 1 exit /b 1
)
call npx cap sync android
if errorlevel 1 exit /b 1
cd android
call gradlew.bat assembleDebug
if errorlevel 1 exit /b 1
cd ..
echo.
echo APK created at:
echo android\app\build\outputs\apk\debug\app-debug.apk
endlocal
