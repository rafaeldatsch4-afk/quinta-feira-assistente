/* Configuração da Quinta-Feira.
   Os valores abaixo são o padrão; o que for alterado na tela de
   Configurações fica salvo no navegador (localStorage). */
window.QF_PADRAO = {
  nomeUsuario: "Chefe",
  // URL de produção do nó Webhook do seu workflow no n8n.
  // Ex.: "https://seu-n8n.com/webhook/quinta-feira"
  webhookUrl: "https://quinta-feira-assistente.app.n8n.cloud/webhook/quinta-feira",
  // Autenticação do Webhook: "nenhuma", "basic" (usuário e senha) ou "bearer" (token).
  // As credenciais ficam só no navegador; preencha pela tela de Configurações.
  authTipo: "basic",
  authUsuario: "",
  authSenha: "",
  token: "",
  // Modo Live (conversa em tempo real direto com o Gemini, sem n8n).
  // A chave fica só no navegador; preencha pela tela de Configurações.
  geminiKey: "",
  liveModelo: "gemini-3.8-live",
  // Dispositivos (ntfy): tópicos secretos do celular (Tasker) e do PC.
  // Ficam só no navegador; preencha pela tela de Configurações.
  ntfyServidor: "https://ntfy.sh",
  topicoCelular: "",
  topicoPc: "",
  // Contatos do WhatsApp, uma linha por contato: nome=número com DDD.
  contatos: "",
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
  // Configurações antigas só tinham "token" (Bearer).
  if (salvo.token && !salvo.authTipo) salvo.authTipo = "bearer";
  const cfg = { ...window.QF_PADRAO, ...salvo };

  cfg.salvar = (novos) => {
    Object.assign(cfg, novos);
    const dados = {};
    for (const k of Object.keys(window.QF_PADRAO)) dados[k] = cfg[k];
    try { localStorage.setItem(CHAVE, JSON.stringify(dados)); } catch (_) {}
  };
  return cfg;
})();
