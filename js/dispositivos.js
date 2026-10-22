/* Controle do celular (Tasker) e do PC (Quinta-PC) pelo ntfy, direto do navegador.
   Entende comandos como "liga a lanterna" e publica "acao|valor" no tópico do dispositivo. */
window.Dispositivos = (() => {
  const cfg = window.QF_CONFIG;

  // Ações que o Tasker do celular já sabe executar. Acrescente aqui ao criar novas no Tasker.
  const ACOES_CELULAR = new Set(["lanterna_ligar", "lanterna_desligar"]);

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
    if (cfg.topicoCelular && !noPc && /\blanterna\b/.test(t)) {
      if (reDesligar.test(t)) return pedido("celular", "lanterna_desligar", "", "Lanterna apagada.");
      if (reLigar.test(t)) return pedido("celular", "lanterna_ligar", "", "Lanterna ligada.");
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

  return { interpretar, enviar, limparTopico };
})();
