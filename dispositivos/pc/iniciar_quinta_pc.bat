@echo off
rem Inicia o Quinta-PC em segundo plano (sem janela).
rem Para iniciar junto com o Windows: Win+R, digite shell:startup e
rem coloque um atalho deste arquivo na pasta que abrir.
cd /d "%~dp0"
where pyw >nul 2>nul
if %errorlevel%==0 (start "" pyw quinta_pc.py) else (start "" pythonw quinta_pc.py)
