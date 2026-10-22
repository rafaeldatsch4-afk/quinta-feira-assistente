# Ações no celular e no PC

A Quinta-Feira pode executar ações nos seus dispositivos: acender a lanterna, abrir apps,
mexer no volume, bloquear ou desligar o PC etc.

```
Você fala ──► n8n (AI Agent decide) ──► ntfy ──┬─► Celular: app ntfy ─► Tasker executa
                                               └─► PC: Quinta-PC (Python) executa
```

O agente do n8n ganha duas ferramentas, **acao_celular** e **acao_pc**. Cada uma publica uma
mensagem curta no formato `acao|valor` (ex.: `abrir_app|spotify`) num tópico do
[ntfy](https://ntfy.sh). O celular e o PC ficam escutando seus tópicos e executam só as
ações da lista. Nada que venha da IA vira comando livre.

## 1. Escolha os tópicos secretos

Os tópicos funcionam como senha: quem souber o nome pode mandar ações. Use nomes longos
e aleatórios, um para cada dispositivo, por exemplo:

```
quinta-8f3k2m9x7q1w-pc
quinta-8f3k2m9x7q1w-celular
```

Não publique esses nomes em lugar nenhum.

> **Limite do ntfy grátis:** 250 mensagens por dia **por endereço IP**. O n8n cloud usa IPs
> compartilhados, então o limite pode acabar por uso de outras pessoas (o erro é
> `429 ... daily message quota reached`). Se acontecer, o plano *Supporter* do ntfy
> (ntfy.sh → Account) resolve; crie um *access token* e coloque-o no cabeçalho
> `Authorization: Bearer tk_...` das ferramentas do n8n e no campo `token` do config do PC.

## 2. PC (Windows)

1. Instale o [Python](https://www.python.org/downloads/) marcando **Add Python to PATH**.
2. Baixe a pasta `dispositivos/pc` deste repositório.
3. Copie `config.exemplo.json` para `config.json` e edite:
   - `topico`: o seu tópico do PC.
   - `apps`: os apps que ela pode abrir (nome falado → caminho do .exe, atalho ou comando).
   - `comandos`: comandos seus com nome (ex.: `"modo jogo"`). Só esses podem ser rodados.
4. Teste sem executar nada: `python quinta_pc.py --teste`
5. Rode de verdade: dois cliques em `iniciar_quinta_pc.bat` (roda sem janela).
6. Para iniciar com o Windows: `Win + R` → `shell:startup` → cole ali um atalho do `.bat`.

O histórico fica em `quinta_pc.log`, na mesma pasta.

**Ações do PC**

| Ação | Valor | O que faz |
|---|---|---|
| `abrir_site` | endereço | Abre no navegador (só http/https) |
| `pesquisar` | termo | Pesquisa no Google |
| `youtube` | termo | Pesquisa no YouTube |
| `abrir_app` | nome cadastrado | Abre um app do `config.json` |
| `comando` | nome cadastrado | Roda um comando do `config.json` |
| `volume_mais` / `volume_menos` | passos (padrão 5 ≈ 10%) | Volume |
| `mudo` | — | Liga/desliga o mudo |
| `midia_tocar_pausar` / `midia_proxima` / `midia_anterior` | — | Controle de mídia |
| `bloquear` | — | Bloqueia a tela |
| `desligar` / `reiniciar` | minutos (padrão 1) | Agenda desligar/reiniciar |
| `cancelar_desligamento` | — | Cancela o agendamento |

Pedidos com mais de 2 minutos são ignorados, para o PC não desligar sozinho ao ligar
por causa de um pedido antigo.

## 3. Celular (Android + Tasker)

### 3.1 ntfy

1. Instale o app **ntfy** (Play Store ou F-Droid).
2. Toque em **+**, inscreva-se no seu tópico do celular (servidor `ntfy.sh`) e ligue
   **Instant delivery**.
3. Nas configurações do tópico, **silencie as notificações** (o Tasker continua recebendo).
4. Nas configurações do Android, tire o ntfy da **otimização de bateria**.

### 3.2 Tasker

**Perfil** → *Event* → *System* → **Intent Received**
- *Action*: `io.heckel.ntfy.MESSAGE_RECEIVED`

**Tarefa** "Quinta Ação" (ligada ao perfil):

1. *Task* → **Stop** — com a condição *If* `%topic` **neq** `SEU-TOPICO-celular`
   (ignora mensagens de outros tópicos).
2. *Variables* → **Variable Set**: `%pedido` = `%message`
3. *Variables* → **Variable Split**: `%pedido`, *Splitter* `|`
   (cria `%pedido1` = ação e `%pedido2` = valor)
4. Uma ação para cada pedido, cada uma com a condição *If* `%pedido1` **eq** `nome_da_acao`:

| `%pedido1` | Ação do Tasker | Configuração |
|---|---|---|
| `lanterna_ligar` | Alert → **Torch** | Set: On |
| `lanterna_desligar` | Alert → **Torch** | Set: Off |
| `volume_midia` | Audio → **Media Volume** | Level: `%pedido2` (0 a 15) |
| `silencioso` | Audio → **Sound Mode** | Mode: Silent |
| `som_normal` | Audio → **Sound Mode** | Mode: Sound |
| `nao_perturbe_ligar` | Audio → **Do Not Disturb** | Mode: Priority |
| `nao_perturbe_desligar` | Audio → **Do Not Disturb** | Mode: Allow All |
| `abrir_app` | App → **Launch App** | Package/App Name: `%pedido2` |
| `abrir_site` | Net → **Browse URL** | URL: `%pedido2` |
| `midia_tocar_pausar` | Media → **Media Control** | Cmd: Toggle Pause |
| `midia_proxima` | Media → **Media Control** | Cmd: Next |
| `midia_anterior` | Media → **Media Control** | Cmd: Previous |
| `alarme` | Variable Split `%pedido2` com `:` e depois App → **Set Alarm** | Hours: `%pedido21`, Minutes: `%pedido22` |

**Dicas (testadas no Tasker em português):**
- O campo **Ação** do evento é o primeiro da tela; não toque no ícone de etiqueta ao lado (abre a lista de variáveis).
- Depois de criar o perfil, toque no **✓** do topo da tela de Perfis para aplicá-lo. Sem isso o perfil não dispara.
- Para ver se o Tasker recebe as mensagens, deixe uma ação **Alerta → Flash** com o texto `%message` como primeira ação da tarefa.
- Na lista de ações, use a **lupa** para achar a ação pelo nome (ex.: "lanterna").
- Na condição *Se*, o operador `~` (corresponde) funciona igual a *igual*.
- Ao testar pelo app ntfy, o teclado põe maiúscula na primeira letra (`Lanterna_ligar` ≠ `lanterna_ligar`). Toque em ⬆ antes de digitar.

Os nomes das ações do Tasker podem variar um pouco conforme a versão. Para Wi-Fi e
Bluetooth, o Android 10+ exige o app auxiliar **Tasker Settings**.

Para testar sem o n8n: no navegador, abra `https://ntfy.sh/SEU-TOPICO-celular`, digite
`lanterna_ligar` e envie.

## 4. n8n: ferramentas do agente

No workflow, clique no **+** de *Tool* do **AI Agent** e adicione duas **HTTP Request Tool**
(ou importe `n8n/quinta-feira-workflow.json`, que já vem com elas):

**acao_pc**
- *Description*: `Executa uma ação no computador (PC) do usuário. Ações: abrir_site (valor: endereço), pesquisar (valor: termo), youtube (valor: termo), abrir_app (valor: spotify, chrome, bloco de notas, calculadora, explorador, vscode, discord, steam), comando (valor: modo jogo, limpar lixeira), volume_mais (valor: passos), volume_menos (valor: passos), mudo, midia_tocar_pausar, midia_proxima, midia_anterior, bloquear, desligar (valor: minutos), reiniciar (valor: minutos), cancelar_desligamento.`
- *Method*: `POST` · *URL*: `https://ntfy.sh/SEU-TOPICO-pc`
- *Send Headers*: `Priority` = `1` (e, se tiver, `Authorization` = `Bearer tk_...`)
- *Send Body*: *Body Content Type* **Raw**, *Content Type* `text/plain`, *Body*:
  ```
  {{ $fromAI('acao', 'nome da ação, exatamente como na lista', 'string') }}|{{ $fromAI('valor', 'valor da ação, ou vazio', 'string', '') }}
  ```

**acao_celular**
- *Description*: `Executa uma ação no celular Android do usuário. Ações: lanterna_ligar, lanterna_desligar, volume_midia (valor: 0 a 15), silencioso, som_normal, nao_perturbe_ligar, nao_perturbe_desligar, abrir_app (valor: nome do app), abrir_site (valor: endereço), midia_tocar_pausar, midia_proxima, midia_anterior, alarme (valor: HH:MM).`
- Igual à de cima, com a URL `https://ntfy.sh/SEU-TOPICO-celular`.

Acrescente ao *System Message* do agente:

```
Você pode controlar o celular e o PC do usuário com as ferramentas acao_celular e acao_pc. Use só as ações listadas nelas. Para desligar ou reiniciar o PC, peça confirmação antes. Depois de usar uma ferramenta, confirme em uma frase curta o que fez.
```

Quando cadastrar apps ou comandos novos no `config.json` do PC, atualize também a
*Description* da ferramenta **acao_pc**, para o agente saber que eles existem.
