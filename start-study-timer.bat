@echo off
REM ============================================================
REM  Inicia o Study Timer:
REM  1. sobe um servidor local na porta 3000 (minimizado)
REM  2. abre o Brave em modo "app" (sem abas/barra de endereço)
REM ============================================================

cd /d "%~dp0"

REM Se a porta 3000 ja estiver em uso (servidor anterior ainda aberto),
REM este comando falha rapido e nao atrapalha - o app abre normalmente.
start "StudyTimerServer" /min cmd /c "python -m http.server 3000"

REM pequena pausa para o servidor subir antes de abrir o navegador
REM (usamos "ping" em vez de "timeout": o timeout pode falhar com erro de
REM  "input redirection" quando o script roda sem console interativo,
REM  o que faz o .bat encerrar antes de abrir o navegador)
ping -n 2 127.0.0.1 >nul

REM abre o Brave em modo "app" (sem abas/barra de endereco)
start "" "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --app=http://localhost:3000/index.html