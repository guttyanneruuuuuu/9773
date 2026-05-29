const canvas = document.getElementById("arena");
const ctx = canvas.getContext("2d");
const modeSelect = document.getElementById("modeSelect");
const p1CharSelect = document.getElementById("p1Char");
const p2CharSelect = document.getElementById("p2Char");
const startBtn = document.getElementById("startBtn");
const p1Status = document.getElementById("p1Status");
const p2Status = document.getElementById("p2Status");
const battleInfo = document.getElementById("battleInfo");

const GRAVITY = 1700;
const MOVE_ACCEL = 1300;
const AIR_FRICTION = 0.95;
const GROUND_FRICTION = 0.82;
const MAX_HP = 100;
const ROUND_TIME = 75;

const archetypes = [
  { id: "blade", label: "Blade Hawk", speed: 1.06, attack: 1.12, skill: "Burst Slash", color: "#6ee7ff" },
  { id: "volt", label: "Volt Raven", speed: 1.2, attack: 0.92, skill: "Flash Dash", color: "#f2cf45" },
  { id: "guard", label: "Iron Kite", speed: 0.9, attack: 1.3, skill: "Crush Wing", color: "#ff9a5f" },
];

const keyMap = {
  p1: { left: "KeyA", right: "KeyD", jump: "KeyW", dash: "ShiftLeft", attack: "KeyF" },
  p2: { left: "ArrowLeft", right: "ArrowRight", jump: "ArrowUp", dash: "Slash", attack: "Period" },
};

let mode = "single";
let keys = {};
let platforms = [];
let players = [];
let running = false;
let lastTime = 0;
let timer = ROUND_TIME;
let roundOver = false;
let stars = [];

function seedStars() {
  stars = Array.from({ length: 40 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * (canvas.height * 0.55),
    r: Math.random() * 1.8 + 0.6,
  }));
}

function setCharacterOptions() {
  for (const c of archetypes) {
    const o1 = document.createElement("option");
    o1.value = c.id;
    o1.textContent = `${c.label} (速${c.speed.toFixed(2)} 攻${c.attack.toFixed(2)})`;
    p1CharSelect.appendChild(o1);
    const o2 = document.createElement("option");
    o2.value = c.id;
    o2.textContent = o1.textContent;
    p2CharSelect.appendChild(o2);
  }
  p1CharSelect.value = archetypes[0].id;
  p2CharSelect.value = archetypes[1].id;
}

function archetypeById(id) {
  return archetypes.find((c) => c.id === id) || archetypes[0];
}

function generateArena() {
  const base = [{ x: 0, y: canvas.height - 40, w: canvas.width, h: 50 }];
  for (let i = 0; i < 8; i++) {
    const w = 130 + Math.random() * 150;
    base.push({
      x: 70 + Math.random() * (canvas.width - 210),
      y: 120 + i * 55 + Math.random() * 30,
      w,
      h: 14,
    });
  }
  base.push({ x: 140, y: 260, w: 160, h: 16 });
  base.push({ x: canvas.width - 300, y: 210, w: 180, h: 16 });
  platforms = base.sort((a, b) => a.y - b.y);
}

function createPlayer(slot, side, characterId) {
  const arch = archetypeById(characterId);
  return {
    slot,
    x: side === "left" ? 180 : canvas.width - 220,
    y: 100,
    vx: 0,
    vy: 0,
    w: 40,
    h: 56,
    hp: MAX_HP,
    grounded: false,
    jumpsLeft: 2,
    facing: side === "left" ? 1 : -1,
    dashCooldown: 0,
    attackCooldown: 0,
    invincible: 0,
    score: 0,
    archetype: arch,
    controls: slot === "p1" ? keyMap.p1 : keyMap.p2,
  };
}

function startGame() {
  mode = modeSelect.value;
  generateArena();
  players = [
    createPlayer("p1", "left", p1CharSelect.value),
    createPlayer("p2", "right", p2CharSelect.value),
  ];
  timer = ROUND_TIME;
  roundOver = false;
  running = true;
  lastTime = performance.now();
  battleInfo.textContent = mode === "single" ? "シングルバトル開始!" : "ローカル対戦開始!";
}

function resetRound() {
  players[0].x = 180;
  players[0].y = 100;
  players[0].vx = players[0].vy = 0;
  players[0].hp = MAX_HP;
  players[0].jumpsLeft = 2;
  players[0].invincible = 0;

  players[1].x = canvas.width - 220;
  players[1].y = 100;
  players[1].vx = players[1].vy = 0;
  players[1].hp = MAX_HP;
  players[1].jumpsLeft = 2;
  players[1].invincible = 0;
}

