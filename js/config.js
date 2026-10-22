/* Configuração da Quinta-Feira.
   Os valores abaixo são o padrão; o que for alterado na tela de
   Configurações fica salvo no navegador (localStorage). */
window.QF_PADRAO = {
  nomeUsuario: "Chefe",
  // URL de produção do nó Webhook do seu workflow no n8n.
  // Ex.: "https://seu-n8n.com/webhook/quinta-feira"
  webhookUrl: "",
  // Token opcional enviado como "Authorization: Bearer <token>".
  token: "",
  voz: "",
  velocidade: 1,
  tom: 1,
  falarRespostas: true,
  idioma: "pt-BR",
  timeoutMs: 60000,
};

window.QF_CONFIG = (() => {
  const CHAVE = "quinta-feira:config";
  let salvo = {};
  try { salvo = JSON.parse(localStorage.getItem(CHAVE) || "{}"); } catch (_) {}
  const cfg = { ...window.QF_PADRAO, ...salvo };

  cfg.salvar = (novos) => {
    Object.assign(cfg, novos);
    const dados = {};
    for (const k of Object.keys(window.QF_PADRAO)) dados[k] = cfg[k];
    try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (_) {}
  };
  return cfg;
})();
