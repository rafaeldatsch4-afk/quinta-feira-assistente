/* Interface da Quinta-Feira: voz, chat, painéis e configurações. */
(() => {
  const cfg = window.QF_CONFIG;
  const $ = (s) => document.querySelector(s);

  const el = {
    chat: $("#chat"),
    form: $("#form-entrada"),
    campo: $("#campo"),
    mic: $("#botao-mic"),
    legenda: $("#legenda"),
    rotuloEstado: $("#rotulo-estado"),
    modal: $("#modal-config"),
    formConfig: $("#form-config"),
    selectVoz: $("#select-voz"),
  };

  const ROTULOS = {
    ocioso: "Aguardando comando",
    ouvindo: "Ouvindo…",
    pensando: "Processando…",
    falando: "Respondendo",
  };

  let estado = "ocioso";
  function definirEstado(novo) {
    estado = novo;
    document.body.dataset.estado = novo;
    el.rotuloEstado.textContent = ROTULOS[novo];
    window.Nucleo.definirEstado(novo);
  }

  /* ---------------- Chat ---------------- */

  function textoComLinks(texto) {
    const frag = document.createDocumentFragment();
    const partes = texto.split(/(https?:\/\/[^\s)]+)/g);
    partes.forEach((p, i) => {
      if (i % 2) {
        const a = document.createElement("a");
        a.href = p; a.textContent = p; a.target = "_blank"; a.rel = "noopener";
        frag.append(a);
      } else if (p) {
        frag.append(p);
      }
    });
    return frag;
  }

  function adicionarMensagem(autor, texto, extra = "") {
    const msg = document.createElement("div");
    msg.className = `msg ${autor} ${extra}`.trim();
    const quem = document.createElement("span");
    quem.className = "msg-autor";
    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    quem.textContent = `${autor === "ia" ? "Quinta-Feira" : cfg.nomeUsuario || "Você"} · ${hora}`;
    const corpo = document.createElement("div");
    corpo.className = "msg-texto";
    if (texto instanceof Node) corpo.append(texto); else corpo.append(textoComLinks(texto));
    msg.append(quem, corpo);
    el.chat.append(msg);
    el.chat.scrollTop = el.chat.scrollHeight;
    return msg;
  }

  // Quando a área do chat encolhe (ex.: a legenda cresce no celular), mantém o fim visível.
  new ResizeObserver(() => { el.chat.scrollTop = el.chat.scrollHeight; }).observe(el.chat);

  function indicadorDigitando() {
    const pontos = document.createElement("span");
    pontos.className = "digitando";
    pontos.innerHTML = "<i></i><i></i><i></i>";
    return adicionarMensagem("ia", pontos);
  }

  /* ---------------- Fala (síntese) ---------------- */

  const sintese = window.speechSynthesis;
  let vozes = [];

  function carregarVozes() {
    if (!sintese) return;
    vozes = sintese.getVoices();
    const pt = vozes.filter((v) => v.lang && v.lang.toLowerCase().startsWith("pt"));
    const lista = pt.length ? pt : vozes;
    el.selectVoz.innerHTML = "";
    const auto = new Option("Automática (pt-BR)", "");
    el.selectVoz.append(auto);
    lista.forEach((v) => el.selectVoz.append(new Option(`${v.name} (${v.lang})`, v.name)));
    el.selectVoz.value = cfg.voz || "";
  }
  if (sintese) {
    carregarVozes();
    sintese.addEventListener?.("voiceschanged", carregarVozes);
  }

  function escolherVoz(nome = cfg.voz) {
    if (nome) {
      const v = vozes.find((x) => x.name === nome);
      if (v) return v;
    }
    const pt = vozes.filter((v) => /^pt[-_]br/i.test(v.lang));
    // Prefere vozes femininas conhecidas, depois qualquer pt-BR.
    return (
      pt.find((v) => /francisca|luciana|maria|vit[oó]ria|thalita|female|feminina|google portugu/i.test(v.name)) ||
      pt[0] ||
      vozes.find((v) => /^pt/i.test(v.lang)) ||
      null
    );
  }

  // Voz do navegador. "opcoes" permite ouvir uma amostra antes de salvar.
  function falarNavegador(texto, opcoes = cfg) {
    return new Promise((resolve) => {
      if (!sintese || !texto) return resolve();
      sintese.cancel();
      // Remove marcações e links para a leitura ficar natural.
      const limpo = texto.replace(/https?:\/\/\S+/g, "link").replace(/[*_#`>]/g, "");
      const u = new SpeechSynthesisUtterance(limpo);
      u.lang = cfg.idioma;
      u.rate = Number(opcoes.velocidade) || 1;
      u.pitch = Number(opcoes.tom) || 1;
      const v = escolherVoz(opcoes.voz);
      if (v) u.voice = v;
      u.onstart = () => definirEstado("falando");
      u.onend = u.onerror = () => { if (estado === "falando") definirEstado("ocioso"); resolve(); };
      sintese.speak(u);
    });
  }

  /* Voz neural vinda do n8n (campo "audio" em base64 ou "audioUrl"). */
  const player = new Audio();
  player.setAttribute("playsinline", "");
  let grafoAudio = null;   // liga o player ao núcleo animado
  let urlAudio = null;

  // PCM de 16 bits sem cabeçalho (audio/L16) não toca no navegador; embrulha em WAV.
  function pcmParaWav(pcm, taxa) {
    const wav = new DataView(new ArrayBuffer(44 + pcm.length));
    const texto = (pos, s) => [...s].forEach((c, i) => wav.setUint8(pos + i, c.charCodeAt(0)));
    texto(0, "RIFF"); wav.setUint32(4, 36 + pcm.length, true); texto(8, "WAVEfmt ");
    wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
    wav.setUint32(24, taxa, true); wav.setUint32(28, taxa * 2, true);
    wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
    texto(36, "data"); wav.setUint32(40, pcm.length, true);
    new Uint8Array(wav.buffer).set(pcm, 44);
    return new Blob([wav], { type: "audio/wav" });
  }

  function base64ParaBlob(b64, mime) {
    const m = b64.match(/^data:([^;]+(?:;[^;,]+)*);base64,(.*)$/);
    if (m) { mime = m[1]; b64 = m[2]; }
    const bin = atob(b64.replace(/\s/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // Se já vier com cabeçalho WAV (ex.: LINEAR16 do Google Cloud), toca como está.
    const ehWav = bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF";
    if (ehWav) return new Blob([bytes], { type: "audio/wav" });
    if (/l16|pcm/i.test(mime)) {
      return pcmParaWav(bytes, Number(/rate=(\d+)/i.exec(mime)?.[1]) || 24000);
    }
    return new Blob([bytes], { type: mime });
  }

  async function prepararGrafo() {
    if (grafoAudio !== null) return;
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      // resume() pode ficar pendente se o navegador não liberar o áudio; não espera mais que 600 ms.
      await Promise.race([ac.resume(), new Promise((r) => setTimeout(r, 600))]);
      // Só passa o som pelo analisador se o contexto estiver ativo; senão o áudio sairia mudo.
      grafoAudio = ac.state === "running" ? window.Nucleo.conectarElemento(player, ac) || false : false;
      if (!grafoAudio) ac.close();
    } catch (_) { grafoAudio = false; }
  }

  async function tocarAudio(r) {
    const p = r.audio ? player : new Audio(r.audioUrl);
    if (r.audio) {
      if (urlAudio) URL.revokeObjectURL(urlAudio);
      urlAudio = URL.createObjectURL(base64ParaBlob(r.audio, r.audioMime));
      player.src = urlAudio;
      await prepararGrafo();
    }
    p.playbackRate = Number(cfg.velocidade) || 1;
    return new Promise((resolve, reject) => {
      const fim = () => {
        if (grafoAudio && p === player) grafoAudio.desligar();
        if (estado === "falando") definirEstado("ocioso");
        resolve();
      };
      p.onended = fim;
      p.onpause = fim;
      p.onerror = () => reject(new Error("áudio inválido"));
      if (grafoAudio && p === player) grafoAudio.ligar();
      definirEstado("falando");
      p.play().catch(reject);
    });
  }

  // Fala a resposta e devolve qual voz foi usada, para a interface mostrar no chat.
  async function falar(texto, resposta = {}) {
    if (!cfg.falarRespostas) return null;
    let motivo = "o n8n não enviou áudio";
    if (resposta.campos?.length) motivo += ` (veio só: ${resposta.campos.join(", ")})`;
    if (resposta.audio || resposta.audioUrl) {
      try { await tocarAudio(resposta); return { voz: "neural" }; }
      catch (e) { motivo = `o áudio do n8n não tocou (${e.message || e.name})`; }
    }
    await falarNavegador(texto);
    return { voz: "navegador", motivo };
  }

  function marcarVoz(msg, info) {
    if (!info || !msg) return;
    const nota = document.createElement("span");
    nota.className = "msg-voz" + (info.voz === "neural" ? " ok" : "");
    nota.textContent = info.voz === "neural" ? "🔊 voz neural" : `🔈 voz do navegador — ${info.motivo}`;
    msg.append(nota);
    el.chat.scrollTop = el.chat.scrollHeight;
  }

  function pararFala() {
    if (sintese) sintese.cancel();
    if (!player.paused) player.pause();
    if (estado === "falando") definirEstado("ocioso");
  }

  /* ---------------- Processamento ---------------- */

  function executarAcao(acao) {
    if (!acao) return;
    const tipo = acao.tipo || acao.type;
    if ((tipo === "abrir_url" || tipo === "open_url") && acao.url) {
      window.open(acao.url, "_blank", "noopener");
    }
  }

  let ocupado = false;
  async function enviar(texto) {
    texto = texto.trim();
    if (!texto || ocupado) return;
    ocupado = true;
    pararFala();

    adicionarMensagem("usuario", texto);
    el.legenda.classList.remove("parcial");
    el.legenda.textContent = "";
    definirEstado("pensando");
    const digitando = indicadorDigitando();

    try {
      const r = await window.Cerebro.perguntar(texto);
      digitando.remove();
      if (r.erro) adicionarMensagem("ia", `⚠ ${r.erro}`, "erro");
      let msgResposta = null;
      if (r.texto) {
        msgResposta = adicionarMensagem("ia", r.texto);
        el.legenda.textContent = r.texto.length > 220 ? r.texto.slice(0, 217) + "…" : r.texto;
      }
      executarAcao(r.acao);
      definirEstado("ocioso");
      ocupado = false;
      falar(r.texto, r).then((info) => marcarVoz(msgResposta, info));
    } catch (e) {
      digitando.remove();
      adicionarMensagem("ia", `⚠ ${e.message}`, "erro");
      definirEstado("ocioso");
    } finally {
      ocupado = false;
    }
  }

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = el.campo.value;
    el.campo.value = "";
    enviar(t);
  });

  document.querySelectorAll("[data-comando]").forEach((b) =>
    b.addEventListener("click", () => enviar(b.dataset.comando))
  );

  $("#limpar-chat").addEventListener("click", () => {
    el.chat.innerHTML = "";
    el.legenda.textContent = "";
    window.Cerebro.limparHistorico();
  });

  /* ---------------- Menu lateral (celular) ---------------- */

  const botaoMenu = $("#botao-menu");
  const fundoMenu = $("#gaveta-fundo");
  function abrirMenu(abrir) {
    document.body.classList.toggle("menu-aberto", abrir);
    fundoMenu.hidden = !abrir;
    botaoMenu.setAttribute("aria-expanded", String(abrir));
  }
  botaoMenu.addEventListener("click", () => abrirMenu(true));
  $("#fechar-menu").addEventListener("click", () => abrirMenu(false));
  fundoMenu.addEventListener("click", () => abrirMenu(false));
  // Fecha a gaveta ao usar um comando rápido ou uma ação.
  $("#painel-esq").addEventListener("click", (e) => {
    if (e.target.closest(".atalho, .item-menu")) abrirMenu(false);
  });
  $("#menu-config").addEventListener("click", () => $("#botao-config").click());
  $("#menu-limpar").addEventListener("click", () => $("#limpar-chat").click());
  $("#menu-silenciar").addEventListener("click", pararFala);
  matchMedia("(min-width: 761px)").addEventListener("change", (e) => e.matches && abrirMenu(false));

  /* ---------------- Escuta (reconhecimento de voz) ---------------- */

  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let ouvindo = false;
  let desligarVisual = null;
  let streamMic = null;

  if (!Reconhecimento) {
    el.mic.disabled = true;
    el.mic.title = "Reconhecimento de voz não suportado neste navegador (use Chrome ou Edge)";
    $("#status-voz").classList.add("off");
    $("#status-voz span").textContent = "VOZ INDISPONÍVEL";
  }

  async function iniciarVisualMic() {
    try {
      streamMic = await navigator.mediaDevices.getUserMedia({ audio: true });
      desligarVisual = window.Nucleo.conectarAudio(streamMic);
    } catch (_) { /* sem visual do microfone, tudo bem */ }
  }
  function pararVisualMic() {
    if (desligarVisual) desligarVisual();
    if (streamMic) streamMic.getTracks().forEach((t) => t.stop());
    desligarVisual = null; streamMic = null;
  }

  function ouvir() {
    if (!Reconhecimento || ouvindo || window.Live.ativo) return;
    pararFala();
    rec = new Reconhecimento();
    rec.lang = cfg.idioma;
    rec.interimResults = true;
    rec.continuous = false;

    let final = "";
    rec.onstart = () => {
      ouvindo = true;
      definirEstado("ouvindo");
      el.legenda.classList.add("parcial");
      el.legenda.textContent = "Pode falar…";
      iniciarVisualMic();
    };
    rec.onresult = (ev) => {
      let parcial = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript; else parcial += r[0].transcript;
      }
      el.legenda.textContent = (final + parcial).trim() || "Pode falar…";
    };
    rec.onerror = (ev) => {
      if (ev.error === "not-allowed") adicionarMensagem("ia", "⚠ Permissão do microfone negada.", "erro");
      else if (ev.error !== "no-speech" && ev.error !== "aborted") adicionarMensagem("ia", `⚠ Erro no reconhecimento de voz: ${ev.error}`, "erro");
    };
    rec.onend = () => {
      ouvindo = false;
      pararVisualMic();
      el.legenda.classList.remove("parcial");
      if (final.trim()) {
        enviar(final);
      } else {
        el.legenda.textContent = "";
        if (estado === "ouvindo") definirEstado("ocioso");
      }
    };
    rec.start();
  }

  function pararDeOuvir() { if (rec && ouvindo) rec.stop(); }

  el.mic.addEventListener("click", () => (ouvindo ? pararDeOuvir() : ouvir()));

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      ouvindo ? pararDeOuvir() : ouvir();
    } else if (e.key === "Escape") {
      abrirMenu(false);
      if (window.Live.ativo) window.Live.parar();
      pararFala();
      pararDeOuvir();
    }
  });

  /* ---------------- Painel: relógio e diagnóstico ---------------- */

  function atualizarRelogio() {
    const d = new Date();
    const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const s = String(d.getSeconds()).padStart(2, "0");
    $("#relogio").innerHTML = `${hm}<span>:${s}</span>`;
    $("#data").textContent = d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  }
  atualizarRelogio();
  setInterval(atualizarRelogio, 1000);

  function metrica(id, pct, rotulo) {
    $(`#b-${id}`).style.width = `${Math.max(0, Math.min(100, pct))}%`;
    $(`#m-${id}`).textContent = rotulo ?? `${Math.round(pct)}%`;
  }

  function atualizarMetricas() {
    const base = { ocioso: 18, ouvindo: 46, pensando: 82, falando: 60 }[estado];
    metrica("nucleo", base + Math.random() * 12);

    const mem = performance.memory;
    if (mem) metrica("memoria", (mem.usedJSHeapSize / mem.totalJSHeapSize) * 100);
    else metrica("memoria", 30 + Math.random() * 6);

    const con = navigator.connection;
    if (!navigator.onLine) metrica("sinal", 0, "OFF");
    else if (con && con.downlink) metrica("sinal", Math.min(100, con.downlink * 10), `${con.downlink} Mb/s`);
    else metrica("sinal", 100, "OK");
  }
  atualizarMetricas();
  setInterval(atualizarMetricas, 2000);

  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const atualizar = () => metrica("energia", b.level * 100, `${Math.round(b.level * 100)}%${b.charging ? " ⚡" : ""}`);
      atualizar();
      b.addEventListener("levelchange", atualizar);
      b.addEventListener("chargingchange", atualizar);
    });
  } else {
    metrica("energia", 100, "AC");
  }

  function atualizarStatus() {
    const rede = $("#status-rede");
    rede.classList.toggle("erro", !navigator.onLine);
    rede.querySelector("span").textContent = navigator.onLine ? "ONLINE" : "OFFLINE";

    const n8n = $("#status-n8n");
    n8n.classList.toggle("off", !cfg.webhookUrl);
    n8n.querySelector("span").textContent = cfg.webhookUrl ? "N8N CONECTADO" : "MODO OFFLINE";
    n8n.title = cfg.webhookUrl || "Configure o webhook do n8n";

    const menuStatus = $("#menu-status-n8n");
    menuStatus.classList.toggle("off", !cfg.webhookUrl);
    menuStatus.innerHTML = cfg.webhookUrl
      ? "Cérebro: <b>n8n conectado</b>"
      : "Cérebro: <b>modo offline</b>";
  }
  addEventListener("online", atualizarStatus);
  addEventListener("offline", atualizarStatus);
  atualizarStatus();

  /* ---------------- Configurações ---------------- */

  const f = el.formConfig.elements;
  const outVel = $("#out-vel"), outTom = $("#out-tom");
  f.velocidade.addEventListener("input", () => (outVel.textContent = Number(f.velocidade.value).toFixed(1)));
  f.tom.addEventListener("input", () => (outTom.textContent = Number(f.tom.value).toFixed(1)));

  const authDoFormulario = () => ({
    authTipo: f.authTipo.value,
    authUsuario: f.authUsuario.value.trim(),
    authSenha: f.authSenha.value,
    token: f.token.value.trim(),
  });

  function mostrarCamposAuth() {
    document.querySelectorAll("[data-auth]").forEach((c) => (c.hidden = c.dataset.auth !== f.authTipo.value));
  }
  f.authTipo.addEventListener("change", mostrarCamposAuth);

  $("#ouvir-amostra").addEventListener("click", () => {
    const nome = cfg.nomeUsuario || "Chefe";
    falarNavegador(`Olá, ${nome}. Eu sou a Quinta-Feira. Esta é a minha voz.`, {
      voz: f.voz.value,
      velocidade: f.velocidade.value,
      tom: f.tom.value,
    });
  });
  el.modal.addEventListener("close", () => { if (sintese) sintese.cancel(); });

  $("#botao-config").addEventListener("click", () => {
    f.nomeUsuario.value = cfg.nomeUsuario;
    f.webhookUrl.value = cfg.webhookUrl;
    f.authTipo.value = cfg.authTipo;
    f.authUsuario.value = cfg.authUsuario;
    f.authSenha.value = cfg.authSenha;
    f.token.value = cfg.token;
    f.geminiKey.value = cfg.geminiKey || "";
    f.liveModelo.value = cfg.liveModelo || "gemini-3.8-live";
    mostrarCamposAuth();
    f.velocidade.value = cfg.velocidade; outVel.textContent = Number(cfg.velocidade).toFixed(1);
    f.tom.value = cfg.tom; outTom.textContent = Number(cfg.tom).toFixed(1);
    f.falarRespostas.checked = cfg.falarRespostas;
    carregarVozes();
    $("#resultado-teste").textContent = "";
    el.modal.showModal();
  });

  $("#testar-n8n").addEventListener("click", async () => {
    const saida = $("#resultado-teste");
    const url = f.webhookUrl.value.trim();
    if (!url) { saida.className = "resultado-teste falha"; saida.textContent = "Informe a URL do webhook."; return; }
    saida.className = "resultado-teste"; saida.textContent = "Testando…";
    try {
      const r = await window.Cerebro.testarConexao(url, authDoFormulario());
      saida.className = "resultado-teste ok";
      const t = r.texto || "";
      const kb = r.audio ? Math.round((r.audio.length * 0.75) / 1024) : 0;
      const campos = r.campos?.length ? ` (veio só: ${r.campos.join(", ")})` : "";
      const voz = r.audio ? `🔊 voz neural recebida (${kb} KB)` : r.audioUrl ? "🔊 voz neural por link" : `🔈 sem áudio${campos}`;
      saida.textContent = `✓ Conectado: "${t.slice(0, 40)}${t.length > 40 ? "…" : ""}" · ${voz}`;
    } catch (e) {
      saida.className = "resultado-teste falha";
      saida.textContent = `✗ ${e.message}`;
    }
  });

  // "submit" dispara antes do diálogo fechar, então a config já vale na próxima mensagem.
  el.formConfig.addEventListener("submit", (e) => {
    if (e.submitter?.value !== "salvar") return;
    cfg.salvar({
      nomeUsuario: f.nomeUsuario.value.trim() || "Chefe",
      webhookUrl: f.webhookUrl.value.trim(),
      ...authDoFormulario(),
      geminiKey: f.geminiKey.value.trim(),
      liveModelo: f.liveModelo.value.trim() || "gemini-3.8-live",
      voz: f.voz.value,
      velocidade: Number(f.velocidade.value),
      tom: Number(f.tom.value),
      falarRespostas: f.falarRespostas.checked,
    });
    atualizarStatus();
  });

  /* ---------------- Modo Live (Gemini em tempo real) ---------------- */

  const botaoLive = $("#botao-live");
  let msgLive = { usuario: null, ia: null };

  function textoLive(papel, trecho) {
    if (!msgLive[papel]) msgLive[papel] = adicionarMensagem(papel === "usuario" ? "usuario" : "ia", "");
    const corpo = msgLive[papel].querySelector(".msg-texto");
    corpo.textContent += trecho;
    if (papel === "ia") el.legenda.textContent = corpo.textContent.slice(-220);
    el.chat.scrollTop = el.chat.scrollHeight;
  }

  function estadoLive(st) {
    const ligado = st !== "parado";
    botaoLive.classList.toggle("ativo", ligado);
    botaoLive.setAttribute("aria-pressed", String(ligado));
    if (!ligado) {
      window.Nucleo.usarAnalisador(null);
      definirEstado("ocioso");
      el.legenda.textContent = "Modo Live encerrado.";
      msgLive = { usuario: null, ia: null };
      return;
    }
    definirEstado(st === "falando" ? "falando" : "ouvindo");
    window.Nucleo.usarAnalisador(st === "falando" ? window.Live.analisadorSaida : window.Live.analisadorEntrada);
    if (st === "ouvindo" && !msgLive.ia) el.legenda.textContent = "Live ligado — pode falar. Toque em LIVE para encerrar.";
  }

  botaoLive.addEventListener("click", async () => {
    if (window.Live.ativo) { window.Live.parar(); return; }
    if (botaoLive.classList.contains("conectando")) return;
    pararFala();
    pararDeOuvir();
    el.legenda.classList.remove("parcial");
    el.legenda.textContent = "Conectando ao modo Live…";
    botaoLive.classList.add("conectando");
    try {
      await window.Live.iniciar({
        estado: estadoLive,
        texto: textoLive,
        fimTurno: () => { msgLive = { usuario: null, ia: null }; },
        aviso: (t) => adicionarMensagem("ia", `⚠ ${t}`, "erro"),
      });
    } catch (e) {
      window.Live.parar();
      adicionarMensagem("ia", `⚠ ${e.message}`, "erro");
      el.legenda.textContent = "";
      definirEstado("ocioso");
    } finally {
      botaoLive.classList.remove("conectando");
    }
  });

  /* ---------------- Início ---------------- */

  const sauda = window.Cerebro.saudacao();
  adicionarMensagem(
    "ia",
    cfg.webhookUrl
      ? `${sauda}, ${cfg.nomeUsuario}. Sistemas online e cérebro n8n conectado. Em que posso ajudar?`
      : `${sauda}, ${cfg.nomeUsuario}. Estou em modo offline — conecte meu cérebro no n8n pela engrenagem no topo.`
  );
  el.campo.focus();
})();
