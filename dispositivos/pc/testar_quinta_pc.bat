@echo off
rem Modo teste: mostra na janela o que a Quinta-Feira pediu, sem executar nada.
rem Na primeira vez pergunta o topico do PC e cria o config.json.
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (py quinta_pc.py --teste) else (python quinta_pc.py --teste)
pause
