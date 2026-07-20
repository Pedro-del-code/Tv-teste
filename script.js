/* ===================================================================
   Controle Remoto Web
   - Roku: usa o protocolo oficial ECP (External Control Protocol),
     enviado via fetch() diretamente do navegador para a TV, na rede local.
   - Samsung: tentativa via WebSocket local (API de controle remoto Tizen).
   - LG / Android TV: exigem pareamento com certificado/token próprio do
     fabricante, que não é viável a partir de uma página genérica. O app
     avisa o usuário em vez de fingir que funciona.
=================================================================== */

const setupScreen  = document.getElementById('setup-screen');
const remoteScreen = document.getElementById('remote-screen');
const ipInput      = document.getElementById('tv-ip');
const brandSelect  = document.getElementById('tv-brand');
const connectBtn   = document.getElementById('btn-connect');
const helpBtn      = document.getElementById('btn-help');
const helpBox      = document.getElementById('help-box');
const backSetupBtn = document.getElementById('btn-back-setup');
const deviceNameEl = document.getElementById('device-name');
const connDot      = document.getElementById('conn-dot');
const toastEl      = document.getElementById('toast');
const keypadToggle  = document.getElementById('toggle-keypad');
const keypad        = document.getElementById('keypad');

let STATE = {
  brand: 'roku',
  ip: '',
  socket: null,   // websocket ativo (Samsung)
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
      STATE.brand = parsed.brand || 'roku';
      STATE.ip = parsed.ip || '';
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
  };
  const key = map[rokuStyleKey] || map[rokuStyleKey.replace('Lit_', '')];
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
  vibrate();
  if (!STATE.ip) { showToast('Configure o IP da TV primeiro'); return; }

  try {
    if (STATE.brand === 'roku') {
      await rokuKeypress(key);
    } else if (STATE.brand === 'samsung') {
      if (!STATE.socket) await samsungConnect();
      await samsungSend(key);
    } else {
      showToast('Marca ainda não suportada por protocolo aberto — veja o aviso de compatibilidade', 2600);
      return;
    }
  } catch (err) {
    showToast('Não foi possível enviar o comando (rede ou HTTPS bloqueando)', 2600);
  }
}

async function launchApp(appId) {
  vibrate();
  if (!STATE.ip) { showToast('Configure o IP da TV primeiro'); return; }
  if (STATE.brand !== 'roku') {
    showToast('Abrir apps direto só está disponível para Roku por enquanto', 2400);
    return;
  }
  try {
    await rokuLaunch(appId);
    showToast('Abrindo app...');
  } catch (err) {
    showToast('Falha ao abrir o app');
  }
}

/* ---------------- Conexão / setup ---------------- */

async function attemptConnect() {
  const ip = ipInput.value.trim();
  const brand = brandSelect.value;
  if (!ip) { showToast('Digite o IP da TV'); return; }

  STATE.ip = ip;
  STATE.brand = brand;
  saveConfig();

  deviceNameEl.textContent = `${brandLabel(brand)} · ${ip}`;
  setupScreen.classList.add('hidden');
  remoteScreen.classList.remove('hidden');

  connDot.classList.remove('on');
  showToast('Conectando...', 1200);

  if (brand === 'roku') {
    try {
      await rokuPing();
      connDot.classList.add('on');
      showToast('TV encontrada na rede');
    } catch (e) {
      showToast('Não encontrei a TV nesse IP. Verifique a rede.', 3000);
    }
  } else if (brand === 'samsung') {
    try {
      await samsungConnect();
      connDot.classList.add('on');
      showToast('Conectado — aceite o pareamento na TV, se pedido', 3000);
    } catch (e) {
      showToast('Não foi possível abrir conexão com a TV', 2600);
    }
  } else {
    showToast('Suporte limitado para esta marca — veja o aviso abaixo', 3000);
  }
}

function brandLabel(brand) {
  return { roku: 'Roku', samsung: 'Samsung', lg: 'LG', androidtv: 'Android TV' }[brand] || brand;
}

/* ---------------- Eventos de UI ---------------- */

document.querySelectorAll('[data-key]').forEach(btn => {
  btn.addEventListener('click', () => sendKey(btn.dataset.key));
});

document.querySelectorAll('[data-launch]').forEach(btn => {
  btn.addEventListener('click', () => launchApp(btn.dataset.launch));
});

connectBtn.addEventListener('click', attemptConnect);

helpBtn.addEventListener('click', () => helpBox.classList.toggle('hidden'));

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
}
