/* Cérebro da Quinta-Feira.
   - Com webhook do n8n configurado: toda mensagem vai para o n8n.
   - Sem webhook (ou se o n8n falhar): responde comandos básicos localmente. */
window.Cerebro = (() => {
  const cfg = window.QF_CONFIG;
  const historico = []; // { papel: "usuario" | "assistente", texto }

  const sessionId = (() => {
    const chave = "quinta-feira:sessao";
    try {
      let id = localStorage.getItem(chave);
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2);
        localStorage.setItem(chave, id);
      }
      return id;
    } catch (_) {
      return "sessao-" + Date.now();
    }
  })();

  // Madrugada (antes das 5h) conta como noite.
  function saudacao(d = new Date()) {
    const h = d.getHours();
    return h >= 5 && h < 12 ? "Bom dia" : h >= 12 && h < 18 ? "Boa tarde" : "Boa noite";
  }

  /* ---------------- n8n ---------------- */

  // Aceita os formatos mais comuns de resposta do n8n:
  // { output }, { resposta }, { text }, [ { output } ], ou texto puro.
  function extrairResposta(dados) {
    if (dados == null) return { texto: "" };
    if (typeof dados === "string") return { texto: dados };
    if (Array.isArray(dados)) return extrairResposta(dados[0]);
    if (dados.json) return extrairResposta(dados.json);
    const texto =
      dados.output ?? dados.resposta ?? dados.text ?? dados.message ??
      dados.reply ?? dados.response ?? dados.content ?? "";
    return {
      texto: typeof texto === "string" ? texto : JSON.stringify(texto),
      acao: dados.acao || dados.action || null,
    };
  }

  const base64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

  function cabecalhoAuth(a) {
    if (a.authTipo === "basic" && (a.authUsuario || a.authSenha)) {
      return `Basic ${base64(`${a.authUsuario}:${a.authSenha}`)}`;
    }
    // Aceita o token com ou sem "Bearer " na frente (evita "Bearer Bearer ...").
    const token = (a.token || "").trim().replace(/^bearer\s+/i, "");
    if (a.authTipo === "bearer" && token) return `Bearer ${token}`;
    return null;
  }

  // "opcoes" permite testar uma URL/credencial antes de salvar.
  async function chamarN8n(texto, opcoes = {}) {
    const url = opcoes.url || cfg.webhookUrl;
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), cfg.timeoutMs);
    const headers = { "Content-Type": "application/json" };
    const auth = cabecalhoAuth(opcoes.auth || cfg);
    if (auth) headers.Authorization = auth;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        signal: controle.signal,
        body: JSON.stringify({
          chatInput: texto,          // compatível com o nó AI Agent
          sessionId,                 // usado pela memória do agente
          usuario: cfg.nomeUsuario,
          historico: historico.slice(-10),
          dataHora: new Date().toISOString(),
          // Horário do usuário, para o agente saber se é dia ou noite.
          horaLocal: new Date().toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" }),
          fusoHorario: Intl.DateTimeFormat().resolvedOptions().timeZone,
          origem: "quinta-feira-ui",
        }),
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "O n8n recusou a autenticação (403). Confira se o tipo escolhido aqui é o mesmo do nó Webhook " +
          "(Basic Auth ou Header Auth), se usuário/senha ou token estão iguais aos da credencial, " +
          "e se o workflow foi salvo e está ativo."
        );
      }
      if (res.status === 404) {
        throw new Error("Webhook não encontrado (404). Verifique se o workflow está ativo e se a URL é a de produção.");
      }
      if (!res.ok) throw new Error(`n8n respondeu ${res.status} ${res.statusText}`);
      const bruto = await res.text();
      let dados = bruto;
      try { dados = JSON.parse(bruto); } catch (_) {}
      const resposta = extrairResposta(dados);
      if (!resposta.texto && !resposta.acao) {
        resposta.texto = "Recebi uma resposta vazia do n8n. Confira o nó Respond to Webhook.";
      }
      return resposta;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("O n8n demorou demais para responder.");
      if (e instanceof TypeError) {
        throw new Error("Não consegui alcançar o n8n. Verifique a URL e o CORS (Allowed Origins) do Webhook.");
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /* ---------------- Modo local ---------------- */

  const normalizar = (s) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[?!.,]+$/g, "").trim();

  const PIADAS = [
    "Por que o computador foi ao médico? Porque estava com vírus.",
    "O que o zero disse para o oito? Que cinto bonito!",
    "Sabe por que a Quinta-Feira nunca se atrasa? Porque ela sempre vem depois da Quarta.",
    "Qual é o café mais perigoso do mundo? O ex-presso.",
    "Programador não morre. Ele só perde a referência.",
  ];

  // Avaliador de expressões simples (+ - * / ^ e parênteses), sem eval.
  function calcular(expr) {
    const tokens = expr.match(/\d+(?:[.,]\d+)?|[-+*/^()]/g);
    if (!tokens || tokens.join("") !== expr.replace(/\s+/g, "")) return null;
    let i = 0;
    const ver = () => tokens[i];
    const prox = () => tokens[i++];
    function primario() {
      const tk = prox();
      if (tk === "(") { const v = soma(); if (prox() !== ")") throw 0; return v; }
      if (tk === "-") return -primario();
      if (tk === "+") return primario();
      const n = parseFloat(String(tk).replace(",", "."));
      if (Number.isNaN(n)) throw 0;
      return n;
    }
    function potencia() { const b = primario(); return ver() === "^" ? (prox(), b ** potencia()) : b; }
    function produto() {
      let v = potencia();
      while (ver() === "*" || ver() === "/") v = prox() === "*" ? v * potencia() : v / potencia();
      return v;
    }
    function soma() {
      let v = produto();
      while (ver() === "+" || ver() === "-") v = prox() === "+" ? v + produto() : v - produto();
      return v;
    }
    try {
      const v = soma();
      return i === tokens.length && Number.isFinite(v) ? v : null;
    } catch (_) { return null; }
  }

  const formatarNumero = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });

  function responderLocal(entrada) {
    // Ignora a palavra de ativação no começo ("Quinta-Feira, que horas são?").
    const t = normalizar(entrada).replace(/^(ei\s+|ok\s+)?quinta[- ]?feira[,\s]*/, "");
    const agora = new Date();
    const nome = cfg.nomeUsuario || "Chefe";

    if (!t || /^(oi|ola|e ai|eai|bom dia|boa tarde|boa noite|hey)\b/.test(t)) {
      const sauda = saudacao(agora);
      return { texto: `${sauda}, ${nome}. Em que posso ajudar?` };
    }
    if (/\b(que horas|hora atual|horario)\b/.test(t)) {
      return { texto: `Agora são ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.` };
    }
    if (/\b(que dia|data de hoje|dia e hoje|qual a data)\b/.test(t)) {
      return { texto: `Hoje é ${agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.` };
    }
    if (/\b(piada|me faca rir)\b/.test(t)) {
      return { texto: PIADAS[Math.floor(Math.random() * PIADAS.length)] };
    }
    if (/\b(status|diagnostico|sistema)\b/.test(t)) {
      const n8n = cfg.webhookUrl ? "configurado" : "não configurado";
      return { texto: `Todos os sistemas operacionais. Conexão ${navigator.onLine ? "ativa" : "offline"}. Cérebro n8n ${n8n}.` };
    }
    if (/\b(quem e voce|seu nome|como voce se chama)\b/.test(t)) {
      return { texto: `Eu sou a Quinta-Feira, sua assistente pessoal, ${nome}.` };
    }
    if (/\b(obrigad[oa]|valeu)\b/.test(t)) {
      return { texto: `Sempre às ordens, ${nome}.` };
    }

    // "15% de 240"
    const pct = t.match(/(\d+(?:[.,]\d+)?)\s*(?:%|por ?cento)\s*de\s*(\d+(?:[.,]\d+)?)/);
    if (pct) {
      const v = (parseFloat(pct[1].replace(",", ".")) / 100) * parseFloat(pct[2].replace(",", "."));
      return { texto: `${pct[1]}% de ${pct[2]} é ${formatarNumero(v)}.` };
    }
    // "quanto é 2 + 2", "calcule 3 vezes 4"
    const conta = t.match(/(?:quanto e|quanto da|calcul[ae]|resultado de)\s+(.+)/);
    if (conta) {
      const expr = conta[1]
        .replace(/\bmais\b/g, "+").replace(/\bmenos\b/g, "-")
        .replace(/\b(vezes|x)\b/g, "*").replace(/\b(dividido por|sobre)\b/g, "/")
        .replace(/\belevado a\b/g, "^").replace(/\s+/g, "");
      const v = calcular(expr);
      if (v !== null) return { texto: `O resultado é ${formatarNumero(v)}.` };
    }

    const pesquisa = t.match(/^(?:pesquis[ae]|procur[ae]|busque|busca)\s+(?:por\s+|sobre\s+)?(.+)/);
    if (pesquisa) {
      return {
        texto: `Pesquisando "${pesquisa[1]}" no Google.`,
        acao: { tipo: "abrir_url", url: `https://www.google.com/search?q=${encodeURIComponent(pesquisa[1])}` },
      };
    }
    const sites = { youtube: "https://www.youtube.com", google: "https://www.google.com", gmail: "https://mail.google.com", github: "https://github.com", whatsapp: "https://web.whatsapp.com", spotify: "https://open.spotify.com" };
    const abrir = t.match(/^abr[ae]\s+(?:o\s+|a\s+)?(\w+)/);
    if (abrir && sites[abrir[1]]) {
      return { texto: `Abrindo ${abrir[1]}.`, acao: { tipo: "abrir_url", url: sites[abrir[1]] } };
    }

    if (/^(ajuda|comandos|o que voce (sabe|pode) fazer)/.test(t)) {
      return {
        texto:
          "No modo offline eu entendo: horário, data, status, piadas, contas (\"quanto é 12 vezes 8\", \"15% de 240\"), " +
          "\"pesquise ...\" e \"abra o YouTube\". Para conversar de verdade, conecte meu cérebro no n8n em Configurações.",
      };
    }

    return {
      texto: cfg.webhookUrl
        ? "Não consegui falar com o n8n agora, então só consigo comandos básicos."
        : "Ainda não tenho um cérebro conectado para isso. Configure o webhook do n8n no ícone de engrenagem.",
    };
  }

  /* ---------------- API pública ---------------- */

  async function perguntar(texto) {
    historico.push({ papel: "usuario", texto });
    let resposta;
    if (cfg.webhookUrl) {
      try {
        resposta = await chamarN8n(texto);
      } catch (e) {
        resposta = { ...responderLocal(texto), erro: e.message };
      }
    } else {
      await new Promise((r) => setTimeout(r, 350)); // pequena pausa "pensando"
      resposta = responderLocal(texto);
    }
    historico.push({ papel: "assistente", texto: resposta.texto });
    return resposta;
  }

  async function testarConexao(url, auth) {
    const r = await chamarN8n("ping", { url, auth });
    return r.texto;
  }

  return {
    perguntar,
    testarConexao,
    saudacao,
    limparHistorico: () => { historico.length = 0; },
    get sessionId() { return sessionId; },
  };
})();
