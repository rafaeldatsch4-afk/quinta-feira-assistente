"""Quinta-PC: executa no computador as ações pedidas à Quinta-Feira.

Fica escutando um tópico do ntfy (https://ntfy.sh). Quando o agente do n8n publica
uma mensagem como "abrir_app|spotify", o script executa a ação correspondente.

Segurança: só ações desta lista são aceitas, e apps/comandos só os que você
cadastrou no config.json. Nada que venha da IA é executado como comando livre.

Uso:
    python quinta_pc.py            # executa as ações
    python quinta_pc.py --teste    # só mostra o que faria, sem executar

Na primeira vez ele pergunta o tópico e cria o config.json sozinho.
"""

import json
import os
import platform
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import webbrowser
from datetime import datetime

PASTA = os.path.dirname(os.path.abspath(__file__))
SISTEMA = platform.system()  # "Windows", "Darwin" (Mac) ou "Linux"
TESTE = "--teste" in sys.argv

# Mensagens mais velhas que isso são ignoradas (ex.: PC estava desligado
# e não deve "desligar" ao ligar de novo por causa de um pedido antigo).
IDADE_MAXIMA_S = 120


def log(texto):
    linha = f"[{datetime.now():%H:%M:%S}] {texto}"
    print(linha, flush=True)
    try:
        with open(os.path.join(PASTA, "quinta_pc.log"), "a", encoding="utf-8") as f:
            f.write(linha + "\n")
    except OSError:
        pass


def normalizar(texto):
    texto = unicodedata.normalize("NFD", str(texto)).encode("ascii", "ignore").decode()
    return texto.lower().strip()


