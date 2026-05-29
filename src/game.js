const $ = (id) => document.getElementById(id);
const views = { menu: $('menu'), room: $('room'), game: $('game') };
const canvas = $('arena');
const ctx = canvas.getContext('2d');

const COLORS = [
  { name: 'berry', hex: '#ff5f7e' },
  { name: 'lemon', hex: '#ffd54f' },
  { name: 'mint', hex: '#50d890' },
  { name: 'sky', hex: '#53c7f5' },
  { name: 'plum', hex: '#9c7cff' },
  { name: 'mango', hex: '#ff9f43' }
];
const W = 420, H = 820, ROUND_MS = 60000;
let mode = 'bot';
let last = 0;
let raf = 0;
let peer = null;
let channel = null;
let isHost = true;
let connected = false;
let localInput = { x: W * .3, y: H * .74, pulse: false, seq: 0 };
let remoteInput = { x: W * .7, y: H * .74, pulse: false, seq: 0 };
let roomSeed = Math.floor(Math.random() * 1e9);
let rng = mulberry32(roomSeed);

const state = {
  running: false,
  over: false,
  startedAt: 0,
  timeLeft: 60,
  shake: 0,
  recipe: [],
  items: [],
  splashes: [],
  players: []
};

const ui = {
  p1Score: $('p1Score'), p2Score: $('p2Score'), timer: $('timer'), rivalLabel: $('rivalLabel'),
  recipe: $('recipe'), toast: $('toast'), signalBox: $('signalBox'), netStatus: $('netStatus')
};

$('howBtn').onclick = () => $('how').classList.toggle('hidden');
$('botBtn').onclick = () => startGame('bot');
$('leaveBtn').onclick = endToMenu;
$('pulseBtn').onclick = () => triggerPulse(0);
$('hostBtn').onclick = hostRoom;
$('joinBtn').onclick = joinRoom;
$('backMenu').onclick = () => show('menu');
$('copySignal').onclick = async () => navigator.clipboard?.writeText(ui.signalBox.value);
$('pasteSignal').onclick = () => handleSignal(ui.signalBox.value.trim());
$('startNet').onclick = () => startGame('friend');

function show(name) {
  Object.values(views).forEach(v => v.classList.add('hidden'));
  views[name].classList.remove('hidden');
}

