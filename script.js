/* ===================================================================
   Controle Remoto Web
   - Android TV / Google TV (genérico): abre apps via DIAL (protocolo
     aberto do Chromecast), direto do navegador, sem pareamento.
   - Sony Bravia (Android TV): controle completo via IRCC-IP, protocolo
     oficial da Sony por HTTP, autenticado com chave PSK definida na TV.
   - Roku: protocolo oficial ECP (External Control Protocol) por HTTP.
   - Samsung: tentativa via WebSocket local (API de controle Tizen).
   - LG (webOS): exige token pareado pelo app oficial da LG — não é
     possível replicar com segurança numa página web comum. O app avisa
     em vez de fingir que funciona.
   Em todos os casos, o comando sai do NAVEGADOR do usuário direto para
   o IP local da TV — o servidor hospedado no Render nunca fala com a TV.
=================================================================== */

const setupScreen  = document.getElementById('setup-screen');
const remoteScreen = document.getElementById('remote-screen');
const ipInput      = document.getElementById('tv-ip');
const brandSelect  = document.getElementById('tv-brand');
const pskGroup     = document.getElementById('psk-group');
const pskInput     = document.getElementById('tv-psk');
const bridgeGroup  = document.getElementById('bridge-group');
const bridgeInput  = document.getElementById('bridge-addr');
const pairGroup    = document.getElementById('pair-group');
const pairCodeInput = document.getElementById('pair-code');
const btnPair      = document.getElementById('btn-pair');
const capBadge     = document.getElementById('cap-badge');
const connectBtn   = document.getElementById('btn-connect');
const helpBtn      = document.getElementById('btn-help');
const helpBox      = document.getElementById('help-box');
const backSetupBtn = document.getElementById('btn-back-setup');
const deviceNameEl = document.getElementById('device-name');
const connDot      = document.getElementById('conn-dot');
const toastEl      = document.getElementById('toast');
const keypadToggle  = document.getElementById('toggle-keypad');
const keypad        = document.getElementById('keypad');
const footnoteEl    = document.getElementById('footnote');

let STATE = {
  brand: 'philco',
  ip: '',
  psk: '',
  bridgeAddr: 'http://localhost:4000',
  socket: null,   // websocket ativo (Samsung)
  pollTimer: null,
};

/* Nível de suporte real de cada marca/plataforma */
const CAPS = {
  philco:    { level: 'full',    label: 'Controle completo via ponte local (protocolo oficial Android TV Remote v2). Precisa rodar a pasta bridge/ na sua rede — veja o README dela.' },
  androidtv: { level: 'partial', label: 'Abre apps de verdade (DIAL). Setas/volume/power não têm protocolo aberto nesse modo sem a ponte.' },
  sony:      { level: 'full',    label: 'Controle completo via IRCC-IP oficial da Sony (setas, volume, canal, power, números).' },
  roku:      { level: 'full',    label: 'Controle completo via ECP oficial da Roku, sem senha.' },
  samsung:   { level: 'partial', label: 'Melhor esforço via WebSocket local — pode pedir pareamento na tela da TV.' },
  lg:        { level: 'none',    label: 'Não suportado: exige token pareado pelo app oficial da LG.' },
};

/* ---------------- Utilidades ---------------- */

function showToast(msg, ms = 1600) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  toastEl.style.opacity = '1';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.style.opacity = '0';
    setTimeout(() => toastEl.classList.add('hidden'), 200);
  }, ms);
}

function vibrate(ms = 15) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function saveConfig() {
  localStorage.setItem('remoteweb_config', JSON.stringify(STATE));
}

function loadConfig() {
  try {
    const raw = localStorage.getItem('remoteweb_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      STATE.brand = parsed.brand || 'philco';
      STATE.ip = parsed.ip || '';
      STATE.psk = parsed.psk || '';
      STATE.bridgeAddr = parsed.bridgeAddr || 'http://localhost:4000';
    }
  } catch (e) { /* ignore */ }
}

/* ---------------- Roku (ECP) ---------------- */

function rokuSend(path) {
  const url = `http://${STATE.ip}:8060${path}`;
  // mode: 'no-cors' -> não conseguimos ler a resposta, mas o comando
  // ainda é entregue e executado pela Roku.
  return fetch(url, { method: 'POST', mode: 'no-cors' });
}

