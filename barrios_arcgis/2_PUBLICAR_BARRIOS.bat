@echo off
title SIGER - Publicar barrios en la pagina
echo Antes de continuar: en ArcMap usa Editor - Guardar edicion (Save Edits).
pause
node "%~dp0herramientas\publicar_barrios.cjs"
echo.
pause
