/* Modo Live: conversa por voz em tempo real direto com o Gemini Live API
   (WebSocket), sem passar pelo n8n. Microfone em PCM 16 kHz; resposta em PCM 24 kHz. */
window.Live = (() => {
  const cfg = window.QF_CONFIG;
  const URL_LIVE =
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

  let ws = null, stream = null, ctxMic = null, proc = null, ctxOut = null;
  let saida = null;            // analisador da voz dela (para o núcleo)
  let entrada = null;          // analisador do microfone
  let fimFila = 0, fontes = [], ativo = false;
  let eventos = {};

  const avisar = (nome, ...args) => eventos[nome] && eventos[nome](...args);

  const base64 = (u8) => {
    let s = "";
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(s);
  };

  function tocarPcm(b64) {
    const bin = atob(b64), n = bin.length >> 1;
    const buf = ctxOut.createBuffer(1, n, 24000), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
      if (v > 32767) v -= 65536;
      d[i] = v / 32768;
    }
    const src = ctxOut.createBufferSource();
    src.buffer = buf;
    src.connect(saida);
    // Enfileira os pedaços para tocarem sem buracos.
    fimFila = Math.max(fimFila, ctxOut.currentTime + 0.05);
    src.start(fimFila);
    fimFila += buf.duration;
    fontes.push(src);
    src.onended = () => {
      fontes = fontes.filter((x) => x !== src);
      if (!fontes.length && ativo) avisar("estado", "ouvindo");
    };
    avisar("estado", "falando");
  }

  // Para a fala na hora (quando você interrompe falando por cima).
  function calar() {
    fontes.forEach((s) => { try { s.stop(); } catch (_) {} });
    fontes = [];
    fimFila = 0;
  }

  function instrucoes(ferramentas) {
    const nomes = ferramentas.map((f) => f.name).join(", ");
    const nome = cfg.nomeUsuario || "Chefe";
    const agora = new Date().toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" });
    return (
      `Você é a Quinta-Feira, assistente pessoal de ${nome}, no estilo do J.A.R.V.I.S. ` +
      "Fale sempre em português do Brasil, de forma natural, curta, confiante e simpática. " +
      `Chame o usuário de ${nome}. Data e hora atuais: ${agora}.` +
      (ferramentas.length
        ? ` Você tem as ferramentas ${nomes} para agir nos aparelhos do usuário: ` +
          "use-as sempre que ele pedir uma dessas ações, sem explicar o processo, e confirme em uma frase curta. " +
          "Antes de desligar ou reiniciar o PC, pergunte se ele confirma. " +
          "Para escrever no Bloco de Notas, crie o conteúdo completo e mande em controlar_pc com acao escrever; " +
          "depois diga só uma frase curta, sem ler o texto."
        : "")
    );
  }

  // Executa as ferramentas pedidas pelo modelo e devolve o resultado.
  async function responderFerramentas(chamadas) {
    const respostas = [];
    for (const c of chamadas) {
      const resposta = await window.Dispositivos.executar(c.name, c.args || {});
      if (resposta.erro && !resposta.silencioso) avisar("aviso", resposta.erro);
      respostas.push({ id: c.id, name: c.name, response: resposta });
    }
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ toolResponse: { functionResponses: respostas } }));
    }
  }

  function tratarMensagem(m, pronto) {
    if (m.setupComplete) return pronto();
    if (m.goAway) avisar("aviso", "A sessão Live vai encerrar em instantes (limite do Google).");
    if (m.toolCall && m.toolCall.functionCalls && m.toolCall.functionCalls.length) {
      responderFerramentas(m.toolCall.functionCalls);
      return;
    }
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) calar();
    if (sc.inputTranscription?.text) avisar("texto", "usuario", sc.inputTranscription.text);
    if (sc.outputTranscription?.text) avisar("texto", "ia", sc.outputTranscription.text);
    for (const p of sc.modelTurn?.parts || []) {
      if (p.inlineData?.data) tocarPcm(p.inlineData.data);
    }
    if (sc.turnComplete) avisar("fimTurno");
  }

  // Abre o WebSocket e espera o "setupComplete". Rejeita se fechar antes disso.
  function conectar(ferramentas) {
    return new Promise((ok, falha) => {
      let aberto = false;
      const socket = new WebSocket(`${URL_LIVE}?key=${encodeURIComponent(cfg.geminiKey)}`);
      ws = socket;
      socket.onopen = () => {
        aberto = true;
        const setup = {
          model: `models/${cfg.liveModelo || "gemini-3.8-live"}`,
          generationConfig: { responseModalities: ["AUDIO"] },
          systemInstruction: { parts: [{ text: instrucoes(ferramentas) }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        };
        if (ferramentas.length) setup.tools = [{ functionDeclarations: ferramentas }];
        socket.send(JSON.stringify({ setup }));
      };
      socket.onmessage = async (ev) => {
        const t = ev.data instanceof Blob ? await ev.data.text() : ev.data;
        let m;
        try { m = JSON.parse(t); } catch (_) { return; }
        tratarMensagem(m, ok);
      };
      socket.onerror = () => {
        if (!aberto) falha(new Error("Não consegui conectar ao Gemini Live. Confira a chave e a internet."));
      };
      socket.onclose = (e) => {
        if (!ativo) {
          const erro = new Error(`O Gemini Live recusou a conexão${e.reason ? `: ${e.reason}` : ""}. Confira a chave e o nome do modelo.`);
          erro.recusado = true;
          falha(erro);
        } else {
          if (e.reason) avisar("aviso", `Modo Live encerrado: ${e.reason}`);
          parar();
        }
      };
    });
  }

  async function iniciar(handlers = {}) {
    if (ativo) return;
    if (!cfg.geminiKey) throw new Error("Coloque a chave do Google em Configurações (campo \"Chave do Google\").");
    eventos = handlers;

    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    ctxOut = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    await ctxOut.resume();
    saida = ctxOut.createAnalyser();
    saida.fftSize = 256;
    saida.connect(ctxOut.destination);

    // Tenta com as ferramentas dos dispositivos; se o modelo recusar, conversa sem elas.
    const ferramentas = window.Dispositivos ? window.Dispositivos.declaracoes() : [];
    let semFerramentas = false;
    try {
      await conectar(ferramentas);
    } catch (e) {
      if (!ferramentas.length || !e.recusado) throw e;
      await conectar([]);
      semFerramentas = true;
    }

    ativo = true;
    if (semFerramentas) avisar("aviso", "O Gemini Live não aceitou o controle de dispositivos; seguimos só na conversa.");
    ctxMic = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
    await ctxMic.resume();
    const fonte = ctxMic.createMediaStreamSource(stream);
    entrada = ctxMic.createAnalyser();
    entrada.fftSize = 256;
    proc = ctxMic.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (e) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const f = e.inputBuffer.getChannelData(0), pcm = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) pcm[i] = Math.max(-1, Math.min(1, f[i])) * 32767;
      ws.send(JSON.stringify({
        realtimeInput: { audio: { data: base64(new Uint8Array(pcm.buffer)), mimeType: "audio/pcm;rate=16000" } },
      }));
    };
    fonte.connect(entrada);
    fonte.connect(proc);
    proc.connect(ctxMic.destination);
    avisar("estado", "ouvindo");
  }

  function parar() {
    const eraAtivo = ativo;
    ativo = false;
    calar();
    try { ws && ws.close(); } catch (_) {}
    try { proc && proc.disconnect(); } catch (_) {}
    stream && stream.getTracks().forEach((t) => t.stop());
    ctxMic && ctxMic.close().catch(() => {});
    ctxOut && ctxOut.close().catch(() => {});
    ws = proc = stream = ctxMic = ctxOut = saida = entrada = null;
    if (eraAtivo) avisar("estado", "parado");
  }

  return {
    iniciar,
    parar,
    get ativo() { return ativo; },
    get analisadorSaida() { return saida; },
    get analisadorEntrada() { return entrada; },
  };
})();
