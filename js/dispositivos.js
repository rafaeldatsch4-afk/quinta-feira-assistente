/* Controle do celular (Tasker) e do PC (Quinta-PC) pelo ntfy, direto do navegador.
   Entende comandos como "liga a lanterna" e publica "acao|valor" no tópico do dispositivo. */
window.Dispositivos = (() => {
  const cfg = window.QF_CONFIG;

  // Ações que o Tasker do celular já sabe executar. Acrescente aqui ao criar novas no Tasker.
  const ACOES_CELULAR = new Set(["lanterna_ligar", "lanterna_desligar", "volume_midia", "silencioso", "som_normal"]);

  // Ações que o Quinta-PC aceita (quinta_pc.py). Desligar/reiniciar exigem confirmação.
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

    // ----- celular
    if (!noPc) {
      const c = comandoCelular(t, texto);
      if (c) {
        if (!cfg.topicoCelular) {
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
        description: "Executa uma ação no celular Android do usuário: lanterna, volume de mídia, modo silencioso e som normal. Use quando ele pedir.",
        parameters: {
          type: "OBJECT",
          properties: {
            acao: { type: "STRING", description: "Ação a executar.", enum: [...ACOES_CELULAR] },
            valor: { type: "STRING", description: "Para volume_midia: nível de 0 a 15. Vazio nas outras ações." },
          },
          required: ["acao"],
        },
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

  return { interpretar, enviar, limparTopico, declaracoes, executar };
})();
