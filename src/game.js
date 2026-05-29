// ===========================================================================
// Picnic Comet Rally ULTRA - 大幅強化版
// 操作性: 仮想ジョイスティック + ダッシュ + ポン
// メカ : コンボ、パワーアップ6種、ゴールド果実、サドンデス、難易度4段
// 演出 : ネオン、パーティクル、画面シェイク、トレイル、サウンド
// ===========================================================================

import { Sound } from './sound.js';

const $ = (id) => document.getElementById(id);

const VIEWS = ['menu', 'room', 'game', 'result'];
const viewEls = Object.fromEntries(VIEWS.map(v => [v, $(v)]));

const canvas = $('arena');
const ctx = canvas.getContext('2d');

// --- World constants ---
const W = 420, H = 820;
const ROUND_MS = 60000;
const SUDDEN_DEATH_AT = 10; // seconds left when sudden death starts

// --- Colors / fruits ---
const COLORS = [
  { name: 'berry', hex: '#ff5f7e', glow: '#ff86a3' },
  { name: 'lemon', hex: '#ffd54f', glow: '#fff09a' },
  { name: 'mint',  hex: '#50d890', glow: '#9af5c0' },
  { name: 'sky',   hex: '#53c7f5', glow: '#a8e6ff' },
  { name: 'plum',  hex: '#b497ff', glow: '#d9c8ff' },
  { name: 'mango', hex: '#ff9f43', glow: '#ffc785' },
];
const GOLD = { hex: '#ffd44a', glow: '#fff39a' };

// --- Difficulty presets ---
const DIFFICULTY = {
  easy:   { botReact: 3.2, botPulseChance: .015, botDashChance: .010, botSpeed: .85, botAim: .80 },
  normal: { botReact: 4.6, botPulseChance: .035, botDashChance: .025, botSpeed: 1.00, botAim: .92 },
  hard:   { botReact: 6.0, botPulseChance: .060, botDashChance: .045, botSpeed: 1.10, botAim: .97 },
  insane: { botReact: 7.6, botPulseChance: .090, botDashChance: .075, botSpeed: 1.22, botAim: 1.00 },
};

// --- Power-up types ---
const POWERUPS = [
  { key: 'speed',  emoji: '⚡', color: '#5ee0ff', dur: 6.0, label: 'SPEED' },
  { key: 'shield', emoji: '🛡', color: '#9af5c0', dur: 8.0, label: 'SHIELD' },
  { key: 'magnet', emoji: '🧲', color: '#ff86a3', dur: 7.0, label: 'MAGNET' },
  { key: 'bomb',   emoji: '💣', color: '#ff7a30', dur: 0,   label: 'BOMB' }, // instant
  { key: 'freeze', emoji: '❄️', color: '#a8e6ff', dur: 2.2, label: 'FREEZE' }, // applied to opponent
  { key: 'double', emoji: '×2', color: '#ffd166', dur: 0,   label: 'DOUBLE' }, // next delivery doubled
];
const POWERUP_BY_KEY = Object.fromEntries(POWERUPS.map(p => [p.key, p]));

// --- Game state ---
const state = {
  running: false,
  over: false,
  paused: false,
  startedAt: 0,
  timeLeft: 60,
  sudden: false,
  shake: 0,
  recipe: [],
  items: [],          // fruits
  powerups: [],       // floating power-up boxes
  splashes: [],       // particles
  rings: [],          // expanding shock rings
  floatTexts: [],     // floating "+100", "MISS!" etc
  players: [],
  stars: [],          // background stars
  difficulty: 'normal',
  mode: 'bot',
  comboTimer: 0,      // for global combo decay UI
};

let mode = 'bot';
let last = 0;
let raf = 0;

// --- Network ---
let peer = null, channel = null, isHost = true, connected = false;
let roomSeed = Math.floor(Math.random() * 1e9);
let rng = mulberry32(roomSeed);

// --- Input ---
let localInput  = { x: W * .3, y: H * .74, dash: false, pulse: false, seq: 0 };
let remoteInput = { x: W * .7, y: H * .74, dash: false, pulse: false, seq: 0 };
const keys = new Set();

// Virtual stick
const stick = { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0, dx: 0, dy: 0, pointerId: -1 };
const STICK_R = 60;