function rokuKeypress(key) {
  return rokuSend(`/keypress/${encodeURIComponent(key)}`);
}

function rokuLaunch(appId) {
  return rokuSend(`/launch/${appId}`);
}

function rokuPing() {
  // Requisição leve só para checar se a TV responde na rede.
  return fetch(`http://${STATE.ip}:8060/query/device-info`, {
    method: 'GET',
    mode: 'no-cors',
  });
}

/* ---------------- Android TV / Google TV genérico (DIAL) ---------------- */
/* DIAL é o mesmo protocolo aberto usado pelo Chromecast para abrir apps.
   Não cobre setas/volume/power — só abrir um app já instalado na TV. */

function dialLaunch(appName) {
  const url = `http://${STATE.ip}:8008/apps/${encodeURIComponent(appName)}`;
  return fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  });
}

/* ---------------- Sony Bravia — IRCC-IP (protocolo oficial) ---------------- */
/* Requer a TV com Autenticação = "Normal e Chave Pré-Compartilhada" (PSK)
   em Configurações > Rede > Config. de rede doméstica > Controle IP. */

const SONY_IRCC = {
  Power: 'AAAAAQAAAAEAAAAVAw==',
  Home: 'AAAAAQAAAAEAAABgAw==',
  Back: 'AAAAAgAAAJcAAAAjAw==',
  Up: 'AAAAAQAAAAEAAAB0Aw==',
  Down: 'AAAAAQAAAAEAAAB1Aw==',
  Left: 'AAAAAQAAAAEAAAA0Aw==',
  Right: 'AAAAAQAAAAEAAAAzAw==',
  Select: 'AAAAAQAAAAEAAAALAw==',
  VolumeUp: 'AAAAAQAAAAEAAAASAw==',
  VolumeDown: 'AAAAAQAAAAEAAAATAw==',
  VolumeMute: 'AAAAAQAAAAEAAAAUAw==',
  ChannelUp: 'AAAAAQAAAAEAAAAQAw==',
  ChannelDown: 'AAAAAQAAAAEAAAARAw==',
  InstantReplay: 'AAAAAgAAAJcAAAAjAw==',
  Info: 'AAAAAQAAAAEAAAA6Aw==',
  Play: 'AAAAAgAAAJcAAAAaAw==',
  Rev: 'AAAAAgAAAJcAAAAbAw==',
  Fwd: 'AAAAAgAAAJcAAAAcAw==',
  InputHDMI1: 'AAAAAQAAAAEAAAAlAw==',
  Lit_0: 'AAAAAQAAAAEAAAAJAw==', Lit_1: 'AAAAAQAAAAEAAAAAAw==',
  Lit_2: 'AAAAAQAAAAEAAAABAw==', Lit_3: 'AAAAAQAAAAEAAAACAw==',
  Lit_4: 'AAAAAQAAAAEAAAADAw==', Lit_5: 'AAAAAQAAAAEAAAAEAw==',
  Lit_6: 'AAAAAQAAAAEAAAAFAw==', Lit_7: 'AAAAAQAAAAEAAAAGAw==',
  Lit_8: 'AAAAAQAAAAEAAAAHAw==', Lit_9: 'AAAAAQAAAAEAAAAIAw==',
  netflix: 'AAAAAgAAABoAAABMAw==',
};

function sonySend(rokuStyleKey) {
  const code = SONY_IRCC[rokuStyleKey];
  if (!code) return Promise.reject(new Error('tecla sem código para Sony'));

  const body = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body><u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1">
<IRCCCode>${code}</IRCCCode>
</u:X_SendIRCC></s:Body></s:Envelope>`;

  // Precisa do modo 'cors' porque o cabeçalho X-Auth-PSK exige preflight;
  // se a TV não responder ao preflight, o navegador bloqueia a chamada.
  return fetch(`http://${STATE.ip}/sony/IRCC`, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
      'X-Auth-PSK': STATE.psk || '',
    },
    body,
  });
}

/* ---------------- Android TV com pareamento (via ponte local) ---------------- */
/* A ponte (pasta bridge/) fala o protocolo oficial Android TV Remote v2 por nós,
   porque isso exige um socket TCP+TLS que o navegador não consegue abrir. */