function getInputFor(player) {
  const c = player.controls;
  return {
    left: !!keys[c.left],
    right: !!keys[c.right],
    jump: !!keys[c.jump],
    dash: !!keys[c.dash],
    attack: !!keys[c.attack],
  };
}

function updateAI(ai, enemy) {
  const dx = enemy.x - ai.x;
  const sameLevel = Math.abs(enemy.y - ai.y) < 70;
  const input = { left: false, right: false, jump: false, dash: false, attack: false };
  if (dx < -15) input.left = true;
  if (dx > 15) input.right = true;
  if (!sameLevel && enemy.y < ai.y - 55 && ai.grounded) input.jump = true;
  if (Math.abs(dx) < 86 && sameLevel) input.attack = Math.random() > 0.3;
  if (Math.abs(dx) > 250 && ai.dashCooldown <= 0 && Math.random() > 0.7) input.dash = true;
  return input;
}

function applyControls(player, input, dt) {
  const speed = 420 * player.archetype.speed;
  const jumpPower = 670 * (0.9 + player.archetype.speed * 0.1);

  if (input.left) {
    player.vx -= MOVE_ACCEL * dt;
    player.facing = -1;
  }
  if (input.right) {
    player.vx += MOVE_ACCEL * dt;
    player.facing = 1;
  }

  if (input.jump && player.jumpsLeft > 0 && !player.jumpLock) {
    player.vy = -jumpPower;
    player.jumpsLeft -= 1;
    player.grounded = false;
    player.jumpLock = true;
  }
  if (!input.jump) player.jumpLock = false;

  if (input.dash && player.dashCooldown <= 0) {
    player.vx = player.facing * 780 * player.archetype.speed;
    player.vy *= 0.35;
    player.dashCooldown = 1.15 - player.archetype.speed * 0.15;
  }

  player.vx = Math.max(-speed, Math.min(speed, player.vx));
}

function doAttack(attacker, target) {
  if (attacker.attackCooldown > 0) return;
  attacker.attackCooldown = 0.33;
  const range = 58;
  const tx = target.x - attacker.x;
  const inFront = attacker.facing === 1 ? tx > 0 && tx < range : tx < 0 && tx > -range;
  const vertical = Math.abs(target.y - attacker.y) < 50;
  if (inFront && vertical && target.invincible <= 0) {
    const damage = 13 * attacker.archetype.attack;
    target.hp = Math.max(0, target.hp - damage);
    target.vx += attacker.facing * 340;
    target.vy = -220;
    target.invincible = 0.18;
    attacker.score += Math.round(damage);
  }
}

function resolvePlatformCollision(player, dt) {
  player.grounded = false;
  const nextY = player.y + player.vy * dt;
  for (const p of platforms) {
    const withinX = player.x + player.w / 2 > p.x && player.x - player.w / 2 < p.x + p.w;
    const wasAbove = player.y + player.h / 2 <= p.y;
    const lands = nextY + player.h / 2 >= p.y && player.vy >= 0;
    if (withinX && wasAbove && lands) {
      player.y = p.y - player.h / 2;
      player.vy = 0;
      player.grounded = true;
      player.jumpsLeft = 2;
      return;
    }
  }
  player.y = nextY;
}

function updatePlayer(player, input, dt) {
  applyControls(player, input, dt);

  player.vy += GRAVITY * dt;
  resolvePlatformCollision(player, dt);
  player.x += player.vx * dt;

  if (player.grounded) player.vx *= GROUND_FRICTION;
  else player.vx *= AIR_FRICTION;

  player.x = Math.max(player.w / 2, Math.min(canvas.width - player.w / 2, player.x));
  if (player.y > canvas.height + 120) {
    player.hp = 0;
  }
  if (player.dashCooldown > 0) player.dashCooldown -= dt;
  if (player.attackCooldown > 0) player.attackCooldown -= dt;
  if (player.invincible > 0) player.invincible -= dt;
}