// ---------------------------------------------------------------------------
// UI handles
// ---------------------------------------------------------------------------
const ui = {
  p1Score: $('p1Score'), p2Score: $('p2Score'),
  p1Combo: $('p1Combo'), p2Combo: $('p2Combo'),
  timer: $('timer'), timerBar: $('timerBar'),
  rivalLabel: $('rivalLabel'),
  recipeDots: $('recipeDots'),
  toast: $('toast'), bigToast: $('bigToast'),
  signalBox: $('signalBox'), netStatus: $('netStatus'),
  buffBar: $('buffBar'), leadFlag: $('leadFlag'),
  stickBase: $('stickBase'), stickKnob: $('stickKnob'), stickZone: $('stickZone'),
  dashCool: $('dashCool'), pulseCool: $('pulseCool'),
  dashBtn: $('dashBtn'), pulseBtn: $('pulseBtn'),
  countdown: $('countdown'), countNum: $('countNum'),
  resultBadge: $('resultBadge'), resultTitle: $('resultTitle'),
  rYou: $('rYou'), rRival: $('rRival'), rRivalLab: $('rRivalLab'),
  rMaxCombo: $('rMaxCombo'), rDeliveries: $('rDeliveries'), rPulses: $('rPulses'),
};

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------
function show(name) {
  VIEWS.forEach(v => viewEls[v].classList.add('hidden'));
  viewEls[name].classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
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
function lerp(a, b, t) { return a + (b - a) * t; }

// ---------------------------------------------------------------------------
// Player factory
// ---------------------------------------------------------------------------
function makePlayer(id, x, y, color, label, isYou) {
  return {
    id, x, y, vx: 0, vy: 0, r: 22,
    color, label, isYou,
    score: 0, cargo: [], stun: 0,
    pulse: 0, pulseCool: 0, dashCool: 0, dashTime: 0,
    trail: [],
    combo: 1, comboCount: 0, comboTime: 0,
    buffs: {}, // key -> seconds remaining
    nextDouble: false,
    hasShield: false,
    flashHit: 0,
    // stats
    maxCombo: 1, deliveries: 0, pulseHits: 0,
  };
}

// ---------------------------------------------------------------------------
// Init / spawn
// ---------------------------------------------------------------------------
function initRound(kind) {
  mode = kind;
  state.mode = kind;
  rng = mulberry32(roomSeed);
  state.running = false; // start after countdown
  state.over = false;
  state.startedAt = performance.now();
  state.timeLeft = 60;
  state.sudden = false;
  state.shake = 0;
  state.recipe = [pickColor(), pickColor(), pickColor()];
  state.items = [];
  state.powerups = [];
  state.splashes = [];
  state.rings = [];
  state.floatTexts = [];
  state.players = [
    makePlayer(0, W * .28, H * .72, '#ff5f8d', 'YOU', true),
    makePlayer(1, W * .72, H * .72, '#4cc9ff', kind === 'bot' ? 'BOT' : 'PAL', false),
  ];
  localInput  = { x: W * .3, y: H * .74, dash: false, pulse: false, seq: 0 };
  remoteInput = { x: W * .7, y: H * .74, dash: false, pulse: false, seq: 0 };
  for (let i = 0; i < 26; i++) spawnItem(true);
  for (let i = 0; i < 60; i++) state.stars.push({
    x: rng() * W, y: rng() * H, r: rng() * 1.4 + .3, tw: rng() * Math.PI * 2,
  });
  updateRecipeUI();
  updateBuffBarUI();
}

function spawnItem(initial = false) {
  const isGold = !initial && rng() < .06;
  state.items.push({
    x: 36 + rng() * (W - 72),
    y: 150 + rng() * (H - 290),
    r: isGold ? 16 : 12 + rng() * 4,
    c: pickColor(),
    gold: isGold,
    wobble: rng() * Math.PI * 2,
    born: initial ? -rng() * 10 : performance.now() / 1000,
  });
}

function spawnPowerup() {
  const def = POWERUPS[Math.floor(rng() * POWERUPS.length)];
  state.powerups.push({
    key: def.key, x: 48 + rng() * (W - 96), y: 170 + rng() * (H - 330),
    vy: 10 + rng() * 14, born: performance.now() / 1000, life: 14, def,
    wobble: rng() * Math.PI * 2,
  });
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------
function updateRecipeUI() {
  const cargoYou = state.players[0]?.cargo ?? [];
  ui.recipeDots.innerHTML = state.recipe.map((c, i) => {
    const done = cargoYou[i] === c;
    const nxt  = !done && i === cargoYou.length;
    const cls = ['dot', done ? 'done' : '', nxt ? 'next' : ''].filter(Boolean).join(' ');
    return `<span class="${cls}" style="background:${COLORS[c].hex};color:${COLORS[c].hex}"></span>`;
  }).join('');
}

function updateBuffBarUI() {
  const me = state.players[0];
  if (!me) { ui.buffBar.innerHTML = ''; return; }
  const items = Object.entries(me.buffs).filter(([_, t]) => t > 0);
  if (me.nextDouble) items.push(['double', 1]);
  if (me.hasShield)  items.push(['shield', 1]);
  ui.buffBar.innerHTML = items.map(([k]) => {
    const d = POWERUP_BY_KEY[k]; if (!d) return '';
    return `<div class="buff" style="border-color:${d.color}66"><span>${d.emoji}</span><b>${d.label}</b></div>`;
  }).join('');
}

function updateLeadFlag() {
  const [a, b] = state.players;
  if (!a || !b) return;
  const diff = a.score - b.score;
  ui.leadFlag.classList.remove('hidden');
  if (diff > 0)  { ui.leadFlag.className = 'lead-flag you';   ui.leadFlag.textContent = `+${diff} LEAD`; }
  else if (diff < 0) { ui.leadFlag.className = 'lead-flag rival'; ui.leadFlag.textContent = `${diff} DOWN`; }
  else { ui.leadFlag.className = 'lead-flag tie'; ui.leadFlag.textContent = `TIE`; }
}

function updateComboUI(player, el) {
  if (!player) return;
  el.textContent = `×${player.combo}`;
  el.classList.toggle('hot', player.combo > 1);
}

// ---------------------------------------------------------------------------
// Start / End
// ---------------------------------------------------------------------------
function startGame(kind) {
  if (kind === 'friend' && !connected) {
    toast('まだ接続していないのでボット戦を開始します');
    kind = 'bot';
  }
  ui.rivalLabel.textContent = kind === 'bot' ? 'BOT' : 'PAL';
  ui.leadFlag.classList.add('hidden');
  show('game');
  resizeCanvas();
  initRound(kind);
  cancelAnimationFrame(raf);
  last = performance.now();
  raf = requestAnimationFrame(loop);
  Sound.init();
  runCountdown();
}

function runCountdown() {
  state.running = false;
  let n = 3;
  ui.countdown.classList.remove('hidden');
  ui.countNum.textContent = n;
  Sound.beep(800, .15);
  const tick = () => {
    n--;
    if (n > 0) {
      ui.countNum.textContent = n;
      ui.countdown.classList.remove('hidden');
      // restart animation
      ui.countNum.style.animation = 'none';
      void ui.countNum.offsetWidth;
      ui.countNum.style.animation = '';
      Sound.beep(800 + (3-n)*120, .15);
      setTimeout(tick, 800);
    } else {
      ui.countNum.textContent = 'GO!';
      Sound.beep(1400, .3);
      setTimeout(() => {
        ui.countdown.classList.add('hidden');
        state.running = true;
        state.startedAt = performance.now();
      }, 500);
    }
  };
  setTimeout(tick, 800);
}

function endToMenu() {
  state.running = false;
  cancelAnimationFrame(raf);
  show('menu');
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
function loop(now) {
  const dt = Math.min(.033, (now - last) / 1000);
  last = now;
  update(dt, now);
  draw(now);
  raf = requestAnimationFrame(loop);
}

function update(dt, now) {
  if (!state.running) return;

  applyKeyboard(dt);

  // Time / sudden death
  state.timeLeft = Math.max(0, Math.ceil((ROUND_MS - (now - state.startedAt)) / 1000));
  ui.timer.textContent = state.timeLeft;
  ui.timerBar.style.width = `${100 * state.timeLeft / 60}%`;
  if (state.timeLeft <= SUDDEN_DEATH_AT && !state.sudden) {
    state.sudden = true;
    $('timer').parentElement.classList.add('sudden');
    bigToast('SUDDEN DEATH!', '#ffd166');
    Sound.beep(500, .25, 'sawtooth');
  }
  if (state.timeLeft <= 0 && !state.over) finishRound();

  const [p0, p1] = state.players;

  // Drive bot / remote
  updateBotInput(dt, p1);
  if (mode === 'friend') syncNetwork();

  movePlayer(p0, localInput, dt);
  movePlayer(p1, remoteInput, dt);

  handleItems(p0); handleItems(p1);
  handlePowerups(p0); handlePowerups(p1);
  handleBump(p0, p1);
  decayBuffs(p0, dt); decayBuffs(p1, dt);
  updateSplashes(dt);
  updateRings(dt);
  updateFloatTexts(dt);

  // Respawn fruit
  while (state.items.length < 28) spawnItem();
  // Power-up spawn
  if (state.powerups.length < 2 && rng() < .010) spawnPowerup();
  // Decay power-ups
  state.powerups.forEach(pu => pu.life -= dt);
  state.powerups = state.powerups.filter(pu => pu.life > 0);

  // Magnet effect: attract same-color fruit
  applyMagnet(p0, dt); applyMagnet(p1, dt);

  // Combo decay
  [p0, p1].forEach(p => {
    if (p.comboTime > 0) {
      p.comboTime -= dt;
      if (p.comboTime <= 0) { p.combo = 1; p.comboCount = 0; }
    }
  });

  // UI updates
  ui.p1Score.textContent = p0.score;
  ui.p2Score.textContent = p1.score;
  updateComboUI(p0, ui.p1Combo);
  updateComboUI(p1, ui.p2Combo);
  updateBuffBarUI();
  updateLeadFlag();
  updateRecipeUI();
  updateCoolUI();

  state.shake = Math.max(0, state.shake - dt * 18);
}

function updateCoolUI() {
  const me = state.players[0]; if (!me) return;
  const dashRatio  = clamp(me.dashCool / 2.5, 0, 1);
  const pulseRatio = clamp(me.pulseCool / 1.6, 0, 1);
  ui.dashCool.style.height  = `${dashRatio * 100}%`;
  ui.pulseCool.style.height = `${pulseRatio * 100}%`;
  ui.dashBtn.toggleAttribute('disabled', dashRatio > 0);
  ui.pulseBtn.toggleAttribute('disabled', pulseRatio > 0);
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------
function movePlayer(p, input, dt) {
  let speedMul = 1;
  if (p.buffs.speed > 0) speedMul *= 1.45;
  if (p.buffs.freeze > 0) speedMul *= 0.10; // frozen
  if (state.sudden) speedMul *= 1.10;

  const baseSpeed = (p.stun > 0 ? 360 : 820) * speedMul;
  const dashing = p.dashTime > 0;
  const accel = dashing ? 2200 : 1500;

  const dx = input.x - p.x, dy = input.y - p.y;
  const ang = Math.atan2(dy, dx);
  const targetSpeed = dashing ? 1400 * speedMul : baseSpeed;
  const mag = Math.hypot(dx, dy);
  if (mag > 4) {
    p.vx += Math.cos(ang) * accel * dt;
    p.vy += Math.sin(ang) * accel * dt;
  } else {
    p.vx *= .85; p.vy *= .85;
  }
  // Cap velocity
  const cur = Math.hypot(p.vx, p.vy);
  if (cur > targetSpeed) {
    p.vx = p.vx / cur * targetSpeed;
    p.vy = p.vy / cur * targetSpeed;
  }
  p.vx *= dashing ? .96 : .88;
  p.vy *= dashing ? .96 : .88;

  p.x = clamp(p.x + p.vx * dt, 25, W - 25);
  p.y = clamp(p.y + p.vy * dt, 116, H - 100);
  p.stun = Math.max(0, p.stun - dt);
  p.pulse = Math.max(0, p.pulse - dt * 2.8);
  p.pulseCool = Math.max(0, p.pulseCool - dt);
  p.dashCool  = Math.max(0, p.dashCool - dt);
  p.dashTime  = Math.max(0, p.dashTime - dt);
  p.flashHit  = Math.max(0, p.flashHit - dt * 3);

  // Trail
  p.trail.unshift({ x: p.x, y: p.y, t: 1, dash: dashing });
  p.trail = p.trail.slice(0, dashing ? 24 : 18)
                   .map(t => ({ ...t, t: t.t - dt * 2.4 }))
                   .filter(t => t.t > 0);
}

// ---------------------------------------------------------------------------
// Bot AI
// ---------------------------------------------------------------------------
function updateBotInput(dt, bot) {
  if (mode !== 'bot' || !bot) return;
  const cfg = DIFFICULTY[state.difficulty] || DIFFICULTY.normal;
  const plate = { x: W / 2, y: 130 };
  const needed = state.recipe[bot.cargo.length];
  let target;
  // Decide target
  if (bot.cargo.length === state.recipe.length) {
    target = plate;
  } else {
    // Look for needed color (or gold), with aim accuracy
    let candidates = state.items.filter(i => i.c === needed);
    // chase a power-up sometimes
    if (state.powerups.length && rng() < .35) {
      const near = state.powerups.sort((a, b) => dist(bot, a) - dist(bot, b))[0];
      if (near && dist(bot, near) < 220) candidates = [near];
    }
    candidates.sort((a, b) => dist(bot, a) - dist(bot, b));
    target = candidates[0] || state.items.sort((a, b) => dist(bot, a) - dist(bot, b))[0] || plate;
  }
  // Aim accuracy jitter (lower at low difficulty)
  const aim = cfg.botAim;
  const jitterX = (rng() - .5) * (1 - aim) * 220;
  const jitterY = (rng() - .5) * (1 - aim) * 220;
  remoteInput.x += ((target.x + jitterX) - remoteInput.x) * dt * cfg.botReact;
  remoteInput.y += ((target.y + jitterY) - remoteInput.y) * dt * cfg.botReact;

  // Pulse if close to you & has cargo or you have cargo
  const youP = state.players[0];
  if (youP && dist(bot, youP) < 78 && bot.pulseCool <= 0 && rng() < cfg.botPulseChance) {
    triggerPulse(1);
  }
  // Dash if far from target
  const targetDist = dist(bot, target);
  if (targetDist > 200 && bot.dashCool <= 0 && rng() < cfg.botDashChance) {
    triggerDash(1);
  }
  // Use shield/double automatically (already passive)
}

// ---------------------------------------------------------------------------
// Items / Delivery
// ---------------------------------------------------------------------------
function handleItems(p) {
  for (let i = state.items.length - 1; i >= 0; i--) {
    const item = state.items[i];
    if (dist(p, item) < p.r + item.r) {
      if (item.gold) {
        // Gold = immediate bonus points (no cargo slot)
        const bonus = 40 * p.combo;
        p.score += bonus;
        burst(item.x, item.y, GOLD.hex, 24);
        floatText(item.x, item.y, `+${bonus}`, '#ffd44a');
        Sound.beep(1200, .15, 'triangle');
        state.items.splice(i, 1);
      } else if (p.cargo.length < 3) {
        p.cargo.push(item.c);
        burst(item.x, item.y, COLORS[item.c].hex, 7);
        Sound.beep(600 + p.cargo.length * 120, .07);
        state.items.splice(i, 1);
      }
    }
  }
  const plate = { x: W / 2, y: 130, r: 50 };
  if (p.cargo.length && dist(p, plate) < p.r + plate.r) deliver(p);
}

function deliver(p) {
  const exact = p.cargo.length === state.recipe.length && p.cargo.every((c, i) => c === state.recipe[i]);
  const prefix = p.cargo.every((c, i) => c === state.recipe[i]);
  if (exact) {
    // Combo logic
    p.comboCount += 1;
    p.combo = Math.min(5, 1 + Math.floor(p.comboCount / 2));
    p.comboTime = 6.5;
    p.maxCombo = Math.max(p.maxCombo, p.combo);
    p.deliveries += 1;

    let pts = (100 + Math.round(state.timeLeft / 2)) * p.combo;
    if (p.nextDouble) { pts *= 2; p.nextDouble = false; }
    if (state.sudden) pts *= 2;
    p.score += pts;

    burst(W / 2, 130, '#ffd44a', 30);
    shockRing(W / 2, 130, p.color, 1.2);
    state.shake = 9;
    state.recipe = [pickColor(), pickColor(), pickColor()];
    floatText(p.x, p.y - 30, `+${pts}${p.combo > 1 ? ` ×${p.combo}` : ''}`, p.color);
    bigToast(p.isYou ? 'DELIVER!' : 'STOLEN!', p.isYou ? '#ffd166' : '#4cc9ff');
    Sound.success();
  } else if (!prefix || p.cargo.length >= 3) {
    p.score = Math.max(0, p.score - 15);
    p.stun = .8;
    p.combo = 1; p.comboCount = 0;
    burst(p.x, p.y, '#7bd88f', 22);
    floatText(p.x, p.y - 24, 'MISS!', '#9af5c0');
    state.shake = 6;
    Sound.fail();
  }
  p.cargo = [];
}

// ---------------------------------------------------------------------------
// Power-ups
// ---------------------------------------------------------------------------
function handlePowerups(p) {
  for (let i = state.powerups.length - 1; i >= 0; i--) {
    const pu = state.powerups[i];
    pu.y += pu.vy * 0.016;
    if (dist(p, pu) < p.r + 18) {
      applyPowerup(p, pu.def);
      burst(pu.x, pu.y, pu.def.color, 18);
      state.powerups.splice(i, 1);
    }
  }
}

function applyPowerup(p, def) {
  Sound.beep(900, .15, 'square');
  floatText(p.x, p.y - 28, `${def.emoji} ${def.label}`, def.color);
  switch (def.key) {
    case 'speed':
    case 'magnet':
      p.buffs[def.key] = def.dur;
      break;
    case 'shield':
      p.hasShield = true;
      break;
    case 'double':
      p.nextDouble = true;
      break;
    case 'bomb':
      // Push opponents around
      const opp = state.players.find(x => x !== p);
      if (opp) {
        const d = dist(p, opp);
        if (d < 220) {
          const nx = (opp.x - p.x) / Math.max(1, d), ny = (opp.y - p.y) / Math.max(1, d);
          opp.vx += nx * 720; opp.vy += ny * 720;
          opp.stun = .6;
          if (opp.hasShield) { opp.hasShield = false; floatText(opp.x, opp.y - 32, 'SHIELD!', '#9af5c0'); }
          else if (opp.cargo.length) { opp.cargo.splice(rng() < .5 ? 0 : opp.cargo.length-1, 1); }
        }
      }
      shockRing(p.x, p.y, '#ff7a30', 1.6);
      state.shake = 12;
      break;
    case 'freeze':
      // Freeze opponent
      const fopp = state.players.find(x => x !== p);
      if (fopp) {
        if (fopp.hasShield) { fopp.hasShield = false; floatText(fopp.x, fopp.y - 32, 'SHIELD!', '#9af5c0'); }
        else { fopp.buffs.freeze = def.dur; floatText(fopp.x, fopp.y - 24, 'FROZEN!', '#a8e6ff'); }
      }
      break;
  }
}

function applyMagnet(p, dt) {
  if (!p.buffs.magnet || p.buffs.magnet <= 0) return;
  const needed = state.recipe[p.cargo.length];
  state.items.forEach(it => {
    if (it.c !== needed && !it.gold) return;
    const d = dist(p, it);
    if (d < 180 && d > 1) {
      const ax = (p.x - it.x) / d, ay = (p.y - it.y) / d;
      it.x += ax * 320 * dt;
      it.y += ay * 320 * dt;
    }
  });
}

function decayBuffs(p, dt) {
  for (const k of Object.keys(p.buffs)) {
    p.buffs[k] = Math.max(0, p.buffs[k] - dt);
    if (p.buffs[k] === 0) delete p.buffs[k];
  }
}

// ---------------------------------------------------------------------------
// Collisions / pulses
// ---------------------------------------------------------------------------
function handleBump(a, b) {
  const d = dist(a, b);
  if (d > 0 && d < a.r + b.r) {
    const nx = (a.x - b.x) / d, ny = (a.y - b.y) / d;
    const force = (a.dashTime > 0 || b.dashTime > 0) ? 320 : 160;
    a.vx += nx * force; a.vy += ny * force;
    b.vx -= nx * force; b.vy -= ny * force;
    // Dasher steals cargo from non-dasher
    if (a.dashTime > 0 && b.dashTime <= 0) tryPickpocket(a, b);
    if (b.dashTime > 0 && a.dashTime <= 0) tryPickpocket(b, a);
    Sound.beep(220, .06, 'sawtooth');
  }
  // Pulse shockwave
  [a, b].forEach(p => {
    if (p.pulse > .62) {
      const other = p === a ? b : a;
      const pd = dist(p, other);
      if (pd < 130) {
        if (other.hasShield) {
          other.hasShield = false;
          floatText(other.x, other.y - 28, 'SHIELD!', '#9af5c0');
          shockRing(other.x, other.y, '#9af5c0', 1.0);
        } else {
          other.vx += (other.x - p.x) / Math.max(1, pd) * 620;
          other.vy += (other.y - p.y) / Math.max(1, pd) * 620;
          other.stun = .45;
          other.flashHit = 1;
          if (other.cargo.length && rng() < .35) {
            const lost = other.cargo.pop();
            burst(other.x, other.y - 20, COLORS[lost].hex, 8);
            floatText(other.x, other.y - 24, 'DROP!', COLORS[lost].hex);
          }
          p.pulseHits += 1;
          state.shake = 7;
        }
      }
    }
  });
}

function tryPickpocket(thief, victim) {
  if (!victim.cargo.length) return;
  if (victim.hasShield) {
    victim.hasShield = false;
    floatText(victim.x, victim.y - 28, 'SHIELD!', '#9af5c0');
    return;
  }
  const stolen = victim.cargo.pop();
  if (thief.cargo.length < 3) thief.cargo.push(stolen);
  floatText(victim.x, victim.y - 26, 'SNATCH!', '#ff86a3');
  Sound.beep(700, .1, 'square');
}

function triggerPulse(id) {
  const p = state.players[id]; if (!p) return;
  if (p.pulseCool > 0) return;
  p.pulse = 1; p.pulseCool = 1.6;
  state.shake = 5;
  burst(p.x, p.y, p.color, 18);
  shockRing(p.x, p.y, p.color, 1.0);
  Sound.beep(420, .15, 'square');
  if (id === 0) { localInput.pulse = true; localInput.seq++; setTimeout(() => localInput.pulse = false, 80); }
}

function triggerDash(id) {
  const p = state.players[id]; if (!p) return;
  if (p.dashCool > 0 || p.stun > 0) return;
  p.dashTime = .35; p.dashCool = 2.5;
  burst(p.x, p.y, p.color, 12);
  Sound.beep(950, .12, 'sawtooth');
  if (id === 0) { localInput.dash = true; localInput.seq++; setTimeout(() => localInput.dash = false, 80); }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    state.splashes.push({
      x, y,
      vx: (rng() - .5) * 280, vy: (rng() - .5) * 280,
      life: .5 + rng() * .6, color, r: 3 + rng() * 4,
    });
  }
}
function shockRing(x, y, color, scale = 1) {
  state.rings.push({ x, y, r: 12, maxR: 130 * scale, life: 1, color });
}
function floatText(x, y, text, color) {
  state.floatTexts.push({ x, y, text, color, life: 1, vy: -42 });
}
function updateSplashes(dt) {
  state.splashes.forEach(s => { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 80 * dt; s.life -= dt; });
  state.splashes = state.splashes.filter(s => s.life > 0);
}
function updateRings(dt) {
  state.rings.forEach(r => { r.r = lerp(r.r, r.maxR, dt * 6); r.life -= dt * 1.8; });
  state.rings = state.rings.filter(r => r.life > 0);
}
function updateFloatTexts(dt) {
  state.floatTexts.forEach(f => { f.y += f.vy * dt; f.life -= dt * .9; });
  state.floatTexts = state.floatTexts.filter(f => f.life > 0);
}

function bigToast(text, color = '#ffd166') {
  ui.bigToast.textContent = text;
  ui.bigToast.style.color = color;
  ui.bigToast.classList.remove('hidden');
  ui.bigToast.style.animation = 'none';
  void ui.bigToast.offsetWidth;
  ui.bigToast.style.animation = '';
  clearTimeout(bigToast.t);
  bigToast.t = setTimeout(() => ui.bigToast.classList.add('hidden'), 900);
}

// ---------------------------------------------------------------------------
// Finish round
// ---------------------------------------------------------------------------
function finishRound() {
  state.over = true;
  state.running = false;
  const [a, b] = state.players;
  const result =
    a.score === b.score ? 'tie' :
    a.score >  b.score ? 'win' : 'lose';

  ui.resultBadge.className = `result-badge ${result === 'win' ? '' : result === 'lose' ? 'lose' : 'tie'}`;
  ui.resultBadge.textContent = result === 'win' ? 'WIN!' : result === 'lose' ? 'LOSE' : 'TIE';
  ui.resultTitle.textContent =
    result === 'win'  ? '🏆 ピクニック王！' :
    result === 'lose' ? '🌪 惜敗… 次は奪い返せ！' :
                        '🤝 互角の戦い！';
  ui.rYou.textContent = a.score;
  ui.rRival.textContent = b.score;
  ui.rRivalLab.textContent = b.label;
  ui.rMaxCombo.textContent  = `×${a.maxCombo}`;
  ui.rDeliveries.textContent = a.deliveries;
  ui.rPulses.textContent     = a.pulseHits;

  if (result === 'win') Sound.fanfare();
  else if (result === 'lose') Sound.beep(200, .6, 'sawtooth');
  else Sound.beep(440, .4);

  setTimeout(() => show('result'), 1100);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
function draw(now) {
  const sx = (Math.random() - .5) * state.shake, sy = (Math.random() - .5) * state.shake;
  ctx.save();
  ctx.translate(sx, sy);
  drawBackground(now);
  drawPlate(now);
  drawPowerups(now);
  state.items.forEach((item) => drawItem(item, now));
  state.rings.forEach(drawRing);
  state.splashes.forEach(drawSplash);
  state.players.forEach(p => drawPlayer(p, now));
  drawFloatTexts();
  ctx.restore();
}

function drawBackground(now) {
  // gradient
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (state.sudden) {
    g.addColorStop(0, '#3a0f4a'); g.addColorStop(.5, '#5c1a4a'); g.addColorStop(1, '#2a0f3e');
  } else {
    g.addColorStop(0, '#2a1761'); g.addColorStop(.5, '#1a1138'); g.addColorStop(1, '#10082a');
  }
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // stars
  state.stars.forEach((s, i) => {
    const a = .3 + .7 * Math.abs(Math.sin(now / 700 + s.tw));
    ctx.globalAlpha = a;
    ctx.fillStyle = i % 7 === 0 ? '#ffd166' : '#fff';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;

  // floating bokeh blobs
  ctx.globalAlpha = .12;
  for (let i = 0; i < 6; i++) {
    const c = COLORS[i];
    ctx.fillStyle = c.hex;
    const x = (i * 96 + now * .015) % (W + 80) - 40;
    const y = 200 + (i * 91) % 520;
    ctx.beginPath();
    ctx.ellipse(x, y, 60, 28, Math.sin(now / 1100 + i), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlate(now) {
  const cx = W / 2, cy = 130;
  // glow ring
  ctx.save();
  ctx.shadowBlur = 26;
  ctx.shadowColor = state.sudden ? '#ff5f8d' : '#ffd166';
  ctx.fillStyle = 'rgba(255,255,255,.92)';
  ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = state.sudden ? '#ff5f8d' : '#ff9242';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.stroke();
  // recipe slots in plate
  state.recipe.forEach((c, i) => {
    ctx.fillStyle = COLORS[c].hex;
    ctx.shadowBlur = 12; ctx.shadowColor = COLORS[c].glow;
    ctx.beginPath(); ctx.arc(cx - 24 + i * 24, cy, 9, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  });
  // pulsing arrow
  const t = (Math.sin(now / 260) + 1) / 2;
  ctx.fillStyle = `rgba(255, 210, 80, ${.4 + t * .4})`;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 56);
  ctx.lineTo(cx - 8, cy + 70);
  ctx.lineTo(cx + 8, cy + 70);
  ctx.closePath(); ctx.fill();
}

function drawPowerups(now) {
  state.powerups.forEach(pu => {
    const bob = Math.sin(now / 240 + pu.wobble) * 4;
    ctx.save();
    ctx.translate(pu.x, pu.y + bob);
    ctx.rotate(Math.sin(now / 600 + pu.wobble) * .25);
    // outer halo
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 28);
    g.addColorStop(0, pu.def.color);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(-30, -30, 60, 60);
    // box
    ctx.fillStyle = '#ffffffee';
    ctx.strokeStyle = pu.def.color; ctx.lineWidth = 3;
    roundRect(ctx, -18, -18, 36, 36, 8, true, true);
    // emoji
    ctx.fillStyle = '#2a0f5e';
    ctx.font = '900 22px ui-rounded, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pu.def.emoji, 0, 1);
    ctx.restore();
  });
}

function roundRect(ctx, x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

function drawItem(item, now) {
  const bob = Math.sin(now / 280 + item.wobble) * 4;
  ctx.save();
  if (item.gold) {
    ctx.shadowBlur = 18; ctx.shadowColor = GOLD.glow;
    ctx.fillStyle = GOLD.hex;
  } else {
    ctx.shadowBlur = 10; ctx.shadowColor = COLORS[item.c].glow;
    ctx.fillStyle = COLORS[item.c].hex;
  }
  ctx.beginPath(); ctx.arc(item.x, item.y + bob, item.r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  // highlight
  ctx.fillStyle = '#ffffffaa';
  ctx.beginPath(); ctx.arc(item.x - 4, item.y + bob - 5, item.r * .32, 0, Math.PI * 2); ctx.fill();
  // leaf for gold
  if (item.gold) {
    ctx.fillStyle = '#5ee08a';
    ctx.beginPath();
    ctx.ellipse(item.x + 4, item.y + bob - 14, 5, 3, -.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawSplash(s) {
  ctx.globalAlpha = Math.max(0, s.life);
  ctx.shadowBlur = 8; ctx.shadowColor = s.color;
  ctx.fillStyle = s.color;
  ctx.beginPath(); ctx.arc(s.x, s.y, (s.r ?? 4) + s.life * 3, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}
function drawRing(r) {
  ctx.globalAlpha = Math.max(0, r.life);
  ctx.strokeStyle = r.color;
  ctx.lineWidth = 5 * r.life + 1;
  ctx.shadowBlur = 18; ctx.shadowColor = r.color;
  ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawPlayer(p, now) {
  // trail
  p.trail.forEach((t, i) => {
    ctx.globalAlpha = t.t * (t.dash ? .55 : .35);
    ctx.fillStyle = t.dash ? '#ffd166' : p.color;
    ctx.beginPath();
    ctx.arc(t.x, t.y, p.r * (1 - i / 28), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // pulse aura
  if (p.pulse > 0) {
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = p.pulse;
    ctx.lineWidth = 5;
    ctx.shadowBlur = 24; ctx.shadowColor = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 24 + (1 - p.pulse) * 100, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // shield ring
  if (p.hasShield) {
    const t = (Math.sin(now / 220) + 1) / 2;
    ctx.strokeStyle = '#9af5c0';
    ctx.globalAlpha = .5 + t * .35;
    ctx.lineWidth = 3;
    ctx.shadowBlur = 14; ctx.shadowColor = '#9af5c0';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 10, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  // frozen overlay
  if (p.buffs.freeze > 0) {
    ctx.strokeStyle = '#a8e6ff';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const ang = now/300 + i * Math.PI/2;
      ctx.beginPath();
      ctx.moveTo(p.x + Math.cos(ang)*(p.r+4), p.y + Math.sin(ang)*(p.r+4));
      ctx.lineTo(p.x + Math.cos(ang)*(p.r+14), p.y + Math.sin(ang)*(p.r+14));
      ctx.stroke();
    }
  }

  // body
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2); ctx.fill();

  const hitFlash = p.flashHit > 0 ? p.flashHit : 0;
  ctx.fillStyle = hitFlash > 0 ? '#fff' : p.color;
  ctx.shadowBlur = 14; ctx.shadowColor = p.color;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  // eyes (cute)
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(p.x - 6, p.y - 3, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(p.x + 6, p.y - 3, 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2a0f5e';
  ctx.beginPath(); ctx.arc(p.x - 5, p.y - 2, 2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(p.x + 7, p.y - 2, 2, 0, Math.PI * 2); ctx.fill();
  // mouth
  ctx.strokeStyle = '#2a0f5e'; ctx.lineWidth = 2;
  ctx.beginPath();
  if (p.stun > 0) { ctx.moveTo(p.x - 4, p.y + 7); ctx.lineTo(p.x + 4, p.y + 7); }
  else { ctx.arc(p.x, p.y + 4, 4, .1 * Math.PI, .9 * Math.PI); }
  ctx.stroke();

  // label
  ctx.fillStyle = '#fff';
  ctx.font = '900 10px ui-rounded, sans-serif';
  ctx.textAlign = 'center';
  ctx.shadowBlur = 6; ctx.shadowColor = '#000';
  ctx.fillText(p.label, p.x, p.y + p.r + 14);
  ctx.shadowBlur = 0;

  // cargo balls on top
  p.cargo.forEach((c, i) => {
    ctx.fillStyle = COLORS[c].hex;
    ctx.shadowBlur = 10; ctx.shadowColor = COLORS[c].glow;
    ctx.beginPath(); ctx.arc(p.x - 18 + i * 18, p.y - 34, 8, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  });

  // combo flame
  if (p.combo > 1) {
    ctx.fillStyle = '#ffd166';
    ctx.font = '900 12px ui-rounded, sans-serif';
    ctx.shadowBlur = 8; ctx.shadowColor = '#ffd166';
    ctx.fillText(`×${p.combo}🔥`, p.x, p.y - 50);
    ctx.shadowBlur = 0;
  }
}

function drawFloatTexts() {
  state.floatTexts.forEach(f => {
    ctx.globalAlpha = Math.max(0, f.life);
    ctx.fillStyle = f.color;
    ctx.font = '900 18px ui-rounded, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 8; ctx.shadowColor = f.color;
    ctx.fillText(f.text, f.x, f.y);
    ctx.shadowBlur = 0;
  });
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Input: virtual stick + touch + keyboard
// ---------------------------------------------------------------------------
function arenaPoint(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  return { x: (clientX - r.left) / r.width * W, y: (clientY - r.top) / r.height * H };
}

function showStick(x, y) {
  ui.stickBase.classList.remove('hidden');
  ui.stickBase.style.left = `${x - 65}px`;
  ui.stickBase.style.top  = `${y - 65}px`;
  ui.stickKnob.style.left = '50%';
  ui.stickKnob.style.top  = '50%';
  stick.baseX = x; stick.baseY = y;
}
function hideStick() {
  ui.stickBase.classList.add('hidden');
  stick.active = false; stick.dx = 0; stick.dy = 0;
}

ui.stickZone.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.action') || e.target.closest('.quit')) return;
  e.preventDefault();
  ui.stickZone.setPointerCapture(e.pointerId);
  stick.active = true; stick.pointerId = e.pointerId;
  showStick(e.clientX, e.clientY);
  updateStick(e.clientX, e.clientY);
});
ui.stickZone.addEventListener('pointermove', (e) => {
  if (!stick.active || e.pointerId !== stick.pointerId) return;
  updateStick(e.clientX, e.clientY);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
  ui.stickZone.addEventListener(ev, (e) => {
    if (e.pointerId !== stick.pointerId) return;
    hideStick();
  })
);

function updateStick(cx, cy) {
  let dx = cx - stick.baseX, dy = cy - stick.baseY;
  const d = Math.hypot(dx, dy);
  if (d > STICK_R) { dx = dx / d * STICK_R; dy = dy / d * STICK_R; }
  stick.dx = dx; stick.dy = dy;
  ui.stickKnob.style.left = `calc(50% + ${dx}px)`;
  ui.stickKnob.style.top  = `calc(50% + ${dy}px)`;
  // Drive local input toward player position + stick direction
  const me = state.players[0];
  if (me) {
    const k = STICK_R; // normalize
    const targetX = me.x + (dx / k) * 200;
    const targetY = me.y + (dy / k) * 200;
    localInput.x = clamp(targetX, 24, W - 24);
    localInput.y = clamp(targetY, 116, H - 100);
  }
}

// Keyboard (desktop fallback)
addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key === ' ' || e.key.toLowerCase() === 'x') triggerPulse(0);
  if (e.key === 'Shift' || e.key.toLowerCase() === 'z') triggerDash(0);
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function applyKeyboard(dt) {
  if (!state.running) return;
  const me = state.players[0]; if (!me) return;
  let dx = 0, dy = 0;
  if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
  if (keys.has('arrowright')|| keys.has('d')) dx += 1;
  if (keys.has('arrowup')   || keys.has('w')) dy -= 1;
  if (keys.has('arrowdown') || keys.has('s')) dy += 1;
  if (dx || dy) {
    const m = Math.hypot(dx, dy) || 1;
    localInput.x = clamp(me.x + (dx / m) * 220, 24, W - 24);
    localInput.y = clamp(me.y + (dy / m) * 220, 116, H - 100);
  }
}
// applyKeyboard is called from update()

// ---------------------------------------------------------------------------
// Canvas / resize
// ---------------------------------------------------------------------------
function resizeCanvas() {
  const dpr = Math.max(1, Math.min(3, devicePixelRatio || 1));
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resizeCanvas);

// ---------------------------------------------------------------------------
// Networking (WebRTC manual signaling — same as original, slightly polished)
// ---------------------------------------------------------------------------
async function hostRoom() {
  isHost = true; connected = false; roomSeed = Math.floor(Math.random() * 1e9);
  show('room');
  $('roomTitle').textContent = '友達ルームを作る';
  $('roomHelp').textContent  = '招待テキストを友達へ送って、返ってきた返事を貼り付けて接続。';
  await createPeer();
  channel = peer.createDataChannel('rally'); wireChannel();
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await waitIce(peer);
  ui.signalBox.value = pack({ type: 'offer', seed: roomSeed, sdp: peer.localDescription });
  ui.netStatus.textContent = '招待をコピーして友達に送ってください';
}
async function joinRoom() {
  isHost = false; connected = false;
  show('room');
  $('roomTitle').textContent = '招待で参加';
  $('roomHelp').textContent  = '友達から届いた招待テキストを貼り付けて「貼って接続」。返事が出たら友達へ送ってね。';
  ui.signalBox.value = ''; ui.netStatus.textContent = '招待待ち';
}
async function createPeer() {
  peer?.close();
  peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  peer.ondatachannel = (e) => { channel = e.channel; wireChannel(); };
  peer.onconnectionstatechange = () => {
    ui.netStatus.textContent = `接続状態: ${peer.connectionState}`;
    connected = peer.connectionState === 'connected';
  };
}
function wireChannel() {
  channel.onopen = () => {
    connected = true;
    ui.netStatus.textContent = '接続完了！開始できます';
    channel.send(JSON.stringify({ seed: roomSeed }));
  };
  channel.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.seed) roomSeed = msg.seed;
    if (msg.input) remoteInput = msg.input;
  };
}
async function handleSignal(text) {
  if (!text) return;
  try {
    const data = unpack(text);
    if (data.type === 'offer') {
      roomSeed = data.seed; await createPeer();
      await peer.setRemoteDescription(data.sdp);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitIce(peer);
      ui.signalBox.value = pack({ type: 'answer', seed: roomSeed, sdp: peer.localDescription });
      ui.netStatus.textContent = '返事をコピーしてホストへ送ってください';
    } else if (data.type === 'answer' && peer) {
      await peer.setRemoteDescription(data.sdp);
      ui.netStatus.textContent = '接続中...';
    }
  } catch (err) {
    ui.netStatus.textContent = `エラー: ${err.message}`;
  }
}
function pack(obj)   { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
function unpack(txt) { return JSON.parse(decodeURIComponent(escape(atob(txt)))); }
function waitIce(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') resolve();
    else pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && resolve();
    setTimeout(resolve, 2200);
  });
}
function syncNetwork() { if (channel?.readyState === 'open') channel.send(JSON.stringify({ input: localInput })); }

// ---------------------------------------------------------------------------
// Toast helper (small)
// ---------------------------------------------------------------------------
function toast(text, ms = 1400) {
  ui.toast.textContent = text;
  ui.toast.classList.remove('hidden');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ui.toast.classList.add('hidden'), ms);
}

// ---------------------------------------------------------------------------
// Wire UI events
// ---------------------------------------------------------------------------
$('howBtn').onclick = () => $('how').classList.toggle('hidden');
$('botBtn').onclick = () => startGame('bot');
$('leaveBtn').onclick = endToMenu;
$('pulseBtn').onclick = () => triggerPulse(0);
$('dashBtn').onclick  = () => triggerDash(0);
$('hostBtn').onclick = hostRoom;
$('joinBtn').onclick = joinRoom;
$('backMenu').onclick = () => show('menu');
$('copySignal').onclick = async () => navigator.clipboard?.writeText(ui.signalBox.value);
$('pasteSignal').onclick = async () => {
  let v = ui.signalBox.value.trim();
  if (!v && navigator.clipboard) { try { v = (await navigator.clipboard.readText()).trim(); ui.signalBox.value = v; } catch {} }
  handleSignal(v);
};
$('startNet').onclick = () => startGame('friend');

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    state.difficulty = btn.dataset.diff;
  };
});

$('rRematch').onclick = () => startGame(mode);
$('rMenu').onclick = () => show('menu');

// Prevent context menu on long-press
window.addEventListener('contextmenu', e => e.preventDefault());

// Boot
resizeCanvas();
show('menu');