async function bridgeCall(path, body) {
  const res = await fetch(`${STATE.bridgeAddr.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `erro ${res.status}`);
  return data;
}

function bridgeConnect() {
  return bridgeCall('/connect', { ip: STATE.ip });
}

function bridgePairCode(code) {
  return bridgeCall('/pair', { ip: STATE.ip, code });
}

function bridgeSendKey(key) {
  return bridgeCall('/key', { ip: STATE.ip, key });
}

function bridgeLaunchApp(appName) {
  return bridgeCall('/app', { ip: STATE.ip, app: appName });
}

async function bridgeStatus() {
  const res = await fetch(`${STATE.bridgeAddr.replace(/\/$/, '')}/status?ip=${encodeURIComponent(STATE.ip)}`);
  return res.json();
}

function startBridgePolling() {
  stopBridgePolling();
  STATE.pollTimer = setInterval(async () => {
    try {
      const { state } = await bridgeStatus();
      if (state === 'waiting_code') {
        pairGroup.classList.remove('hidden');
      } else if (state === 'ready') {
        pairGroup.classList.add('hidden');
        connDot.classList.add('on');
        showToast('Parceado e conectado!');
        stopBridgePolling();
      } else if (state === 'error') {
        showToast('Erro na ponte: verifique se ela está rodando', 3000);
        stopBridgePolling();
      }
    } catch (e) {
      showToast('Não consegui falar com a ponte local — ela está rodando?', 3000);
      stopBridgePolling();
    }
  }, 1500);
}

function stopBridgePolling() {
  if (STATE.pollTimer) clearInterval(STATE.pollTimer);
  STATE.pollTimer = null;
}

/* ---------------- Samsung (Tizen, best-effort) ---------------- */

function samsungConnect() {
  return new Promise((resolve, reject) => {
    try {
      const name = btoa('RemoteWeb');
      const ws = new WebSocket(
        `wss://${STATE.ip}:8002/api/v2/channels/samsung.remote.control?name=${name}`
      );
      ws.onopen = () => { STATE.socket = ws; resolve(ws); };
      ws.onerror = (e) => reject(e);
      ws.onclose = () => { STATE.socket = null; };
      setTimeout(() => reject(new Error('timeout')), 4000);
    } catch (e) { reject(e); }
  });
}

function samsungSend(rokuStyleKey) {
  const map = {
    Power: 'KEY_POWER', VolumeUp: 'KEY_VOLUP', VolumeDown: 'KEY_VOLDOWN',
    VolumeMute: 'KEY_MUTE', Home: 'KEY_HOME', Back: 'KEY_RETURN',
    Up: 'KEY_UP', Down: 'KEY_DOWN', Left: 'KEY_LEFT', Right: 'KEY_RIGHT',
    Select: 'KEY_ENTER', ChannelUp: 'KEY_CHUP', ChannelDown: 'KEY_CHDOWN',
    Play: 'KEY_PLAY', Rev: 'KEY_REWIND', Fwd: 'KEY_FF', Info: 'KEY_INFO',
    InstantReplay: 'KEY_REWIND', InputHDMI1: 'KEY_HDMI',
    Lit_0: 'KEY_0', Lit_1: 'KEY_1', Lit_2: 'KEY_2', Lit_3: 'KEY_3', Lit_4: 'KEY_4',
    Lit_5: 'KEY_5', Lit_6: 'KEY_6', Lit_7: 'KEY_7', Lit_8: 'KEY_8', Lit_9: 'KEY_9',
    Backspace: 'KEY_RETURN',
  };
  const key = map[rokuStyleKey];
  if (!STATE.socket || STATE.socket.readyState !== 1) {
    return Promise.reject(new Error('sem conexão'));
  }
  const payload = {
    method: 'ms.remote.control',
    params: { Cmd: 'Click', DataOfCmd: key || 'KEY_HOME', Option: 'false', TypeOfRemote: 'SendRemoteKey' },
  };
  STATE.socket.send(JSON.stringify(payload));
  return Promise.resolve();
}

/* ---------------- Roteador de comandos ---------------- */

