# Quinta-Feira

Interface de assistente pessoal no estilo J.A.R.V.I.S., com o cérebro rodando no **n8n**.

- Núcleo animado que muda de cor conforme o estado (aguardando, ouvindo, processando, respondendo) e reage ao som do microfone
- Comando de voz em português (botão de microfone ou **Ctrl + Espaço**)
- Respostas lidas em voz alta, com escolha de voz, velocidade e tom
- Registro da conversa, relógio, painel de diagnóstico e comandos rápidos
- Modo offline com comandos básicos (hora, data, contas, "pesquise…", "abra o YouTube") quando o n8n não está conectado

É só HTML, CSS e JavaScript, sem build e sem dependências.

## Abrir online

**https://rafaeldatsch4-afk.github.io/quinta-feira-assistente/**

Funciona no computador e no celular (Chrome ou Edge). O site é atualizado
automaticamente pelo GitHub Actions (`.github/workflows/pages.yml`) a cada push.

## Como rodar localmente

O microfone só funciona em `localhost` ou HTTPS, então sirva a pasta com um servidor local:

```bash
npx http-server -p 8080
# ou
python3 -m http.server 8080
```

Abra `http://localhost:8080` no **Chrome** ou **Edge** (o reconhecimento de voz não funciona no Firefox).

## Conectando ao n8n

1. No n8n, vá em **Workflows → Import from File** e importe `n8n/quinta-feira-workflow.json`.
2. Abra o nó **Modelo de Chat** e selecione sua credencial (OpenAI por padrão; pode trocar por Claude, Gemini, Ollama etc.).
3. **Ative** o workflow e copie a **Production URL** do nó **Webhook**
   (algo como `https://seu-n8n.com/webhook/quinta-feira`).
4. Na interface, clique na engrenagem, cole a URL em **Webhook do n8n**, clique em **Testar conexão** e depois em **Salvar**.

O workflow de exemplo é:

```
Webhook (POST) ──► AI Agent ──► Respond to Webhook
                    ├─ Modelo de Chat
                    └─ Memória (por sessionId)
```

### Voz neural (recomendado)

A voz do navegador costuma soar robótica, principalmente no Android. Para uma voz
natural, o n8n gera o áudio e a interface toca. O workflow de exemplo já faz isso:

```
AI Agent ──► Gerar voz (OpenAI, voz "nova") ──► Áudio em base64 ──► Responder
```

Para adicionar num workflow que já existe, entre o **AI Agent** e o **Respond to Webhook**:

1. Nó **OpenAI → Generate audio** (Text to speech): *Text Input* `{{ $json.output }}`,
   *Voice* `Nova` ou `Shimmer` (femininas), *Model* `tts-1`.
2. Nó **Extract from File → Move File to Base64 String**: *Input Binary Field* `data`,
   *Destination Output Field* `audio`.
3. No **Respond to Webhook** (Respond With: JSON):
   ```
   {{ { "output": $('AI Agent').item.json.output, "audio": $json.audio, "audioMime": "audio/mpeg" } }}
   ```

Também funciona com ElevenLabs ou outro serviço de voz (via *HTTP Request* devolvendo
o arquivo): basta responder com `audio` em base64, ou com `audioUrl` apontando para um MP3.
Se a resposta não trouxer áudio, a interface usa a voz do navegador como reserva.

### O que a interface envia

`POST` com JSON:

```json
{
  "chatInput": "Que horas são?",
  "sessionId": "id-fixo-deste-navegador",
  "usuario": "Chefe",
  "historico": [{ "papel": "usuario", "texto": "..." }],
  "dataHora": "2026-10-22T13:00:00.000Z",
  "horaLocal": "quinta-feira, 22 de outubro de 2026 às 10:00",
  "fusoHorario": "America/Sao_Paulo",
  "origem": "quinta-feira-ui",
  "querAudio": true
}
```

No n8n, acesse como `{{ $json.body.chatInput }}`, `{{ $json.body.sessionId }}` etc.

### O que o n8n deve responder

Qualquer um destes formatos funciona:

```json
{ "output": "Agora são 10h.", "audio": "<mp3 em base64>", "audioMime": "audio/mpeg" }
{ "output": "Agora são 10h." }
{ "resposta": "Agora são 10h." }
[ { "output": "Agora são 10h." } ]
```

ou texto puro.

**Ações opcionais:** se a resposta trouxer um campo `acao`, a interface executa:

```json
{ "output": "Abrindo o YouTube.", "acao": { "tipo": "abrir_url", "url": "https://youtube.com" } }
```

### Dicas

- **CORS:** se a interface estiver em outro domínio que o n8n, defina *Allowed Origins (CORS)* no nó Webhook (o exemplo já vem com `*`).
- **Segurança:** a interface suporta os dois tipos de *Authentication* do Webhook:
  - *Basic Auth*: escolha **Basic Auth** nas Configurações e informe o mesmo usuário e senha da credencial do n8n.
  - *Header Auth*: crie a credencial com nome `Authorization` e valor `Bearer SEU_TOKEN`, escolha **Header Auth** e coloque `SEU_TOKEN` no campo **Token**.

  As credenciais ficam salvas só no navegador (localStorage), nunca no código.
- **Ferramentas:** conecte tools ao AI Agent (Google Calendar, Gmail, HTTP Request, clima…) para a Quinta-Feira executar tarefas de verdade.
- As configurações ficam salvas no navegador (localStorage). Para deixar uma URL padrão para todos, edite `js/config.js`.

## Estrutura

```
index.html                     página
css/style.css                  visual (HUD)
js/config.js                   configurações padrão e persistência
js/nucleo.js                   animação do núcleo (canvas)
js/cerebro.js                  integração com o n8n + modo offline
js/app.js                      voz, chat, painéis e configurações
n8n/quinta-feira-workflow.json workflow de exemplo para importar
```
