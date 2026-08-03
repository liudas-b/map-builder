@echo off
title Map Builder server
cd /d "%~dp0"
start "" http://localhost:8420
python server.py
pause
