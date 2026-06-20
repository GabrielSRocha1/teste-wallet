@echo off
title Verum Compound Engine
cd /d "%~dp0"
echo.
echo  =====================================
echo   VERUM COMPOUND ENGINE
echo  =====================================
echo.
echo  Iniciando servidor em http://localhost:8000
echo  Abrindo navegador...
echo.
echo  (Deixe esta janela aberta enquanto usar.
echo   Para fechar, aperte Ctrl+C aqui.)
echo.
start "" "http://localhost:8000/preview.html"
node serve.js
pause