async function sendKey(key) {
  if (!STATE.ip) { showToast('Configure o IP da TV primeiro'); return; }

  if (STATE.brand === 'androidtv') {
    showToast('No modo Android TV genérico só é possível abrir apps (DIAL) — sem protocolo aberto para setas/volume', 3000);
    return;
  }
  if (STATE.brand === 'lg') {
    showToast('LG não é suportado neste app', 2000);
    return;
  }

  vibrate();
  try {
    if (STATE.brand === 'philco') {
      await bridgeSendKey(key);
    } else if (STATE.brand === 'roku') {
      await rokuKeypress(key);
    } else if (STATE.brand === 'sony') {
      await sonySend(key);
    } else if (STATE.brand === 'samsung') {
      if (!STATE.socket) await samsungConnect();
      await samsungSend(key);
    }
  } catch (err) {
    showToast('Não foi possível enviar o comando: ' + err.message, 2800);
  }
}

async function launchApp(btn) {
  vibrate();
  if (!STATE.ip) { showToast('Configure o IP da TV primeiro'); return; }

  try {
    if (STATE.brand === 'philco') {
      const name = btn.dataset.launchDial;
      if (!name) { showToast('App sem nome cadastrado'); return; }
      await bridgeLaunchApp(name);
    } else if (STATE.brand === 'roku') {
      const id = btn.dataset.launchRoku;
      if (!id) { showToast('App sem ID Roku cadastrado'); return; }
      await rokuLaunch(id);
    } else if (STATE.brand === 'androidtv') {
      const name = btn.dataset.launchDial;
      if (!name) { showToast('App sem nome DIAL cadastrado'); return; }
      await dialLaunch(name);
    } else if (STATE.brand === 'sony') {
      const key = btn.dataset.launchSony;
      if (!key || !SONY_IRCC[key]) { showToast('Este app não tem tecla dedicada na Sony'); return; }
      await sonySend(key);
    } else {
      showToast('Abrir apps não está disponível para esta marca ainda', 2400);
      return;
    }
    showToast('Abrindo app...');
  } catch (err) {
    showToast('Falha ao abrir o app');
  }
}

/* ---------------- Conexão / setup ---------------- */

async function attemptConnect() {
  const ip = ipInput.value.trim();
  const brand = brandSelect.value;
  const psk = pskInput.value.trim();
  const bridgeAddr = bridgeInput.value.trim();
  if (!ip) { showToast('Digite o IP da TV'); return; }
  if (brand === 'sony' && !psk) { showToast('Digite a chave PSK configurada na TV'); return; }
  if (brand === 'philco' && !bridgeAddr) { showToast('Digite o endereço da ponte local'); return; }

  STATE.ip = ip;
  STATE.brand = brand;
  STATE.psk = psk;
  STATE.bridgeAddr = bridgeAddr || STATE.bridgeAddr;
  saveConfig();

  deviceNameEl.textContent = `${brandLabel(brand)} · ${ip}`;
  setupScreen.classList.add('hidden');
  remoteScreen.classList.remove('hidden');
  applyCapabilityUI(brand);
  pairGroup.classList.add('hidden');

  connDot.classList.remove('on');
  showToast('Conectando...', 1200);

  if (brand === 'philco') {
    try {
      const { state, error } = await bridgeConnect();
      if (state === 'ready') {
        connDot.classList.add('on');
        showToast('Já pareado — conectado!');
      } else if (state === 'waiting_code') {
        pairGroup.classList.remove('hidden');
        showToast('Digite na tela o código mostrado na TV', 3200);
        startBridgePolling();
      } else if (state === 'error') {
        showToast('Erro da ponte: ' + (error || 'desconhecido'), 3200);
      } else {
        startBridgePolling();
      }
    } catch (e) {
      showToast('Não consegui falar com a ponte local. Ela está rodando? (npm start na pasta bridge/)', 3600);
    }
  } else if (brand === 'roku') {
    try {
      await rokuPing();
      connDot.classList.add('on');
      showToast('TV encontrada na rede');
    } catch (e) {
      showToast('Não encontrei a TV nesse IP. Verifique a rede.', 3000);
    }
  } else if (brand === 'sony') {
    try {
      await sonySend('Power'); // fecha o preflight cedo e valida PSK/rede
      connDot.classList.add('on');
      showToast('TV respondeu — conexão OK');
    } catch (e) {
      showToast('Não confirmei a conexão (PSK, rede ou CORS). Pode tentar mesmo assim.', 3200);
    }
  } else if (brand === 'androidtv') {
    connDot.classList.add('on');
    showToast('Pronto para abrir apps (DIAL)', 2000);
  } else if (brand === 'samsung') {
    try {
      await samsungConnect();
      connDot.classList.add('on');
      showToast('Conectado — aceite o pareamento na TV, se pedido', 3000);
    } catch (e) {
      showToast('Não foi possível abrir conexão com a TV', 2600);
    }
  } else if (brand === 'lg') {
    showToast('LG não é suportado — veja o aviso de compatibilidade', 3400);
  }
}

