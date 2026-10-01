@echo off
rem Build Azan Malaysia using the .NET Framework 4 C# compiler that ships with Windows.
rem Produces a single portable exe that runs on Windows 7 SP1 and newer.
setlocal
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo .NET Framework 4.x csc.exe not found. Install .NET Framework 4.0+ and retry.
  exit /b 1
)

if not exist out mkdir out

"%CSC%" /nologo /target:winexe /platform:anycpu /out:out\AzanMalaysia.exe /optimize+ ^
  /win32manifest:app.manifest ^
  /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll ^
  src\Program.cs src\Json.cs src\ApiClient.cs src\TimeUtil.cs src\Settings.cs ^
  src\AzanPlayer.cs src\PopupForm.cs src\MainForm.cs src\SelfTest.cs
if errorlevel 1 (
  echo Build FAILED.
  exit /b 1
)

rem Also build a console build used for --selftest output.
"%CSC%" /nologo /target:exe /platform:anycpu /out:out\AzanMalaysia.selftest.exe /optimize+ ^
  /define:SELFTEST_CONSOLE ^
  /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll ^
  src\Program.cs src\Json.cs src\ApiClient.cs src\TimeUtil.cs src\Settings.cs ^
  src\AzanPlayer.cs src\PopupForm.cs src\MainForm.cs src\SelfTest.cs
if errorlevel 1 (
  echo Selftest build FAILED.
  exit /b 1
)

echo.
echo Build OK: out\AzanMalaysia.exe
echo Selftest: out\AzanMalaysia.selftest.exe --selftest
exit /b 0
