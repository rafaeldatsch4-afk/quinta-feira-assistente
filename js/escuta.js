/* Escuta contínua: a página fica ouvindo e só reage depois de "Ei, Quinta-Feira" / "Ô, Quinta-Feira".
   Usa o reconhecimento de voz do navegador, então só funciona com a página aberta e a tela ligada. */
window.Escuta = (() => {
  const cfg = window.QF_CONFIG;
  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Ativador + nome. "quinta-feira" sozinho não ativa, para "amanhã é quinta-feira" passar batido.
  const GATILHO = /(?:^|[^\p{L}\p{N}])(?:ei|hei|hey|ô|o|oh|ou|oi|ok|opa|fala|e aí)[\s,.!?-]+quinta[\s-]*feira(?=$|[^\p{L}\p{N}])[\s,.!?:;-]*/iu;

  let ligado = false, pausado = false, armado = false;
  let rec = null, encerrando = null;
  let timerArmado = null, timerReinicio = null;
  let atraso = 300, ultimoInicio = 0;
  let wake = null, ctxBipe = null;
  let ganchos = { emUso: () => false, aoArmar() {}, aoDesarmar() {}, aoComando() {}, aoErro() {}, aoMudar() {} };

  const api = {
    tempoArmado: 8000, // quanto tempo espera o comando depois do gatilho
    configurar(g) { ganchos = { ...ganchos, ...g }; },
    get ligado() { return ligado; },
    get armado() { return armado; },
  };

  // Aviso sonoro curto de que ela está ouvindo o comando.
  function bipe() {
    try {
      const ac = ctxBipe || (ctxBipe = new (window.AudioContext || window.webkitAudioContext)());
      if (ac.state === "suspended") ac.resume();
      const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g); g.connect(ac.destination);
      o.start(t); o.stop(t + 0.18);
    } catch (_) { /* sem bipe, tudo bem */ }
  }

  function armar() {
    if (armado) return;
    armado = true;
    bipe();
    ganchos.aoArmar();
    reiniciarTempo();
  }

  function reiniciarTempo() {
    clearTimeout(timerArmado);
    timerArmado = setTimeout(desarmar, api.tempoArmado);
  }

  function desarmar() {
    clearTimeout(timerArmado);
    if (!armado) return;
    armado = false;
    ganchos.aoDesarmar();
  }

  function tratarFinal(texto) {
    const m = GATILHO.exec(texto);
    if (!armado && !m) return;
    const comando = (m ? texto.slice(m.index + m[0].length) : texto).trim();
    if (!armado) armar();
    if (comando.length >= 2) {
      desarmar();
      ganchos.aoComando(comando);
    } else {
      reiniciarTempo(); // disse só "Ei, Quinta-Feira": espera o comando
    }
  }

  function tratarResultado(ev) {
    atraso = 300;
    if (ganchos.emUso()) return; // não ouve enquanto ela fala, pensa ou outro modo de voz está ligado
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      const texto = r[0].transcript;
      if (!r.isFinal) {
        if (!armado && GATILHO.test(texto)) armar(); // reage já no trecho parcial
        else if (armado) reiniciarTempo();
        continue;
      }
      tratarFinal(texto);
    }
  }

  function iniciarRec() {
    if (!ligado || pausado || rec || !Reconhecimento) return;
    const r = new Reconhecimento();
    r.lang = cfg.idioma;
    r.continuous = true;
    r.interimResults = true;
    r.onresult = tratarResultado;
    r.onerror = (ev) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        api.desligar();
        ganchos.aoErro("Permissão do microfone negada. Libere o microfone para este site e ligue a escuta de novo.");
      } else if (ev.error === "audio-capture") {
        api.desligar();
        ganchos.aoErro("Não achei um microfone disponível.");
      }
    };
    r.onend = () => {
      if (rec === r) rec = null;
      if (encerrando) { const f = encerrando; encerrando = null; f(); }
      if (!ligado || pausado) return;
      // O navegador encerra a escuta de tempos em tempos: reinicia. Se terminar rápido demais, espera mais.
      atraso = Date.now() - ultimoInicio < 1500 ? Math.min(atraso * 2, 5000) : 300;
      clearTimeout(timerReinicio);
      timerReinicio = setTimeout(iniciarRec, atraso);
    };
    rec = r;
    ultimoInicio = Date.now();
    try {
      r.start();
    } catch (_) {
      rec = null;
      clearTimeout(timerReinicio);
      timerReinicio = setTimeout(iniciarRec, 1000);
    }
  }

  function pararRec() {
    const r = rec;
    if (!r) return;
    try { r.abort ? r.abort() : r.stop(); } catch (_) { /* já parado */ }
  }

  // Mantém a tela ligada: com a tela apagada o navegador para de ouvir.
  async function pedirTela() {
    try {
      if (navigator.wakeLock && !wake) {
        wake = await navigator.wakeLock.request("screen");
        wake.addEventListener("release", () => { wake = null; });
      }
    } catch (_) { /* sem trava de tela */ }
  }

  function soltarTela() {
    try { if (wake) wake.release(); } catch (_) { /* nada */ }
    wake = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ligado) {
      pedirTela();
      iniciarRec();
    }
  });

  api.ligar = async () => {
    if (!Reconhecimento) {
      ganchos.aoErro("Este navegador não tem reconhecimento de voz. Use o Chrome.");
      return false;
    }
    if (ligado) return true;
    ligado = true;
    pausado = false;
    try {
      ctxBipe = ctxBipe || new (window.AudioContext || window.webkitAudioContext)();
      await ctxBipe.resume(); // o toque no botão libera o som do aviso
    } catch (_) { /* sem bipe */ }
    pedirTela();
    iniciarRec();
    ganchos.aoMudar();
    return true;
  };

  api.desligar = () => {
    ligado = false;
    clearTimeout(timerReinicio);
    desarmar();
    pararRec();
    rec = null;
    soltarTela();
    ganchos.aoMudar();
  };

  // Para a escuta enquanto outro modo de voz (microfone manual, Live) usa o microfone.
  api.pausar = () => {
    pausado = true;
    desarmar();
    clearTimeout(timerReinicio);
    if (!rec) return Promise.resolve();
    return new Promise((ok) => {
      encerrando = ok;
      pararRec();
      setTimeout(() => {
        if (encerrando === ok) { encerrando = null; rec = null; ok(); }
      }, 800);
    });
  };

  api.retomar = () => {
    pausado = false;
    if (ligado) iniciarRec();
  };

  return api;
})();
