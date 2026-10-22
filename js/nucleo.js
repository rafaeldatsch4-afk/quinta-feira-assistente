/* Núcleo animado (canvas) — reage ao estado da assistente
   e ao nível de áudio (microfone ou fala). */
window.Nucleo = (() => {
  const canvas = document.getElementById("nucleo");
  const ctx = canvas.getContext("2d");
  const reduzido = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const CORES = {
    ocioso:   [79, 227, 255],
    ouvindo:  [255, 79, 139],
    pensando: [255, 181, 71],
    falando:  [77, 255, 166],
  };

  let estado = "ocioso";
  let cor = [...CORES.ocioso];
  let nivel = 0;        // nível de áudio alvo (0..1)
  let nivelSuave = 0;
  let analisador = null;
  let dadosAudio = null;
  let t = 0;
  let w = 0, h = 0, dpr = 1;

  const particulas = Array.from({ length: 70 }, () => ({
    a: Math.random() * Math.PI * 2,
    r: 0.55 + Math.random() * 0.4,
    v: (Math.random() * 0.5 + 0.15) * (Math.random() < 0.5 ? -1 : 1),
    s: Math.random() * 1.6 + 0.4,
  }));

  function redimensionar() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = canvas.getBoundingClientRect();
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(redimensionar).observe(canvas);

  const rgba = (a) => `rgba(${cor[0] | 0}, ${cor[1] | 0}, ${cor[2] | 0}, ${a})`;

  function arco(cx, cy, raio, ini, fim, larg, alpha) {
    ctx.beginPath();
    ctx.arc(cx, cy, raio, ini, fim);
    ctx.lineWidth = larg;
    ctx.strokeStyle = rgba(alpha);
    ctx.stroke();
  }

  function desenhar() {
    t += reduzido ? 0.004 : 0.016;

    // transição suave de cor
    const alvo = CORES[estado];
    for (let i = 0; i < 3; i++) cor[i] += (alvo[i] - cor[i]) * 0.08;

    // nível de áudio
    if (analisador) {
      analisador.getByteFrequencyData(dadosAudio);
      let soma = 0;
      for (let i = 0; i < dadosAudio.length; i++) soma += dadosAudio[i];
      nivel = Math.min(1, (soma / dadosAudio.length) / 90);
    } else if (estado === "falando") {
      nivel = 0.35 + Math.abs(Math.sin(t * 7)) * 0.3 + Math.random() * 0.15;
    } else if (estado === "pensando") {
      nivel = 0.2 + Math.sin(t * 3) * 0.1;
    } else {
      nivel = 0.06 + Math.sin(t * 1.2) * 0.04;
    }
    nivelSuave += (nivel - nivelSuave) * 0.18;

    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2 * 0.92;
    const vel = estado === "pensando" ? 2.6 : estado === "ouvindo" ? 1.6 : 1;

    // brilho de fundo
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    g.addColorStop(0, rgba(0.22 + nivelSuave * 0.25));
    g.addColorStop(0.35, rgba(0.06));
    g.addColorStop(1, rgba(0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // anel externo com marcações
    arco(cx, cy, R * 0.98, 0, Math.PI * 2, 1, 0.18);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 0.08 * vel);
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const longo = i % 10 === 0;
      const r1 = R * 0.93, r2 = R * (longo ? 0.86 : 0.9);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
      ctx.lineWidth = longo ? 2 : 1;
      ctx.strokeStyle = rgba(longo ? 0.6 : 0.22);
      ctx.stroke();
    }
    ctx.restore();

    // arcos segmentados girando
    const segs = [
      { r: 0.8, n: 3, tam: 0.7, vel: 0.35, larg: 3, a: 0.75 },
      { r: 0.74, n: 5, tam: 0.35, vel: -0.55, larg: 1.5, a: 0.5 },
      { r: 0.68, n: 2, tam: 1.3, vel: 0.9, larg: 6, a: 0.28 },
    ];
    for (const s of segs) {
      for (let i = 0; i < s.n; i++) {
        const ini = t * s.vel * vel + (i / s.n) * Math.PI * 2;
        arco(cx, cy, R * s.r, ini, ini + s.tam, s.larg, s.a);
      }
    }

    // forma de onda circular
    const base = R * 0.5;
    const pontos = 160;
    ctx.beginPath();
    for (let i = 0; i <= pontos; i++) {
      const a = (i / pontos) * Math.PI * 2;
      let amp;
      if (analisador && dadosAudio) {
        const idx = Math.floor((Math.abs(Math.sin(a * 0.5)) * dadosAudio.length) * 0.6);
        amp = (dadosAudio[idx] / 255) * R * 0.16;
      } else {
        amp = (Math.sin(a * 6 + t * 4) * 0.5 + Math.sin(a * 11 - t * 6) * 0.5) * R * 0.09 * nivelSuave;
      }
      const r = base + amp;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(0.9);
    ctx.shadowColor = rgba(1);
    ctx.shadowBlur = 18;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // anel interno
    arco(cx, cy, R * 0.42, 0, Math.PI * 2, 1, 0.35);
    const pulso = R * (0.36 + nivelSuave * 0.05);
    const gi = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulso);
    gi.addColorStop(0, rgba(0.18 + nivelSuave * 0.3));
    gi.addColorStop(0.7, rgba(0.05));
    gi.addColorStop(1, rgba(0));
    ctx.fillStyle = gi;
    ctx.beginPath(); ctx.arc(cx, cy, pulso, 0, Math.PI * 2); ctx.fill();

    // partículas orbitando
    for (const p of particulas) {
      p.a += p.v * 0.006 * vel * (1 + nivelSuave * 2);
      const r = R * p.r;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(p.a) * r, cy + Math.sin(p.a) * r, p.s, 0, Math.PI * 2);
      ctx.fillStyle = rgba(0.35 + nivelSuave * 0.5);
      ctx.fill();
    }

    requestAnimationFrame(desenhar);
  }

  redimensionar();
  requestAnimationFrame(desenhar);

  return {
    definirEstado(novo) { if (CORES[novo]) estado = novo; },
    conectarAudio(stream) {
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const fonte = ac.createMediaStreamSource(stream);
        analisador = ac.createAnalyser();
        analisador.fftSize = 256;
        dadosAudio = new Uint8Array(analisador.frequencyBinCount);
        fonte.connect(analisador);
        return () => { analisador = null; dadosAudio = null; ac.close(); };
      } catch (_) { return () => {}; }
    },
  };
})();