function update(dt) {
  if (!running || roundOver) return;

  timer -= dt;
  const p1Input = getInputFor(players[0]);
  const p2Input = mode === "single" ? updateAI(players[1], players[0]) : getInputFor(players[1]);

  updatePlayer(players[0], p1Input, dt);
  updatePlayer(players[1], p2Input, dt);

  if (p1Input.attack) doAttack(players[0], players[1]);
  if (p2Input.attack) doAttack(players[1], players[0]);

  const [p1, p2] = players;
  if (p1.hp <= 0 || p2.hp <= 0 || timer <= 0) {
    roundOver = true;
    let winner = "引き分け";
    if (p1.hp > p2.hp) winner = "P1 勝利";
    if (p2.hp > p1.hp) winner = mode === "single" ? "AI 勝利" : "P2 勝利";
    battleInfo.textContent = `ラウンド終了: ${winner} | Startで再戦`;
    if (p1.hp > p2.hp) p1.score += 120;
    if (p2.hp > p1.hp) p2.score += 120;
    running = false;
  }
}

function drawPlayer(player) {
  const { x, y, w, h } = player;
  ctx.save();
  ctx.translate(x, y);
  if (player.invincible > 0) ctx.globalAlpha = 0.6;
  ctx.fillStyle = player.archetype.color;

  ctx.beginPath();
  ctx.moveTo(-w * 0.5, h * 0.35);
  ctx.lineTo(w * 0.45, h * 0.35);
  ctx.lineTo(w * 0.5, -h * 0.08);
  ctx.lineTo(0, -h * 0.5);
  ctx.lineTo(-w * 0.5, -h * 0.1);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#0b0e14";
  ctx.fillRect(-7, -6, 14, 8);

  if (player.attackCooldown > 0.2) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.beginPath();
    const dir = player.facing;
    ctx.moveTo(dir * 14, -4);
    ctx.lineTo(dir * 46, -12);
    ctx.stroke();
  }
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const s of stars) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const p of platforms) {
    const grad = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
    grad.addColorStop(0, "#5ad8ff");
    grad.addColorStop(1, "#1c5a7a");
    ctx.fillStyle = grad;
    ctx.fillRect(p.x, p.y, p.w, p.h);
  }

  for (const pl of players) drawPlayer(pl);

  if (!running && roundOver) {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 42px sans-serif";
    ctx.fillText("Round Over", canvas.width / 2 - 130, canvas.height / 2 - 15);
  }
}

function updateHud() {
  if (!players.length) return;
  const [p1, p2] = players;
  p1Status.textContent = `P1 ${p1.archetype.label} HP:${Math.round(p1.hp)} SCORE:${p1.score}`;
  p2Status.textContent = `${mode === "single" ? "AI" : "P2"} ${p2.archetype.label} HP:${Math.round(p2.hp)} SCORE:${p2.score}`;
  if (running) battleInfo.textContent = `残り ${Math.max(0, timer).toFixed(1)}s`;
}

function frame(now) {
  const dt = Math.min(0.02, (now - lastTime) / 1000 || 0);
  lastTime = now;
  update(dt);
  draw();
  updateHud();
  requestAnimationFrame(frame);
}

function bindInput() {
  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
  });
  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  document.querySelectorAll(".touch-block button").forEach((button) => {
    const block = button.closest(".touch-block");
    const playerKey = block.dataset.player === "1" ? "p1" : "p2";
    const action = button.dataset.key;
    const code = keyMap[playerKey][action];
    const on = (value) => {
      keys[code] = value;
    };
    button.addEventListener("touchstart", (e) => {
      e.preventDefault();
      on(true);
    });
    button.addEventListener("touchend", (e) => {
      e.preventDefault();
      on(false);
    });
    button.addEventListener("mousedown", () => on(true));
    button.addEventListener("mouseup", () => on(false));
    button.addEventListener("mouseleave", () => on(false));
  });
}

startBtn.addEventListener("click", () => {
  if (!players.length) {
    startGame();
    return;
  }
  if (!running && roundOver) {
    resetRound();
    running = true;
    roundOver = false;
    timer = ROUND_TIME;
    battleInfo.textContent = "再戦開始!";
    return;
  }
  startGame();
});

modeSelect.addEventListener("change", () => {
  const single = modeSelect.value === "single";
  document.querySelector('.touch-block[data-player="2"]').style.display = single ? "none" : "block";
});

setCharacterOptions();
bindInput();
seedStars();
generateArena();
players = [createPlayer("p1", "left", p1CharSelect.value), createPlayer("p2", "right", p2CharSelect.value)];
modeSelect.dispatchEvent(new Event("change"));
requestAnimationFrame(frame);