function mulberry32(seed) {
  return function rand() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function pickColor() { return Math.floor(rng() * COLORS.length); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function initRound(kind) {
  mode = kind;
  rng = mulberry32(roomSeed);
  state.running = true;
  state.over = false;
  state.startedAt = performance.now();
  state.timeLeft = 60;
  state.shake = 0;
  state.recipe = [pickColor(), pickColor(), pickColor()];
  state.items = [];
  state.splashes = [];
  state.players = [
    makePlayer(0, W * .28, H * .72, '#ff5f7e', 'YOU'),
    makePlayer(1, W * .72, H * .72, '#53c7f5', kind === 'bot' ? 'BOT' : 'PAL')
  ];
  localInput = { x: W * .3, y: H * .74, pulse: false, seq: 0 };
  remoteInput = { x: W * .7, y: H * .74, pulse: false, seq: 0 };
  for (let i = 0; i < 22; i++) spawnItem(true);
  updateRecipeUI();
}

function makePlayer(id, x, y, color, label) {
  return { id, x, y, vx: 0, vy: 0, r: 20, color, label, score: 0, cargo: [], stun: 0, pulse: 0, trail: [] };
}

function spawnItem(initial = false) {
  state.items.push({
    x: 42 + rng() * (W - 84),
    y: 125 + rng() * (H - 260),
    r: 12 + rng() * 5,
    c: pickColor(),
    wobble: rng() * Math.PI * 2,
    born: initial ? -rng() * 10 : performance.now() / 1000
  });
}

function updateRecipeUI() {
  ui.recipe.innerHTML = state.recipe.map(c => `<span class="dot" style="background:${COLORS[c].hex}"></span>`).join('');
}

function startGame(kind) {
  if (kind === 'friend' && !connected) {
    toast('まだ接続していないのでボット戦を開始します');
    kind = 'bot';
  }
  ui.rivalLabel.textContent = kind === 'bot' ? 'BOT' : 'PAL';
  show('game');
  resizeCanvas();
  initRound(kind);
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(loop);
}

function endToMenu() {
  state.running = false;
  cancelAnimationFrame(raf);
  show('menu');
}

function loop(now) {
  const dt = Math.min(.033, (now - last) / 1000);
  last = now;
  update(dt, now);
  draw(now);
  if (state.running) raf = requestAnimationFrame(loop);
}

function update(dt, now) {
  state.timeLeft = Math.max(0, Math.ceil((ROUND_MS - (now - state.startedAt)) / 1000));
  ui.timer.textContent = state.timeLeft;
  if (state.timeLeft <= 0 && !state.over) finishRound();

  const p0 = state.players[0], p1 = state.players[1];
  updateBotInput(dt, p1);
  if (mode === 'friend') syncNetwork();
  movePlayer(p0, localInput, dt);
  movePlayer(p1, mode === 'bot' ? remoteInput : remoteInput, dt);
  handleItems(p0); handleItems(p1);
  handleBump(p0, p1);
  updateSplashes(dt);
  while (state.items.length < 24) spawnItem();
  ui.p1Score.textContent = p0.score;
  ui.p2Score.textContent = p1.score;
  state.shake = Math.max(0, state.shake - dt * 18);
}

function movePlayer(p, input, dt) {
  const speed = p.stun > 0 ? 410 : 760;
  const dx = input.x - p.x, dy = input.y - p.y;
  p.vx += clamp(dx * 6, -speed, speed) * dt;
  p.vy += clamp(dy * 6, -speed, speed) * dt;
  p.vx *= .90; p.vy *= .90;
  p.x = clamp(p.x + p.vx * dt, 25, W - 25);
  p.y = clamp(p.y + p.vy * dt, 110, H - 95);
  p.stun = Math.max(0, p.stun - dt);
  p.pulse = Math.max(0, p.pulse - dt * 2.8);
  p.trail.unshift({ x: p.x, y: p.y, t: 1 });
  p.trail = p.trail.slice(0, 16).map(t => ({ ...t, t: t.t - dt * 2.2 })).filter(t => t.t > 0);
}

function updateBotInput(dt, bot) {
  if (mode !== 'bot') return;
  const plate = { x: W / 2, y: 118 };
  const needed = state.recipe[bot.cargo.length];
  let target = null;
  if (bot.cargo.length === state.recipe.length) target = plate;
  else {
    const candidates = state.items.filter(i => i.c === needed).sort((a, b) => dist(bot, a) - dist(bot, b));
    target = candidates[0] || state.items.sort((a, b) => dist(bot, a) - dist(bot, b))[0] || plate;
  }
  remoteInput.x += ((target?.x ?? plate.x) - remoteInput.x) * dt * 4.2;
  remoteInput.y += ((target?.y ?? plate.y) - remoteInput.y) * dt * 4.2;
  if (dist(bot, state.players[0]) < 58 && bot.pulse <= 0 && rng() < .035) triggerPulse(1);
}

function handleItems(p) {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (Math.hypot(p.x - item.x, p.y - item.y) < p.r + item.r) {
      if (p.cargo.length < 3) {
        p.cargo.push(item.c);
        burst(item.x, item.y, COLORS[item.c].hex, 6);
        state.items.splice(i, 1);
      }
    }
  }
  const plate = { x: W / 2, y: 118, r: 44 };
  if (p.cargo.length && Math.hypot(p.x - plate.x, p.y - plate.y) < p.r + plate.r) deliver(p);
}

function deliver(p) {
  const exact = p.cargo.length === state.recipe.length && p.cargo.every((c, i) => c === state.recipe[i]);
  const prefix = p.cargo.every((c, i) => c === state.recipe[i]);
  if (exact) {
    p.score += 100 + Math.round(state.timeLeft / 3);
    burst(W / 2, 118, '#ffd54f', 22);
    state.recipe = [pickColor(), pickColor(), pickColor()];
    updateRecipeUI();
    toast(p.id === 0 ? 'ごちそう配達！' : 'ライバル配達！');
  } else if (!prefix || p.cargo.length >= 3) {
    p.score = Math.max(0, p.score - 15);
    p.stun = .75;
    burst(p.x, p.y, '#7bd88f', 18);
    state.shake = 8;
  }
  p.cargo = [];
}

function handleBump(a, b) {
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  if (d > 0 && d < a.r + b.r) {
    const nx = (a.x - b.x) / d, ny = (a.y - b.y) / d;
    a.vx += nx * 125; a.vy += ny * 125; b.vx -= nx * 125; b.vy -= ny * 125;
  }
  [a, b].forEach(p => {
    if (p.pulse > .62) {
      const other = p === a ? b : a;
      const pd = Math.hypot(p.x - other.x, p.y - other.y);
      if (pd < 118) {
        other.vx += (other.x - p.x) / Math.max(1, pd) * 540;
        other.vy += (other.y - p.y) / Math.max(1, pd) * 540;
        other.stun = .35;
        if (other.cargo.length && rng() < .15) other.cargo.pop();
      }
    }
  });
}

function triggerPulse(id) {
  const p = state.players[id];
  if (!p || p.pulse > 0) return;
  p.pulse = 1;
  state.shake = 5;
  burst(p.x, p.y, p.color, 14);
  if (id === 0) {
    localInput.pulse = true; localInput.seq++;
    setTimeout(() => localInput.pulse = false, 80);
  }
}

function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) state.splashes.push({ x, y, vx: (rng() - .5) * 220, vy: (rng() - .5) * 220, life: .6 + rng() * .5, color });
}
function updateSplashes(dt) {
  state.splashes.forEach(s => { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 70 * dt; s.life -= dt; });
  state.splashes = state.splashes.filter(s => s.life > 0);
}
function finishRound() {
  state.over = true; state.running = false;
  const [a, b] = state.players;
  const text = a.score === b.score ? '引き分け！もう一回？' : a.score > b.score ? '勝利！ピクニック王！' : '惜敗！次は奪い返そう！';
  toast(`${text} ${a.score}-${b.score}`, 5000);
}