function brandLabel(brand) {
  return { roku: 'Roku', samsung: 'Samsung', lg: 'LG', androidtv: 'Android TV', sony: 'Sony Bravia', philco: 'Android TV (pareado)' }[brand] || brand;
}

/* Esmaece grupos de botões que não funcionam de verdade na marca escolhida */
function applyCapabilityUI(brand) {
  const noKeyLevel = brand === 'androidtv' || brand === 'lg';
  document.querySelectorAll('.ctrl-full').forEach(el => {
    el.classList.toggle('is-limited', noKeyLevel);
  });
  footnoteEl.textContent = CAPS[brand] ? CAPS[brand].label : '';
}

function updateCapBadge(brand) {
  const info = CAPS[brand];
  if (!info) { capBadge.classList.remove('show'); return; }
  capBadge.className = 'cap-badge show ' +
    (info.level === 'full' ? 'cap-full' : info.level === 'partial' ? 'cap-partial' : 'cap-none');
  capBadge.textContent = info.label;
}

function updateFieldVisibility(brand) {
  pskGroup.classList.toggle('hidden', brand !== 'sony');
  bridgeGroup.classList.toggle('hidden', brand !== 'philco');
  pairGroup.classList.add('hidden'); // só reaparece se a ponte pedir o código
}

/* ---------------- Eventos de UI ---------------- */

document.querySelectorAll('[data-key]').forEach(btn => {
  btn.addEventListener('click', () => sendKey(btn.dataset.key));
});

document.querySelectorAll('.app-btn').forEach(btn => {
  btn.addEventListener('click', () => launchApp(btn));
});

connectBtn.addEventListener('click', attemptConnect);

helpBtn.addEventListener('click', () => helpBox.classList.toggle('hidden'));

document.getElementById('btn-info').addEventListener('click', () => sendKey('Info'));

brandSelect.addEventListener('change', () => {
  updateCapBadge(brandSelect.value);
  updateFieldVisibility(brandSelect.value);
});

btnPair.addEventListener('click', async () => {
  const code = pairCodeInput.value.trim();
  if (!code) { showToast('Digite o código mostrado na TV'); return; }
  try {
    await bridgePairCode(code);
    showToast('Código enviado, aguardando confirmação...');
    startBridgePolling();
  } catch (e) {
    showToast('Falha ao enviar código: ' + e.message, 3000);
  }
});

backSetupBtn.addEventListener('click', () => {
  if (STATE.socket) { try { STATE.socket.close(); } catch (e) {} }
  remoteScreen.classList.add('hidden');
  setupScreen.classList.remove('hidden');
});

keypadToggle.addEventListener('click', () => {
  const isHidden = keypad.classList.toggle('hidden');
  keypadToggle.textContent = isHidden
    ? 'Mostrar teclado numérico ▾'
    : 'Ocultar teclado numérico ▴';
});

/* Repetição ao segurar volume/canal */
document.querySelectorAll('.rocker-btn').forEach(btn => {
  let interval = null;
  const start = () => {
    sendKey(btn.dataset.key);
    interval = setInterval(() => sendKey(btn.dataset.key), 350);
  };
  const stop = () => clearInterval(interval);
  btn.addEventListener('mousedown', start);
  btn.addEventListener('touchstart', (e) => { e.preventDefault(); start(); }, { passive: false });
  ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => btn.addEventListener(ev, stop));
});

/* ---------------- Inicialização ---------------- */

loadConfig();
if (STATE.ip) {
  ipInput.value = STATE.ip;
  brandSelect.value = STATE.brand;
  pskInput.value = STATE.psk || '';
}
bridgeInput.value = STATE.bridgeAddr || 'http://localhost:4000';
updateCapBadge(brandSelect.value);
updateFieldVisibility(brandSelect.value);
