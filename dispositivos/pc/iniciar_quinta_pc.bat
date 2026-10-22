@echo off
rem Inicia o Quinta-PC em segundo plano (sem janela).
rem Para iniciar junto com o Windows: Win+R, digite shell:startup e
rem coloque um atalho deste arquivo na pasta que abrir.
cd /d "%~dp0"
start "" pythonw quinta_pc.py