function draw(now) {
  const sx = (Math.random() - .5) * state.shake, sy = (Math.random() - .5) * state.shake;
  ctx.save(); ctx.translate(sx, sy);
  drawBackground(now);
  drawPlate();
  state.items.forEach((item) => drawItem(item, now));
  state.splashes.forEach(drawSplash);
  state.players.forEach(drawPlayer);
  ctx.restore();
}
function drawBackground(now) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#fff0aa'); g.addColorStop(.38, '#ffd5e2'); g.addColorStop(.7, '#c5f0ff'); g.addColorStop(1, '#d7ffc0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = .5;
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = COLORS[i % COLORS.length].hex;
    const x = (i * 83 + now * .012) % (W + 80) - 40;
    const y = 160 + (i * 57) % 560;
    ctx.beginPath(); ctx.ellipse(x, y, 32, 14, Math.sin(now / 900 + i), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function drawPlate() {
  ctx.fillStyle = '#ffffffcc'; ctx.beginPath(); ctx.arc(W / 2, 118, 50, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ff9f43'; ctx.lineWidth = 7; ctx.stroke();
  state.recipe.forEach((c, i) => { ctx.fillStyle = COLORS[c].hex; ctx.beginPath(); ctx.arc(W / 2 - 24 + i * 24, 118, 9, 0, Math.PI * 2); ctx.fill(); });
}
function drawItem(item, now) {
  const bob = Math.sin(now / 300 + item.wobble) * 4;
  ctx.fillStyle = COLORS[item.c].hex; ctx.beginPath(); ctx.arc(item.x, item.y + bob, item.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff88'; ctx.beginPath(); ctx.arc(item.x - 4, item.y + bob - 5, item.r * .32, 0, Math.PI * 2); ctx.fill();
}
function drawSplash(s) { ctx.globalAlpha = Math.max(0, s.life); ctx.fillStyle = s.color; ctx.beginPath(); ctx.arc(s.x, s.y, 4 + s.life * 8, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
function drawPlayer(p) {
  p.trail.forEach((t, i) => { ctx.globalAlpha = t.t * .35; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(t.x, t.y, p.r * (1 - i / 26), 0, Math.PI * 2); ctx.fill(); });
  ctx.globalAlpha = 1;
  if (p.pulse > 0) { ctx.strokeStyle = p.color; ctx.globalAlpha = p.pulse; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(p.x, p.y, 24 + (1 - p.pulse) * 90, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1; }
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#263047'; ctx.font = '900 11px ui-rounded, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(p.label, p.x, p.y + 4);
  p.cargo.forEach((c, i) => { ctx.fillStyle = COLORS[c].hex; ctx.beginPath(); ctx.arc(p.x - 18 + i * 18, p.y - 32, 7, 0, Math.PI * 2); ctx.fill(); });
}

function pointerToArena(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
}
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); Object.assign(localInput, pointerToArena(e)); });
canvas.addEventListener('pointermove', e => { if (e.buttons) Object.assign(localInput, pointerToArena(e)); });
function resizeCanvas() { canvas.width = W * devicePixelRatio; canvas.height = H * devicePixelRatio; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); }
addEventListener('resize', resizeCanvas);

function toast(text, ms = 1400) {
  ui.toast.textContent = text; ui.toast.classList.remove('hidden');
  clearTimeout(toast.t); toast.t = setTimeout(() => ui.toast.classList.add('hidden'), ms);
}

async function hostRoom() {
  isHost = true; connected = false; roomSeed = Math.floor(Math.random() * 1e9);
  show('room'); $('roomTitle').textContent = '友達ルームを作る'; $('roomHelp').textContent = '招待テキストを友達へ送って、返ってきた返事を貼り付けて接続。';
  await createPeer();
  channel = peer.createDataChannel('rally'); wireChannel();
  const offer = await peer.createOffer(); await peer.setLocalDescription(offer); await waitIce(peer);
  ui.signalBox.value = pack({ type: 'offer', seed: roomSeed, sdp: peer.localDescription });
  ui.netStatus.textContent = '招待をコピーして友達に送ってください';
}
async function joinRoom() {
  isHost = false; connected = false; show('room'); $('roomTitle').textContent = '招待で参加'; $('roomHelp').textContent = '友達から届いた招待テキストを貼り付けて「貼り付けて接続」。返事が出たら友達へ送ってね。';
  ui.signalBox.value = ''; ui.netStatus.textContent = '招待待ち';
}
async function createPeer() {
  peer?.close();
  peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peer.ondatachannel = (e) => { channel = e.channel; wireChannel(); };
  peer.onconnectionstatechange = () => { ui.netStatus.textContent = `接続状態: ${peer.connectionState}`; connected = peer.connectionState === 'connected'; };
}
function wireChannel() {
  channel.onopen = () => { connected = true; ui.netStatus.textContent = '接続完了！開始できます'; channel.send(JSON.stringify({ seed: roomSeed })); };
  channel.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.seed) roomSeed = msg.seed;
    if (msg.input) remoteInput = msg.input;
  };
}
async function handleSignal(text) {
  if (!text) return;
  const data = unpack(text);
  if (data.type === 'offer') {
    roomSeed = data.seed; await createPeer(); await peer.setRemoteDescription(data.sdp);
    const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); await waitIce(peer);
    ui.signalBox.value = pack({ type: 'answer', seed: roomSeed, sdp: peer.localDescription });
    ui.netStatus.textContent = '返事をコピーしてホストへ送ってください';
  } else if (data.type === 'answer' && peer) {
    await peer.setRemoteDescription(data.sdp); ui.netStatus.textContent = '接続中...';
  }
}
function pack(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
function unpack(text) { return JSON.parse(decodeURIComponent(escape(atob(text)))); }
function waitIce(pc) { return new Promise(resolve => { if (pc.iceGatheringState === 'complete') resolve(); else pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && resolve(); setTimeout(resolve, 2200); }); }
function syncNetwork() { if (channel?.readyState === 'open') channel.send(JSON.stringify({ input: localInput })); }