def criar_config(caminho):
    """Na primeira vez, pergunta o tópico e cria o config.json a partir do exemplo."""
    print("Primeira vez por aqui: vou criar o config.json.")
    try:
        topico = input("Cole aqui o tópico do PC e aperte Enter: ")
    except EOFError:  # aberto sem janela (pythonw): não dá para perguntar
        sys.exit("Rode primeiro o testar_quinta_pc.bat para cadastrar o tópico.")
    topico = "".join(c for c in topico.strip().rstrip(".") if c.isascii() and (c.isalnum() or c in "-_"))
    if len(topico) < 8:
        sys.exit("Tópico inválido. Rode de novo e cole o tópico completo (ex.: quinta-abc123-pc).")
    with open(os.path.join(PASTA, "config.exemplo.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    cfg["topico"] = topico
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    print(f"Pronto! Tópico salvo em {caminho}")


def carregar_config():
    caminho = os.path.join(PASTA, "config.json")
    if not os.path.exists(caminho):
        criar_config(caminho)
    with open(caminho, encoding="utf-8") as f:
        cfg = json.load(f)
    if not cfg.get("topico") or "TROQUE" in cfg["topico"]:
        sys.exit("Defina um tópico secreto em config.json (campo \"topico\").")
    cfg.setdefault("servidor", "https://ntfy.sh")
    cfg["apps"] = {normalizar(k): v for k, v in cfg.get("apps", {}).items()}
    cfg["comandos"] = {normalizar(k): v for k, v in cfg.get("comandos", {}).items()}
    return cfg


# ---------------------------------------------------------------- execução


def rodar(comando, shell=False):
    """Roda um comando sem esperar terminar (ou só mostra, no modo teste)."""
    if TESTE:
        log(f"  (teste) executaria: {comando}")
        return
    subprocess.Popen(comando, shell=shell)


def tecla(codigo, vezes=1):
    """Aperta uma tecla de mídia/volume no Windows."""
    if TESTE:
        log(f"  (teste) tecla 0x{codigo:X} x{vezes}")
        return
    import ctypes

    for _ in range(vezes):
        ctypes.windll.user32.keybd_event(codigo, 0, 0, 0)
        ctypes.windll.user32.keybd_event(codigo, 0, 2, 0)  # 2 = soltar
        time.sleep(0.02)


VK = {"mudo": 0xAD, "menos": 0xAE, "mais": 0xAF, "proxima": 0xB0, "anterior": 0xB1, "tocar": 0xB3}


def numero(valor, padrao):
    try:
        return max(1, int(float(str(valor).replace(",", "."))))
    except (TypeError, ValueError):
        return padrao


def volume(direcao, valor):
    passos = numero(valor, 5)  # cada passo ~2% no Windows
    if SISTEMA == "Windows":
        tecla(VK[direcao], 1 if direcao == "mudo" else passos)
    elif SISTEMA == "Darwin":
        script = {
            "mais": f"set volume output volume ((output volume of (get volume settings)) + {passos * 2})",
            "menos": f"set volume output volume ((output volume of (get volume settings)) - {passos * 2})",
            "mudo": "set volume output muted not (output muted of (get volume settings))",
        }[direcao]
        rodar(["osascript", "-e", script])
    else:
        arg = {"mais": f"+{passos * 2}%", "menos": f"-{passos * 2}%"}.get(direcao)
        if arg:
            rodar(["pactl", "set-sink-volume", "@DEFAULT_SINK@", arg])
        else:
            rodar(["pactl", "set-sink-mute", "@DEFAULT_SINK@", "toggle"])


def midia(qual):
    if SISTEMA == "Windows":
        tecla(VK[qual])
    elif SISTEMA == "Linux" and shutil.which("playerctl"):
        rodar(["playerctl", {"tocar": "play-pause", "proxima": "next", "anterior": "previous"}[qual]])
    else:
        log("  controle de mídia não suportado neste sistema")


def abrir_site(valor):
    url = str(valor).strip()
    if not url:
        return log("  faltou o endereço do site")
    esquema = urllib.parse.urlparse(url).scheme.lower()
    if not esquema or "." in esquema:  # "youtube.com" ou "site.com:8080"
        url = "https://" + url
    elif esquema not in ("http", "https"):
        return log(f"  endereço recusado (só http/https): {url}")
    log(f"  abrindo {url}")
    if not TESTE:
        webbrowser.open(url)


def abrir_app(cfg, valor):
    nome = normalizar(valor)
    comando = cfg["apps"].get(nome)
    if not comando:
        conhecidos = ", ".join(cfg["apps"]) or "nenhum"
        return log(f"  app \"{valor}\" não cadastrado no config.json (cadastrados: {conhecidos})")
    log(f"  abrindo app {nome}")
    caminho = os.path.expandvars(comando)  # resolve %APPDATA%, %LOCALAPPDATA%...
    if SISTEMA == "Windows" and not TESTE and os.path.exists(caminho):
        os.startfile(caminho)  # atalho .lnk, .exe ou arquivo
    else:
        rodar(comando, shell=True)


def comando_personalizado(cfg, valor):
    nome = normalizar(valor)
    comando = cfg["comandos"].get(nome)
    if not comando:
        conhecidos = ", ".join(cfg["comandos"]) or "nenhum"
        return log(f"  comando \"{valor}\" não cadastrado (cadastrados: {conhecidos})")
    log(f"  rodando comando {nome}")
    rodar(comando, shell=True)


def energia(acao, valor):
    minutos = numero(valor, 1)
    if SISTEMA == "Windows":
        cmd = {
            "desligar": ["shutdown", "/s", "/t", str(minutos * 60)],
            "reiniciar": ["shutdown", "/r", "/t", str(minutos * 60)],
            "cancelar": ["shutdown", "/a"],
        }[acao]
    elif SISTEMA == "Darwin":
        cmd = {
            "desligar": ["osascript", "-e", 'tell app "System Events" to shut down'],
            "reiniciar": ["osascript", "-e", 'tell app "System Events" to restart'],
            "cancelar": None,
        }[acao]
    else:
        cmd = {
            "desligar": ["shutdown", "-h", f"+{minutos}"],
            "reiniciar": ["shutdown", "-r", f"+{minutos}"],
            "cancelar": ["shutdown", "-c"],
        }[acao]
    if cmd is None:
        return log("  não suportado neste sistema")
    log(f"  {acao} ({minutos} min)" if acao != "cancelar" else "  cancelando desligamento")
    rodar(cmd)


def bloquear():
    log("  bloqueando a tela")
    if SISTEMA == "Windows":
        if not TESTE:
            import ctypes

            ctypes.windll.user32.LockWorkStation()
    elif SISTEMA == "Darwin":
        rodar(["pmset", "displaysleepnow"])
    else:
        rodar(["loginctl", "lock-session"])


def executar(cfg, acao, valor):
    acao = normalizar(acao)
    acoes = {
        "abrir_site": lambda: abrir_site(valor),
        "pesquisar": lambda: abrir_site("https://www.google.com/search?q=" + urllib.parse.quote(str(valor))),
        "youtube": lambda: abrir_site("https://www.youtube.com/results?search_query=" + urllib.parse.quote(str(valor))),
        "abrir_app": lambda: abrir_app(cfg, valor),
        "comando": lambda: comando_personalizado(cfg, valor),
        "volume_mais": lambda: volume("mais", valor),
        "volume_menos": lambda: volume("menos", valor),
        "mudo": lambda: volume("mudo", valor),
        "midia_tocar_pausar": lambda: midia("tocar"),
        "midia_proxima": lambda: midia("proxima"),
        "midia_anterior": lambda: midia("anterior"),
        "bloquear": bloquear,
        "desligar": lambda: energia("desligar", valor),
        "reiniciar": lambda: energia("reiniciar", valor),
        "cancelar_desligamento": lambda: energia("cancelar", valor),
    }
    if acao not in acoes:
        return log(f"  ação desconhecida: {acao}")
    try:
        acoes[acao]()
    except Exception as e:  # uma ação com erro não pode derrubar o script
        log(f"  erro ao executar {acao}: {e}")


def interpretar(texto):
    """Aceita "acao|valor" ou JSON {"acao": ..., "valor": ...}."""
    texto = (texto or "").strip()
    if texto.startswith("{"):
        try:
            dados = json.loads(texto)
            return str(dados.get("acao", "")), str(dados.get("valor", "") or "")
        except json.JSONDecodeError:
            pass
    acao, _, valor = texto.partition("|")
    return acao.strip(), valor.strip()


# ---------------------------------------------------------------- escuta


def escutar(cfg):
    base = cfg["servidor"].rstrip("/")
    topico = urllib.parse.quote(cfg["topico"])
    vistos = set()
    ultimo_id = None
    headers = {"User-Agent": "quinta-pc"}
    if cfg.get("token"):
        headers["Authorization"] = f"Bearer {cfg['token']}"

    log(f"Quinta-PC ligado ({SISTEMA}{', modo teste' if TESTE else ''}). Escutando {base}/{cfg['topico']}")
    espera = 2
    while True:
        url = f"{base}/{topico}/json"
        if ultimo_id:
            url += f"?since={ultimo_id}"
        try:
            req = urllib.request.Request(url, headers=headers)
            # O ntfy manda "keepalive" a cada ~45 s; sem nada em 120 s, reconecta.
            with urllib.request.urlopen(req, timeout=120) as resp:
                espera = 2
                for linha in resp:
                    if not linha.strip():
                        continue
                    evento = json.loads(linha)
                    if evento.get("event") != "message" or evento.get("id") in vistos:
                        continue
                    vistos.add(evento["id"])
                    ultimo_id = evento["id"]
                    if time.time() - evento.get("time", time.time()) > IDADE_MAXIMA_S:
                        log(f"ignorando pedido antigo: {evento.get('message')}")
                        continue
                    acao, valor = interpretar(evento.get("message"))
                    log(f"pedido: {acao}{f' | {valor}' if valor else ''}")
                    executar(cfg, acao, valor)
        except KeyboardInterrupt:
            log("Quinta-PC desligado.")
            return
        except Exception as e:
            log(f"conexão perdida ({e}); tentando de novo em {espera}s")
            time.sleep(espera)
            espera = min(espera * 2, 60)


if __name__ == "__main__":
    escutar(carregar_config())
