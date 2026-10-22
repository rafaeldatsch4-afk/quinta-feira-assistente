/* Controle do celular (Tasker) e do PC (Quinta-PC) pelo ntfy, direto do navegador.
   Entende comandos como "liga a lanterna" e publica "acao|valor" no tópico do dispositivo. */
window.Dispositivos = (() => {
  const cfg = window.QF_CONFIG;

  // Ações que o Tasker do celular já sabe executar. Acrescente aqui ao criar novas no Tasker.
  const ACOES_CELULAR = new Set([
    "lanterna_ligar", "lanterna_desligar", "volume_midia", "silencioso", "som_normal",
    "abrir_site", "midia_tocar_pausar", "midia_proxima", "midia_anterior", "abrir_app", "alarme", "timer",
  ]);

  // Sites que ela abre pelo nome ("abre o youtube no celular").
  const SITES = {
    youtube: "https://www.youtube.com", google: "https://www.google.com", gmail: "https://mail.google.com",
    github: "https://github.com", spotify: "https://open.spotify.com",
    instagram: "https://www.instagram.com", facebook: "https://www.facebook.com", netflix: "https://www.netflix.com",
    maps: "https://maps.google.com",
  };

  // Só endereços http/https chegam ao celular. Acrescenta https:// se faltar.
  function urlSegura(texto) {
    let u = String(texto || "").trim().replace(/[.,!?]+$/, "");
    if (!u) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) {
      // "javascript:alert(1)", "mailto:x" etc. têm esquema sem "//"; "site.com:8080" é domínio com porta.
      if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(u)) return null;
      u = "https://" + u;
    }
    try {
      const url = new URL(u);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  const ACOES_PC = new Set([
    "abrir_site", "pesquisar", "youtube", "abrir_app", "comando", "volume_mais", "volume_menos", "mudo",
    "midia_tocar_pausar", "midia_proxima", "midia_anterior", "bloquear", "desligar", "reiniciar", "cancelar_desligamento",
  ]);
  const PERIGOSAS = new Set(["desligar", "reiniciar"]);

  const norm = (s) =>
    String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

  const reLigar = /\b(liga|ligue|ligar|acende|acenda|acender|ativa|ative|ativar)\b/;
  const reDesligar = /\b(desliga|desligue|desligar|apaga|apague|apagar|desativa|desative|desativar)\b/;
  const reMudo = /\b(muta|mutar|silencia|silenciar|mudo)\b/;
  const rePc = /\b(pc|computador|notebook|laptop)\b/;

  let pendente = null; // ação perigosa esperando "sim"

  const pedido = (alvo, acao, valor, resposta) => ({ alvo, acao, valor, resposta });

  // O ntfy só aceita letras, números, "-" e "_". Tira espaços e pontuação que vêm ao copiar e colar.
  const limparTopico = (t) => String(t || "").replace(/[^A-Za-z0-9_-]/g, "");

  function confirmar(p, pergunta) {
    pendente = { pedido: p, expira: Date.now() + 30000 };
    return { resposta: pergunta };
  }

  // Nível de volume de mídia (0 a 15) dito em número, porcentagem, "máximo" ou "mínimo".
  function nivelVolume(t, original) {
    const pct = String(original).toLowerCase().match(/(\d{1,3})\s*(?:%|por\s?cento)/);
    if (pct) return Math.round((Math.min(100, Number(pct[1])) / 100) * 15);
    if (/\b(maximo|maxima|total)\b/.test(t)) return 15;
    if (/\b(minimo|minima|zero)\b/.test(t)) return 0;
    const n = t.match(/\b(\d{1,2})\b/);
    return n ? Math.min(15, Number(n[1])) : null;
  }

  // Hora dita em português: "7h", "7:30", "6 e meia", "às 8 da noite". Devolve "HH:MM" ou null.
  function horaDoAlarme(t, original) {
    const o = String(original).toLowerCase();
    let m = o.match(/\b(\d{1,2})\s*(?::|h|horas?)\s*(\d{2})?\b/) || o.match(/\bas\s+(\d{1,2})\b/) || t.match(/\bas (\d{1,2})\b/);
    if (!m) m = t.match(/\b(\d{1,2}) e (meia|quinze|quarenta e cinco|trinta)\b/);
    if (!m) return null;
    let h = Number(m[1]);
    let min = m[2] ? (/^\d+$/.test(m[2]) ? Number(m[2]) : ({ meia: 30, trinta: 30, quinze: 15, "quarenta e cinco": 45 }[m[2]] || 0)) : 0;
    if (/\b(e meia)\b/.test(t) && !m[2]) min = 30;
    if (/\b(da tarde|da noite)\b/.test(t) && h < 12) h += 12;
    if (/\bda madrugada\b/.test(t) && h === 12) h = 0;
    if (h > 23 || min > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }

  const PALAVRAS_NUMERO = {
    um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
    dez: 10, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  };

  // Duração dita em português ("5 minutos", "1 hora e 30 minutos", "meia hora") em segundos, ou null.
  function segundosDoTimer(t) {
    const s = t
      .replace(/\bmeia hora\b/g, "30 minutos")
      .replace(/\bmeio minuto\b/g, "30 segundos")
      .replace(/\bquarenta e cinco\b/g, "45")
      .replace(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|quarenta|cinquenta)\b/g, (p) => String(PALAVRAS_NUMERO[p]));
    const unidade = { h: 3600, hora: 3600, horas: 3600, min: 60, minuto: 60, minutos: 60, s: 1, seg: 1, segundo: 1, segundos: 1 };
    let total = 0;
    for (const m of s.matchAll(/(\d+)\s*(horas?|h|minutos?|min|segundos?|seg|s)\b/g)) total += Number(m[1]) * unidade[m[2]];
    return total > 0 && total <= 86400 ? total : null;
  }

  function descreverDuracao(seg) {
    const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
    const partes = [];
    if (h) partes.push(`${h} ${h === 1 ? "hora" : "horas"}`);
    if (m) partes.push(`${m} ${m === 1 ? "minuto" : "minutos"}`);
    if (s) partes.push(`${s} ${s === 1 ? "segundo" : "segundos"}`);
    return partes.join(" e ");
  }

  // ----- WhatsApp: contatos cadastrados nas Configurações (uma linha por contato: nome=número)
  function contatos() {
    return String(cfg.contatos || "").split(/\r?\n/).map((linha) => {
      const i = linha.indexOf("=");
      return i > 0 ? { nome: linha.slice(0, i).trim(), numero: linha.slice(i + 1).trim() } : null;
    }).filter((c) => c && c.nome && c.numero);
  }

  function acharContato(nome) {
    const n = norm(nome || "");
    if (!n) return null;
    const lista = contatos();
    return lista.find((c) => norm(c.nome) === n)
      || lista.find((c) => norm(c.nome).split(" ").includes(n))
      || lista.find((c) => norm(c.nome).includes(n))
      || null;
  }

  function numeroWhatsapp(numero) {
    let d = String(numero).replace(/\D/g, "");
    if (d.length === 10 || d.length === 11) d = "55" + d; // DDD + número (Brasil)
    return d.length >= 12 && d.length <= 15 ? d : null;
  }

  function urlWhatsapp(contato, mensagem) {
    const num = numeroWhatsapp(contato.numero);
    if (!num) return null;
    return `https://wa.me/${num}${mensagem ? `?text=${encodeURIComponent(mensagem)}` : ""}`;
  }

  // "abre a conversa com o João", "manda mensagem para a Maria dizendo que cheguei"
  function comandoWhatsapp(original) {
    const o = String(original).toLowerCase().replace(/[.!?]+$/, "").trim();
    const citouZap = /\b(whatsapp|whats|zap)\b/.test(norm(o));
    let nome = null;
    let texto = "";
    let m = o.match(/(?:abre|abra|abrir)\s+(?:a\s+)?conversa\s+(?:com|do|da)\s+(?:o\s+|a\s+)?(.+?)(?:\s+no\s+(?:whatsapp|whats|zap))?$/)
      || o.match(/(?:abre|abra|abrir)\s+(?:o\s+)?(?:whatsapp|whats|zap)\s+(?:do|da|de)\s+(?:o\s+|a\s+)?(.+)$/);
    if (m) {
      nome = m[1];
    } else {
      m = o.match(/(?:manda|mande|mandar|envia|envie|enviar)\s+(?:uma?\s+)?(?:mensagem|msg|zap|whatsapp|whats)\s+(?:para|pra|pro|ao|a)\s+(?:o\s+|a\s+)?(.+?)(?:\s+no\s+(?:whatsapp|whats|zap))?(?:\s+(?:dizendo|falando|escrevendo|avisando)\s+(?:que\s+)?(.+))?$/);
      if (m) { nome = m[1]; texto = (m[2] || "").trim(); }
    }
    if (!nome) return null;
    const contato = acharContato(nome);
    if (!contato) {
      return citouZap ? { resposta: `Não achei ${nome} nos seus contatos. Cadastre em Configurações, em Contatos do WhatsApp.` } : null;
    }
    const url = urlWhatsapp(contato, texto);
    if (!url) return { resposta: `O número de ${contato.nome} parece incompleto. Use o DDD e o número, como 11 91234-5678.` };
    return pedido(
      "celular", "abrir_site", url,
      texto ? `Abri a conversa com ${contato.nome} com a mensagem pronta. É só enviar.` : `Abrindo a conversa com ${contato.nome}.`
    );
  }

  // ----- Bateria do aparelho em que a página está aberta (o celular, no seu caso)
  async function lerBateria() {
    if (!navigator.getBattery) return null;
    try {
      const b = await navigator.getBattery();
      return { nivel: Math.round(b.level * 100), carregando: b.charging };
    } catch (_) {
      return null;
    }
  }

  async function textoBateria() {
    const b = await lerBateria();
    if (!b) return "Este navegador não me deixa ler a bateria.";
    return `A bateria está em ${b.nivel}%${b.carregando ? " e carregando" : ""}.`;
  }

  // Nome de app seguro para mandar ao Tasker.
  const nomeAppSeguro = (n) => {
    const nome = String(n || "").trim().replace(/\s+/g, " ");
    return /^[\p{L}\p{N} ._-]{1,40}$/u.test(nome) ? nome : null;
  };

  // Comandos para o celular. Só entram ações que o Tasker já sabe fazer (ACOES_CELULAR).
  function comandoCelular(t, original) {
    const falaDoCelular = /\b(celular|telefone)\b/.test(t);

    if (/\blanterna\b/.test(t)) {
      if (reDesligar.test(t)) return pedido("celular", "lanterna_desligar", "", "Lanterna apagada.");
      if (reLigar.test(t)) return pedido("celular", "lanterna_ligar", "", "Lanterna ligada.");
    }

    const saiDoSilencioso = /\b(tira|tire|tirar|sai|saia|sair|desativa|desative|desativar|desliga|desligue|desligar|volta|volte)\b/;
    if (/\bsilencioso\b/.test(t) || (falaDoCelular && reMudo.test(t))) {
      if (saiDoSilencioso.test(t)) return pedido("celular", "som_normal", "", "Som do celular de volta ao normal.");
      return pedido("celular", "silencioso", "", "Celular no silencioso.");
    }
    if (/\bsom normal\b/.test(t) || (falaDoCelular && /\b(volta|ativa|ative|ligar|liga|ligue)\b.*\bsom\b/.test(t))) {
      return pedido("celular", "som_normal", "", "Som do celular de volta ao normal.");
    }

    if (falaDoCelular && /\bvolume\b/.test(t)) {
      const nivel = nivelVolume(t, original);
      if (nivel === null) return { resposta: "Qual volume você quer? Diga um número de 0 a 15 ou uma porcentagem." };
      return pedido("celular", "volume_midia", String(nivel), `Volume do celular em ${nivel}.`);
    }

    // abrir site: "abre o site youtube.com", "abre o youtube no celular", "pesquisa X no celular"
    const orig = String(original).toLowerCase();
    const site = orig.match(/\b(?:abre|abra|abrir)\b.*?\bsite\s+(\S+\.\S+)/);
    if (site) {
      const url = urlSegura(site[1]);
      if (url) return pedido("celular", "abrir_site", url, "Abrindo o site no celular.");
    }
    const nomeSite = t.match(/\b(?:abre|abra|abrir)\s+(?:o |a )?(youtube|google|gmail|github|spotify|instagram|facebook|netflix|maps)\b/);
    if (nomeSite && falaDoCelular) return pedido("celular", "abrir_site", SITES[nomeSite[1]], `Abrindo o ${nomeSite[1]} no celular.`);
    const app = t.match(/\b(?:abre|abra|abrir)\s+(?:o |a )?(?:(?:app|aplicativo)\s+)?(.+?)(?:\s+no\s+(?:meu\s+)?(?:celular|telefone))?$/);
    if (app && (falaDoCelular || /\b(app|aplicativo)\b/.test(t))) {
      const nome = nomeAppSeguro(app[1].replace(/^(app|aplicativo)\s+/, "").replace(/^(do|da|de)\s+/, ""));
      if (nome) return pedido("celular", "abrir_app", nome, `Abrindo ${nome}.`);
    }
    const busca = orig.match(/pesquis(?:a|e|ar)\s+(.+?)\s+n[oa]\s+(?:meu\s+)?(?:celular|telefone)\b/);
    if (busca) {
      return pedido("celular", "abrir_site", "https://www.google.com/search?q=" + encodeURIComponent(busca[1]), "Pesquisando no celular.");
    }

    // timer: "cria um timer de 5 minutos", "me avisa daqui a 10 minutos"
    if (/\b(timer|temporizador)\b/.test(t) || (/\b(avisa|lembra)\b/.test(t) && /\bdaqui a\b/.test(t))) {
      const seg = segundosDoTimer(t);
      if (!seg) return { resposta: "De quanto tempo? Diga, por exemplo, 5 minutos." };
      return pedido("celular", "timer", String(seg), `Timer de ${descreverDuracao(seg)}.`);
    }

    // alarme: "me acorda às 7h", "alarme para 7:30"
    if (/\b(alarme|despertador|acorda|acordar|desperta|despertar)\b/.test(t)) {
      const hora = horaDoAlarme(t, original);
      if (!hora) return { resposta: "Para que horas? Diga, por exemplo, 7 horas ou 6 e meia." };
      return pedido("celular", "alarme", hora, `Alarme marcado para ${hora}.`);
    }

    // música
    if (/\b(proxima|pula|pular|avanca)\b.*\b(musica|faixa)\b/.test(t)) return pedido("celular", "midia_proxima", "", "Próxima música.");
    if (/\b(anterior|volta|voltar)\b/.test(t) && /\b(musica|faixa)\b/.test(t)) return pedido("celular", "midia_anterior", "", "Música anterior.");
    if (/\b(pausa|pause|pausar|parar|retoma|continua|toca|tocar|play)\b.*\b(musica|video)\b/.test(t)) {
      return pedido("celular", "midia_tocar_pausar", "", "Pronto, play ou pause na música.");
    }
    return null;
  }

  function interpretar(texto) {
    const t = norm(texto);
    if (!t) return null;

    if (pendente) {
      const p = pendente;
      pendente = null;
      if (Date.now() < p.expira) {
        if (/^(sim|confirmo|confirma|pode|claro|isso|isso mesmo|manda ver)\b/.test(t)) return p.pedido;
        if (/^(nao|cancela|cancele|deixa|esquece)\b/.test(t)) return { resposta: "Tudo bem, cancelei." };
      }
    }

    const noPc = rePc.test(t);

    // ----- bateria (lida no próprio aparelho, sem Tasker)
    if (/\bbateria\b/.test(t) && !noPc
      && (/\b(celular|telefone)\b/.test(t) || /\b(quanto|qual|nivel|como|carga|porcentagem|tenho|resta|restam|sobrou)\b/.test(t))) {
      return { local: "bateria" };
    }

    // ----- celular
    if (!noPc) {
      const c = comandoWhatsapp(texto) || comandoCelular(t, texto);
      if (c) {
        if (c.acao && !cfg.topicoCelular) {
          return { resposta: "Ainda não sei falar com o seu celular. Abra a engrenagem, preencha o tópico do celular em Dispositivos e toque em Salvar." };
        }
        return c;
      }
    }

    // ----- PC
    if (!cfg.topicoPc || !noPc) return null;
    const original = String(texto).toLowerCase();

    if (/\bcancel(a|e|ar)\b/.test(t) && /\b(desligamento|desligar)\b/.test(t)) {
      return pedido("pc", "cancelar_desligamento", "", "Desligamento cancelado.");
    }
    if (/\bbloque(ia|ie|ar)\b/.test(t)) return pedido("pc", "bloquear", "", "Bloqueando o PC.");

    if (/\b(volume|som)\b/.test(t) || reMudo.test(t)) {
      const passos = (t.match(/\b(\d{1,3})\b/) || [])[1] || "";
      if (reMudo.test(t) || reDesligar.test(t)) return pedido("pc", "mudo", "", "Pronto, alternei o mudo do PC.");
      if (/\b(aumenta|aumente|aumentar|sobe|suba|subir|mais)\b/.test(t)) return pedido("pc", "volume_mais", passos, "Aumentando o volume do PC.");
      if (/\b(abaixa|abaixe|abaixar|diminui|diminua|diminuir|baixa|baixe|baixar|reduz|reduza|reduzir|menos)\b/.test(t)) {
        return pedido("pc", "volume_menos", passos, "Diminuindo o volume do PC.");
      }
    }

    if (/\bproxima\b.*\b(musica|faixa)\b/.test(t)) return pedido("pc", "midia_proxima", "", "Próxima música.");
    if (/\b(anterior|volta)\b.*\b(musica|faixa)\b/.test(t)) return pedido("pc", "midia_anterior", "", "Música anterior.");
    if (/\b(pausa|pause|pausar|retoma|continua|play)\b.*\b(musica|video|som)\b/.test(t)) {
      return pedido("pc", "midia_tocar_pausar", "", "Pronto, play ou pause no PC.");
    }

    if (/\b(reinicia|reinicie|reiniciar)\b/.test(t)) {
      return confirmar(pedido("pc", "reiniciar", "1", "Reiniciando o PC em 1 minuto."), "Quer mesmo reiniciar o PC? Diga sim para confirmar.");
    }
    if (reDesligar.test(t)) {
      const min = (t.match(/\bem (\d{1,3}) minutos?\b/) || [])[1] || "1";
      const fala = min === "1" ? "Desligando o PC em 1 minuto." : `Desligando o PC em ${min} minutos.`;
      return confirmar(pedido("pc", "desligar", min, fala), "Quer mesmo desligar o PC? Diga sim para confirmar.");
    }

    const site = original.match(/\b(?:abre|abra|abrir)\b.*?\bsite\s+(\S+\.\S+)/);
    if (site) return pedido("pc", "abrir_site", site[1].replace(/[.,!?]+$/, ""), "Abrindo o site no PC.");

    const busca = original.match(/pesquis(?:a|e|ar)\s+(.+?)\s+n[oa]\s+(?:meu\s+)?(?:pc|computador|notebook|laptop)\b/);
    if (busca) return pedido("pc", "pesquisar", busca[1], "Pesquisando no PC.");

    const app = t.match(/\b(?:abre|abra|abrir)\s+(?:o |a )?(.+?)\s+no\s+(?:meu )?(?:pc|computador|notebook|laptop)\b/);
    if (app) return pedido("pc", "abrir_app", app[1], `Abrindo ${app[1]} no PC.`);

    return null;
  }

  async function enviar(alvo, acao, valor = "", topicoForcado = "") {
    const topico = limparTopico(topicoForcado || (alvo === "pc" ? cfg.topicoPc : cfg.topicoCelular));
    if (!topico) throw new Error(`Defina o tópico do ${alvo === "pc" ? "PC" : "celular"} em Configurações.`);
    if (alvo === "celular" && !ACOES_CELULAR.has(acao)) {
      throw new Error(`A ação "${acao}" ainda não está configurada no Tasker.`);
    }
    const base = (cfg.ntfyServidor || "https://ntfy.sh").replace(/\/+$/, "");
    let res;
    try {
      // text/plain evita a verificação prévia (preflight) do navegador.
      res = await fetch(`${base}/${encodeURIComponent(topico)}`, { method: "POST", body: `${acao}|${valor}` });
    } catch (_) {
      throw new Error("Não consegui falar com o ntfy. Confira a internet.");
    }
    if (res.status === 429) throw new Error("O ntfy bloqueou por excesso de mensagens (limite diário). Tente mais tarde.");
    if (res.status === 404 || res.status === 400) {
      throw new Error(`O ntfy não aceitou o tópico "${topico}" (erro ${res.status}). Confira o nome em Configurações.`);
    }
    if (!res.ok) throw new Error(`O ntfy respondeu ${res.status}.`);
  }

  // Ferramentas (function calling) oferecidas ao modo Live, só para os dispositivos configurados.
  function declaracoes() {
    const lista = [];
    if (cfg.topicoCelular) {
      lista.push({
        name: "controlar_celular",
        description: "Executa uma ação no celular Android do usuário: lanterna, volume de mídia, modo silencioso, som normal, abrir site, abrir app, alarme, timer e controle de música. Use quando ele pedir.",
        parameters: {
          type: "OBJECT",
          properties: {
            acao: { type: "STRING", description: "Ação a executar.", enum: [...ACOES_CELULAR] },
            valor: { type: "STRING", description: "Para volume_midia: nível de 0 a 15. Para abrir_site: endereço do site. Para abrir_app: nome do app (ex.: whatsapp). Para alarme: hora no formato HH:MM. Para timer: duração em segundos. Vazio nas outras ações." },
          },
          required: ["acao"],
        },
      });
    }
    if (cfg.topicoCelular && contatos().length) {
      lista.push({
        name: "abrir_whatsapp",
        description: "Abre no celular a conversa do WhatsApp com um contato cadastrado, com uma mensagem opcional já escrita (o usuário só precisa enviar). Contatos: "
          + contatos().map((c) => c.nome).join(", ") + ".",
        parameters: {
          type: "OBJECT",
          properties: {
            contato: { type: "STRING", description: "Nome do contato." },
            mensagem: { type: "STRING", description: "Mensagem opcional para deixar escrita." },
          },
          required: ["contato"],
        },
      });
    }
    if (navigator.getBattery) {
      lista.push({
        name: "ler_bateria",
        description: "Lê o nível de bateria do aparelho em que o usuário está falando e se ele está carregando.",
      });
    }
    if (cfg.topicoPc) {
      lista.push({
        name: "controlar_pc",
        description: "Executa uma ação no computador (PC) do usuário: abrir apps e sites, volume, mídia, bloquear, desligar. Use quando ele pedir.",
        parameters: {
          type: "OBJECT",
          properties: {
            acao: { type: "STRING", description: "Ação a executar.", enum: [...ACOES_PC] },
            valor: {
              type: "STRING",
              description: "Endereço do site, termo de pesquisa, nome do app (ex.: spotify), passos de volume ou minutos para desligar. Vazio se não precisar.",
            },
            confirmado: {
              type: "BOOLEAN",
              description: "true somente depois que o usuário confirmou, em voz, desligar ou reiniciar o PC.",
            },
          },
          required: ["acao"],
        },
      });
    }
    return lista;
  }

  // Executa a chamada pedida pelo modelo e devolve o resultado para ele.
  async function executar(nome, args = {}) {
    if (nome === "ler_bateria") {
      const b = await lerBateria();
      return b || { erro: "Este navegador não permite ler a bateria." };
    }
    if (nome === "abrir_whatsapp") {
      const contato = acharContato(args.contato);
      if (!contato) return { erro: `Contato não encontrado. Os cadastrados são: ${contatos().map((c) => c.nome).join(", ") || "nenhum"}.` };
      const url = urlWhatsapp(contato, String(args.mensagem || "").trim());
      if (!url) return { erro: "O número desse contato está incompleto." };
      try {
        await enviar("celular", "abrir_site", url);
        return { resultado: "Conversa aberta no celular; o usuário precisa tocar em enviar." };
      } catch (e) {
        return { erro: e.message };
      }
    }
    const alvo = nome === "controlar_pc" ? "pc" : nome === "controlar_celular" ? "celular" : null;
    if (!alvo) return { erro: `Ferramenta desconhecida: ${nome}` };
    const acao = String(args.acao || "");
    const valor = args.valor == null ? "" : String(args.valor);
    if (alvo === "pc") {
      if (!ACOES_PC.has(acao)) return { erro: `Ação desconhecida: ${acao}` };
      if (PERIGOSAS.has(acao) && args.confirmado !== true) {
        return { erro: "Pergunte ao usuário se ele confirma e só depois chame de novo com confirmado=true.", silencioso: true };
      }
    }
    let valorFinal = valor;
    if (alvo === "celular" && acao === "abrir_site") {
      valorFinal = urlSegura(valor);
      if (!valorFinal) return { erro: "Informe um endereço de site válido (http ou https)." };
    }
    if (alvo === "celular" && acao === "abrir_app") {
      valorFinal = nomeAppSeguro(valor);
      if (!valorFinal) return { erro: "Informe o nome do app." };
    }
    if (alvo === "celular" && acao === "alarme") {
      const m = String(valor).match(/^(\d{1,2}):(\d{2})$/);
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { erro: "Informe a hora do alarme no formato HH:MM." };
      valorFinal = `${m[1].padStart(2, "0")}:${m[2]}`;
    }
    if (alvo === "celular" && acao === "timer") {
      const n = Math.round(Number(valor));
      if (!Number.isFinite(n) || n < 1 || n > 86400) return { erro: "Informe a duração do timer em segundos (1 a 86400)." };
      valorFinal = String(n);
    }
    if (alvo === "celular" && acao === "volume_midia") {
      const n = Number(valor);
      if (!Number.isFinite(n)) return { erro: "Informe o nível do volume, de 0 a 15." };
      valorFinal = String(Math.max(0, Math.min(15, Math.round(n))));
    }
    try {
      await enviar(alvo, acao, valorFinal);
      return { resultado: "ok" };
    } catch (e) {
      return { erro: e.message };
    }
  }

  return { interpretar, enviar, limparTopico, declaracoes, executar, textoBateria };
})();
