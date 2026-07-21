# Controle Remoto Web

Site que funciona como um controle remoto de TV, direto do navegador (celular ou computador),
sem precisar instalar nada na TV.

## Como funciona de verdade (importante ler)

Um navegador **não consegue** enviar sinal de infravermelho nem usar HDMI-CEC — isso é uma
limitação física, nenhum site resolve isso. O que este app faz é usar os **protocolos de rede
local** que as próprias Smart TVs expõem:

| Marca | Suporte | Como |
|---|---|---|
| **Android TV com pareamento (Philco / Shield / TCL / genérico)** | ✅ Funciona de verdade, com uma peça extra | Protocolo oficial **Android TV Remote v2** (o que pede código na tela). Requer a **ponte local** em `bridge/` (não dá pra rodar isso no Render — veja `bridge/README.md`) |
| **Android TV / Google TV (sem ponte)** | ⚠️ Parcial — abre apps de verdade | Protocolo **DIAL** (o mesmo do Chromecast), via HTTP, sem pareamento. Não cobre setas/volume/power |
| **Sony Bravia (Android TV)** | ✅ Funciona de verdade | Protocolo oficial **IRCC-IP** da Sony via HTTP, autenticado com uma chave PSK que você cria na própria TV. Cobre setas, volume, canal, power e números |
| **Roku / TVs com Roku TV** | ✅ Funciona de verdade | Protocolo oficial **ECP** (External Control Protocol) via HTTP, sem senha |
| **Samsung (Tizen)** | ⚠️ Melhor esforço | WebSocket local com pareamento — a TV pode pedir para você aceitar a conexão na tela |
| **LG (webOS)** | ❌ Não suportado | Exige certificado/token pareado pelo app oficial da LG; não é possível replicar isso com segurança em uma página web comum |

**Se sua TV pede um código de pareamento na tela (caso da Philco)**: isso é o protocolo oficial
"Android TV Remote v2" da Google. Ele usa um socket TCP com TLS, que **nenhum navegador consegue
abrir** — não é algo que dê pra contornar só no front-end. Por isso incluí a pasta `bridge/`: um
servidorzinho Node.js que roda na sua rede local, fala esse protocolo de verdade, e expõe isso como
HTTP simples para o site. Veja `bridge/README.md` para instalar e rodar.

### Por que isso roda no navegador, e não no servidor do Render?

A TV está na rede Wi-Fi da sua casa. O servidor do Render está na internet, fora dessa rede — ele
**não tem como** alcançar sua TV. Por isso toda a lógica de envio de comando roda em JavaScript
*no seu próprio celular/computador*, que aí sim está na mesma rede da TV. O Render só hospeda os
arquivos (HTML/CSS/JS); quem fala com a TV é o seu navegador.

### Aviso sobre HTTPS

O Render serve o site em HTTPS. Navegadores bloqueiam por padrão que uma página HTTPS faça
requisições para um endereço **HTTP** simples (como a TV, que não tem certificado) — é o bloqueio
de "conteúdo misto". Se os botões não responderem:

1. Confirme que celular/computador e TV estão na **mesma rede Wi-Fi**.
2. Confirme o IP da TV (Configurações → Rede, na TV).
3. No navegador, se aparecer um ícone de cadeado/escudo na barra de endereço, procure a opção
   "Permitir conteúdo não seguro" para este site.
4. Como alternativa mais garantida, rode o site localmente (veja abaixo) e acesse por `http://`.

## Estrutura dos arquivos

```
index.html      → interface do controle
style.css       → visual (tema escuro, estilo controle físico)
script.js       → lógica de conexão e envio de comandos
render.yaml     → configuração para deploy automático no Render (Static Site)
package.json    → só necessário se você preferir o modo "Web Service" (Node)
server.js       → servidor Express simples, alternativa ao Static Site
bridge/         → ponte local p/ Android TV com pareamento (Philco etc.) — roda na sua rede, não no Render
```

## Deploy no Render (recomendado: Static Site)

1. Crie um repositório no GitHub e suba estes arquivos.
2. No Render, clique em **New → Static Site**.
3. Conecte o repositório.
4. Configurações:
   - **Build Command**: (deixe em branco)
   - **Publish Directory**: `.`
5. Clique em **Create Static Site**. Pronto — o `render.yaml` já deixa isso automático se você
   usar "New → Blueprint" em vez do passo a passo manual.

## Alternativa: Web Service (Node)

Se preferir rodar como serviço Node em vez de site estático:

1. No Render, **New → Web Service**.
2. Build Command: `npm install`
3. Start Command: `npm start`
4. O `server.js` incluso só serve os arquivos estáticos — nenhuma chamada à TV passa pelo servidor.

## Rodando localmente (para testar antes do deploy)

Sem Node:
```bash
cd tvremote
python3 -m http.server 8080
```
Depois acesse `http://localhost:8080` (ou `http://SEU-IP-LOCAL:8080` pelo celular).

Com Node:
```bash
npm install
npm start
```

## Uso

1. Abra o site pelo celular, na mesma rede Wi-Fi da TV.
2. Selecione a marca/plataforma:
   - **Sony Bravia**: também informe a chave PSK (crie em Configurações → Rede → Config. de rede
     doméstica → Controle IP na própria TV).
   - **Android TV genérico**: sem PSK, mas lembre que só os botões de app funcionam de verdade.
3. Digite o IP local da TV e toque em **Conectar**.
4. Use o controle: D-pad, volume, canal, apps, teclado numérico, etc.
