@echo off
setlocal
set "PYTHON_EXE=C:\Users\K0000031\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%PYTHON_EXE%" (
  "%PYTHON_EXE%" "%~dp0server.py"
) else (
  py "%~dp0server.py"
)
endlocal
