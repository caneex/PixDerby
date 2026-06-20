const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const ui = document.getElementById("ui");
const playBtn = document.getElementById("play");
const settingsBtn = document.getElementById("settings");
const creditsBtn = document.getElementById("credits");
const creditsPanel = document.getElementById("credits-panel");
const creditsClose = document.getElementById("credits-close");
const settingsPanel = document.getElementById("settings-panel");
const settingsBack = document.getElementById("settings-back");
const settingsCars = document.getElementById("settings-cars");
const menuVolume = document.getElementById("menu-volume");
const carsPanel = document.getElementById("cars-panel");
const carPrev = document.getElementById("car-prev");
const carNext = document.getElementById("car-next");
const carPreview = document.getElementById("car-preview");
const carLabel = document.getElementById("car-label");
const carName = document.getElementById("car-name");
const carPick = document.getElementById("car-pick");
const carBack = document.getElementById("car-back");
const nicknameInput = document.getElementById("nickname");
const pausePanel = document.getElementById("pause-panel");
const pauseContinue = document.getElementById("pause-continue");
const pauseSettings = document.getElementById("pause-settings");
const pauseExit = document.getElementById("pause-exit");

let ws = null;
let myId = null;
let serverState = { players: [], events: [] };
let renderState = new Map();
let lastSnapshot = 0;
let serverNow = 0;

// Tile sizes (map_8.png scaled by 0.25): 888x892 -> 222x223
const TILE_W = 222;
const TILE_H = 223;
const INNER_COLS = 12;
const INNER_ROWS = 12;
// Dark boundary ring extends 5 tiles beyond inner playfield on each side.
const OUTER_COLS = INNER_COLS + 10;
const OUTER_ROWS = INNER_ROWS + 10;
const INNER_W = INNER_COLS * TILE_W;
const INNER_H = INNER_ROWS * TILE_H;
const OUTER_W = OUTER_COLS * TILE_W;
const OUTER_H = OUTER_ROWS * TILE_H;
const INNER_MIN_X = (OUTER_W - INNER_W) / 2;
const INNER_MIN_Y = (OUTER_H - INNER_H) / 2;
const INNER_MAX_X = INNER_MIN_X + INNER_W;
const INNER_MAX_Y = INNER_MIN_Y + INNER_H;

const arena = { w: OUTER_W, h: OUTER_H };
// Logical hitboxes (independent of sprite PNG size).
// Length/Width are in world units; all stages share the same box per model.
const HITBOXES = [
  { length: 200, width: 90 },
  { length: 200, width: 90 },
  { length: 200, width: 90 },
  { length: 200, width: 90 },
  { length: 200, width: 90 },
  { length: 200, width: 90 },
  { length: 200, width: 90 },
  { length: 200, width: 90 },
  { length: 200, width: 90 },
  { length: 200, width: 90 },
];
const camera = { x: 0, y: 0, shake: 0, shakeTime: 0, shakeDur: 0, shakeAmp: 0 };

const tireMarks = [];
const ENABLE_TIRE_MARKS = true;
const smoke = [];
const explosions = [];
const explosionSprites = [];
const boostSparks = [];

const ASSET_BASE = "assets";
const CAR_COUNT = 11;
const CAR_NAMES = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "★Maybach",
];
// Stage 0 = clean, Stage 1/2/3 = deformation variants.
const carSprites = [[], [], [], []];
const spriteOffsets = [];
let mapCanvas = null;
let mapTile = null;
let flameAnim = null;
let box1Img = null;
let box2Img = null;
let boostSpeedImg = null;
let boostHpImg = null;
let boostDamageImg = null;
let boostSizeImg = null;
const ENABLE_BOOST_FLAMES = true;
const flameAnchors = [];
const TILE_SCALE = 0.25;
let carScale = 1;
let assetsReady = false;
const CAMERA_ZOOM = 1.0;
// Keep visual scale at 1.0; sprite size already baked into the cleaned assets.
const CAR_VISUAL_SCALE = 1.0;
const EFFECT_SCALE = 1.2;
let currentZoom = CAMERA_ZOOM;
let debugHitboxes = false;
const DEBUG_COLLISIONS = false;
let collisionDebugSet = new Set();
const ENABLE_IMPACT_EFFECTS = true;
let explosionAnim = null;

let viewW = window.innerWidth;
let viewH = window.innerHeight;
let selectedCarIndex = 0;
let previewCarIndex = 0;
let menuMusic = null;
let menuMusicUnlocked = false;
let menuMusicVolume = 0.6;
let speedMaxFlashUntil = 0;
const playerDestroyedState = new Map();
const playerRespawnOrder = new Map();
let sortByKills = false;
let hpFlashUntil = 0;
let prevMyHits = null;
let sizeBoostDebugOnly = false;
let gameStarted = false;
let pauseMenuOpen = false;
let menuContext = "main";
let currentPlayerName = "";
let loopStarted = false;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && gameStarted) {
    e.preventDefault();
    if (!settingsPanel.classList.contains("hidden") || !carsPanel.classList.contains("hidden")) {
      closeGameSubmenus();
      openPauseMenu();
    } else if (pauseMenuOpen) {
      closePauseMenu();
    } else {
      openPauseMenu();
    }
    return;
  }
  if (e.key === "h" || e.key === "H") {
    if (e.shiftKey) {
      debugHitboxes = !debugHitboxes;
    } else {
      sortByKills = !sortByKills;
    }
  }
  if ((e.key === "b" || e.key === "B") && e.shiftKey) {
    sizeBoostDebugOnly = !sizeBoostDebugOnly;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "debug_size_only", enabled: sizeBoostDebugOnly }));
    }
  }
});
ui.addEventListener("pointerdown", () => {
  unlockMenuMusic();
});

playBtn.addEventListener("click", () => {
  const name = nicknameInput.value.trim();
  if (!name) {
    nicknameInput.classList.remove("nick-required");
    const nickLabel = document.getElementById("nickname-label");
    if (nickLabel) {
      nickLabel.classList.remove("nick-required");
    }
    // Force reflow to restart animation on every click.
    void nicknameInput.offsetWidth;
    nicknameInput.classList.add("nick-required");
    if (nickLabel) {
      void nickLabel.offsetWidth;
      nickLabel.classList.add("nick-required");
    }
    return;
  }
  playBtn.disabled = true;
  playBtn.textContent = "Loading...";
  loadAssets()
    .then(() => {
      unlockMenuMusic();
      start(name, selectedCarIndex);
    })
    .catch((err) => {
      console.error(err);
      playBtn.disabled = false;
      playBtn.textContent = "Play";
      ui.classList.remove("hidden");
      alert("Failed to load assets. Check console for details.");
    });
});

settingsBtn.addEventListener("click", () => {
  unlockMenuMusic();
  menuContext = "main";
  settingsPanel.classList.remove("game-overlay");
  creditsPanel.classList.add("hidden");
  carsPanel.classList.add("hidden");
  settingsPanel.classList.remove("hidden");
});

creditsBtn.addEventListener("click", () => {
  unlockMenuMusic();
  settingsPanel.classList.add("hidden");
  carsPanel.classList.add("hidden");
  creditsPanel.classList.remove("hidden");
});
creditsClose.addEventListener("click", () => {
  creditsPanel.classList.add("hidden");
});
settingsBack.addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
  settingsPanel.classList.remove("game-overlay");
  if (menuContext === "pause") {
    openPauseMenu();
  }
});
settingsCars.addEventListener("click", () => {
  previewCarIndex = selectedCarIndex;
  updateCarPreview();
  settingsPanel.classList.add("hidden");
  carsPanel.classList.toggle("game-overlay", menuContext === "pause");
  carsPanel.classList.remove("hidden");
});

carPrev.addEventListener("click", () => {
  previewCarIndex = (previewCarIndex - 1 + CAR_COUNT) % CAR_COUNT;
  updateCarPreview();
});
carNext.addEventListener("click", () => {
  previewCarIndex = (previewCarIndex + 1) % CAR_COUNT;
  updateCarPreview();
});
carPick.addEventListener("click", () => {
  selectedCarIndex = previewCarIndex;
  updateCarPreview();
  sendSelectedCarToServer();
  carsPanel.classList.add("hidden");
  carsPanel.classList.remove("game-overlay");
  if (menuContext === "pause") {
    settingsPanel.classList.add("game-overlay");
    settingsPanel.classList.remove("hidden");
  }
});
carBack.addEventListener("click", () => {
  carsPanel.classList.add("hidden");
  carsPanel.classList.remove("game-overlay");
  if (menuContext === "pause") {
    settingsPanel.classList.add("game-overlay");
    settingsPanel.classList.remove("hidden");
  }
});

pauseContinue.addEventListener("click", () => {
  closePauseMenu();
});

pauseSettings.addEventListener("click", () => {
  menuContext = "pause";
  pausePanel.classList.add("hidden");
  settingsPanel.classList.add("game-overlay");
  settingsPanel.classList.remove("hidden");
});

pauseExit.addEventListener("click", () => {
  exitToMainMenu();
});

function start(name, carIndex) {
  currentPlayerName = name;
  gameStarted = true;
  pauseMenuOpen = false;
  menuContext = "main";
  ui.classList.add("hidden");
  creditsPanel.classList.add("hidden");
  settingsPanel.classList.add("hidden");
  carsPanel.classList.add("hidden");
  pausePanel.classList.add("hidden");
  settingsPanel.classList.remove("game-overlay");
  carsPanel.classList.remove("game-overlay");
  stopMenuMusic();
  connect(name, carIndex);
  if (!loopStarted) {
    loopStarted = true;
    requestAnimationFrame(loop);
  }
}

function openPauseMenu() {
  if (!gameStarted) return;
  pauseMenuOpen = true;
  menuContext = "pause";
  targetMouseVec = { x: 0, y: 0 };
  mouseVec = { x: 0, y: 0 };
  boostHeld = false;
  closeGameSubmenus();
  pausePanel.classList.remove("hidden");
}

function closePauseMenu() {
  pauseMenuOpen = false;
  pausePanel.classList.add("hidden");
  closeGameSubmenus();
}

function closeGameSubmenus() {
  settingsPanel.classList.add("hidden");
  carsPanel.classList.add("hidden");
  settingsPanel.classList.remove("game-overlay");
  carsPanel.classList.remove("game-overlay");
}

function sendSelectedCarToServer() {
  if (!gameStarted || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "hello", name: currentPlayerName, car: selectedCarIndex }));
}

function exitToMainMenu() {
  closePauseMenu();
  gameStarted = false;
  pauseMenuOpen = false;
  myId = null;
  serverState = { players: [], events: [] };
  renderState.clear();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  ws = null;
  playBtn.disabled = false;
  playBtn.textContent = "Play";
  ui.classList.remove("hidden");
  unlockMenuMusic();
  playMenuMusic();
}

function connect(name, carIndex) {
  const url = `${location.origin.replace("http", "ws")}/ws?name=${encodeURIComponent(name)}&car=${carIndex}`;
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "hello", name, car: carIndex }));
    if (sizeBoostDebugOnly) {
      ws.send(JSON.stringify({ type: "debug_size_only", enabled: true }));
    }
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "welcome") {
      myId = msg.id;
      return;
    }
    if (msg.type === "state") {
      serverState = msg;
      serverNow = msg.time || serverNow;
      lastSnapshot = performance.now();
      // Detect healing (hits decreased) as a backup trigger for HP flash.
      const me = msg.players.find((p) => p.id === myId);
      if (me) {
        const hits = me.hits ?? 0;
        if (prevMyHits !== null && hits < prevMyHits) {
          hpFlashUntil = performance.now() + 3000;
        }
        prevMyHits = hits;
      }
      // Arena size is derived from tile grid (outer bounds).
      if (!mapCanvas) {
        mapCanvas = buildTiledMap();
        arena.w = mapCanvas.width;
        arena.h = mapCanvas.height;
      }
      for (const p of msg.players) {
        if (!renderState.has(p.id)) {
          renderState.set(p.id, {
            x: p.pos.x,
            y: p.pos.y,
            vx: p.vel.x,
            vy: p.vel.y,
            damage: p.damage,
            stage: p.stage || 0,
            boost: p.boost ?? 1,
            boostCharge: p.boostCharge ?? 0,
            boostUi: p.boost ?? 1,
            destroyed: p.destroyed,
            knockX: 0,
            knockY: 0,
            knockVX: 0,
            knockVY: 0,
            knockTime: 0,
            knockDur: 0.35,
            knockBaseX: 0,
            knockBaseY: 0,
            freezeAngle: p.angle || 0,
            freezeTime: 0,
            ignoreServerTime: 0,
            lastAngle: p.angle || 0,
            deathStart: 0,
            deathPhase: 0,
            lockX: p.pos.x,
            lockY: p.pos.y,
            lockAngle: p.angle || 0,
          });
        }
      }
      handleEvents(msg.events);
    }
  });

  ws.addEventListener("close", () => {
    ui.classList.remove("hidden");
    startMenuMusic();
  });

  window.addEventListener("mousemove", onMouseMove);
}

if (menuVolume) {
  menuMusicVolume = (parseInt(menuVolume.value, 10) || 60) / 100;
  menuVolume.addEventListener("input", () => {
    menuMusicVolume = (parseInt(menuVolume.value, 10) || 0) / 100;
    if (menuMusic) {
      menuMusic.volume = menuMusicVolume;
    }
  });
}

function ensureMenuMusic() {
  if (menuMusic) return;
  menuMusic = new Audio(`${ASSET_BASE}/sounds/OST_2.mp3`);
  menuMusic.loop = true;
  menuMusic.volume = menuMusicVolume;
}

function unlockMenuMusic() {
  if (menuMusicUnlocked) return;
  menuMusicUnlocked = true;
  ensureMenuMusic();
  startMenuMusic();
}

function startMenuMusic() {
  if (!menuMusicUnlocked) return;
  ensureMenuMusic();
  if (menuMusic.paused) {
    menuMusic.currentTime = menuMusic.currentTime || 0;
    menuMusic.play().catch(() => {});
  }
}

function stopMenuMusic() {
  if (!menuMusic) return;
  menuMusic.pause();
}

function updateCarPreview() {
  const index = Math.max(0, Math.min(CAR_COUNT - 1, previewCarIndex));
  if (carPreview) {
    carPreview.src = `${ASSET_BASE}/cars/car_${index + 1}.png`;
  }
  if (carLabel) {
    carLabel.textContent = `#${index + 1}`;
  }
  if (carName) {
    const name = CAR_NAMES[index] || "";
    carName.textContent = name || "\u00A0";
    if (index === 10) {
      carName.classList.add("car-name-special");
    } else {
      carName.classList.remove("car-name-special");
    }
  }
}

updateCarPreview();

let mouseVec = { x: 0, y: 0 };
let targetMouseVec = { x: 0, y: 0 };
const MOUSE_SMOOTHING = 0.02;
let lastInputSend = 0;
let boostHeld = false;
function onMouseMove(e) {
  if (pauseMenuOpen) return;
  const rect = canvas.getBoundingClientRect();
  // Mouse-to-world: account for camera offset and zoom so input matches view.
  const worldX = (e.clientX - rect.left - rect.width / 2) / currentZoom + camera.x;
  const worldY = (e.clientY - rect.top - rect.height / 2) / currentZoom + camera.y;
  if (typeof e.buttons === "number") {
    boostHeld = (e.buttons & 1) === 1;
  }
  const my = serverState.players.find((p) => p.id === myId);
  if (!my) return;
  const dx = worldX - my.pos.x;
  const dy = worldY - my.pos.y;
  const len = Math.hypot(dx, dy);
  if (len > 4) {
    targetMouseVec = { x: dx / len, y: dy / len };
  } else {
    targetMouseVec = { x: 0, y: 0 };
  }
}
window.addEventListener("mousedown", (e) => {
  if (pauseMenuOpen) return;
  if (e.button === 0) boostHeld = true;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) boostHeld = false;
});
window.addEventListener("blur", () => {
  boostHeld = false;
});

function sendInput() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  if (now - lastInputSend < 33) return;
  lastInputSend = now;
  if (pauseMenuOpen) {
    ws.send(JSON.stringify({ type: "input", dx: 0, dy: 0, boost: false }));
    return;
  }
  ws.send(JSON.stringify({ type: "input", dx: mouseVec.x, dy: mouseVec.y, boost: boostHeld }));
}

function loop() {
  sendInput();
  update();
  render();
  requestAnimationFrame(loop);
}

function update() {
  updatePlayerListState();
  // Smooth mouse direction so the car turns with a short delay.
  mouseVec.x += (targetMouseVec.x - mouseVec.x) * MOUSE_SMOOTHING;
  mouseVec.y += (targetMouseVec.y - mouseVec.y) * MOUSE_SMOOTHING;

  const smoothing = 0.18;
  for (const p of serverState.players) {
    const r = renderState.get(p.id);
    if (!r) continue;
    const now = performance.now();

    if (!p.destroyed) {
      if (r.ignoreServerTime > 0) {
        r.ignoreServerTime -= 0.016;
      } else {
        r.x += (p.pos.x - r.x) * smoothing;
        r.y += (p.pos.y - r.y) * smoothing;
      }
    r.vx = p.vel.x;
    r.vy = p.vel.y;
    r.damage = p.damage;
    r.stage = p.stage || 0;
    r.boost = p.boost ?? r.boost ?? 1;
    r.boostCharge = p.boostCharge ?? r.boostCharge ?? 0;
    r.boostUi += (r.boost - r.boostUi) * 0.15;
      r.destroyed = false;
      r.deathPhase = 0;
      r.lastAngle = p.angle || 0;
    } else if (r.deathPhase === 0) {
      // Start death sequence: lock position and angle.
      r.deathStart = now;
      r.deathPhase = 1; // fire
      r.lockX = r.x;
      r.lockY = r.y;
      r.lockAngle = p.angle || 0;
      r.destroyed = true;
    }

    if (ENABLE_TIRE_MARKS) {
      if (!r.lastTire || performance.now() - r.lastTire > 30) {
        const speed = Math.hypot(p.vel.x, p.vel.y);
        if (speed > 40 && !p.destroyed) {
          r.lastTire = performance.now();
          const forwardAngle = p.angle || 0;
          const rear = getRearWorldAt(r.x, r.y, p, forwardAngle);
          const jitter = (Math.random() - 0.5) * 0.6;
          tireMarks.push({
            x: rear.x + Math.cos(forwardAngle + Math.PI / 2) * jitter,
            y: rear.y + Math.sin(forwardAngle + Math.PI / 2) * jitter,
            a: forwardAngle,
            life: 1,
            width: Math.max(16, getHitboxForPlayer(p).width * 0.28),
            len: Math.max(26, Math.min(90, speed * 0.18)),
          });
        }
      }
    }

    if (p.damage > 0 && !p.destroyed && Math.random() < 0.15) {
      const forwardAngle = p.angle || 0;
      const rear = getRearWorldAt(r.x, r.y, p, forwardAngle);
      smoke.push({
        x: rear.x + (Math.random() - 0.5) * 10,
        y: rear.y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 8 * EFFECT_SCALE,
        vy: (-10 - Math.random() * 10) * EFFECT_SCALE,
        life: 1,
        size: (2 + Math.random() * 3) * EFFECT_SCALE,
      });
    }

    // Edge fall-off feedback (visual only; server still blocks movement).
    if (!p.destroyed && isNearEdge(p)) {
      const now = performance.now();
      if (!r.lastEdge || now - r.lastEdge > 400) {
        r.lastEdge = now;
        spawnEdgeFall(r.x, r.y);
        if (p.id === myId) {
          camera.shake = Math.min(8, camera.shake + 3);
          camera.shakeTime = 0.15;
          camera.shakeDur = 0.15;
          camera.shakeAmp = Math.max(camera.shakeAmp, camera.shake);
        }
      }
    }

    // Death sequence timing
    if (r.deathPhase > 0) {
      const t = (now - r.deathStart) / 1000;
      if (t >= 0.7 && r.deathPhase === 1) {
        r.deathPhase = 2; // wreck + smoke
      }
      if (t >= 2.7) {
        r.deathPhase = 3; // done (invisible)
      }
    }

    // Smoke during wreck phase (global up, emitter at rear).
    if (r.deathPhase === 2 && Math.random() < 0.12) {
      const forwardAngle = r.lockAngle;
      const rear = getRearWorldAt(r.lockX, r.lockY, p, forwardAngle);
      smoke.push({
        x: rear.x + (Math.random() - 0.5) * 6,
        y: rear.y + (Math.random() - 0.5) * 6,
        vx: (Math.random() - 0.5) * 2,
        vy: -14 - Math.random() * 6,
        life: 1,
        size: (3 + Math.random() * 3) * EFFECT_SCALE,
      });
    }

    // Visual knockback smoothing (no physics changes).
    if (ENABLE_IMPACT_EFFECTS) {
      if (r.knockTime > 0) {
        r.knockTime -= 0.016;
        const k = Math.max(0, r.knockTime / r.knockDur);
        r.knockX = r.knockBaseX * k;
        r.knockY = r.knockBaseY * k;
      } else if (r.knockX !== 0 || r.knockY !== 0) {
        // Once knockback is done, bake it into the smoothed position
        // so the car stays where it was knocked to.
        r.x += r.knockX;
        r.y += r.knockY;
        r.knockX = 0;
        r.knockY = 0;
      }
      if (r.freezeTime > 0) {
        r.freezeTime -= 0.016;
      }
    }
  }

  if (ENABLE_TIRE_MARKS) {
    for (let i = tireMarks.length - 1; i >= 0; i--) {
      tireMarks[i].life -= 0.01;
      if (tireMarks[i].life <= 0) tireMarks.splice(i, 1);
    }
  }

  for (let i = smoke.length - 1; i >= 0; i--) {
    const s = smoke[i];
    s.x += s.vx * 0.016;
    s.y += s.vy * 0.016;
    s.life -= 0.02;
    if (s.life <= 0) smoke.splice(i, 1);
  }

  for (let i = explosions.length - 1; i >= 0; i--) {
    const ex = explosions[i];
    ex.life -= 0.03;
    if (ex.life <= 0) explosions.splice(i, 1);
  }

  for (let i = boostSparks.length - 1; i >= 0; i--) {
    const s = boostSparks[i];
    s.x += s.vx * 0.016;
    s.y += s.vy * 0.016;
    s.life -= 0.03;
    if (s.life <= 0) boostSparks.splice(i, 1);
  }

  if (camera.shakeTime > 0) {
    camera.shakeTime -= 0.016;
    if (camera.shakeTime <= 0) {
      camera.shakeTime = 0;
      camera.shake = 0;
      camera.shakeAmp = 0;
    }
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const my = serverState.players.find((p) => p.id === myId) || serverState.players[0];
  if (my) {
    const r = renderState.get(my.id);
    if (r) {
      camera.x = r.x;
      camera.y = r.y;
    } else {
      camera.x = my.pos.x;
      camera.y = my.pos.y;
    }
  }
  // Map scaling: enforce a minimum zoom so the map always fills the view.
  currentZoom = getZoom();
  // Camera always follows player (no clamping to bounds).

  const shakeFactor = camera.shakeDur > 0 ? camera.shakeTime / camera.shakeDur : 0;
  const shakeAmp = camera.shakeAmp * shakeFactor;
  const shakeX = (Math.random() - 0.5) * shakeAmp;
  const shakeY = (Math.random() - 0.5) * shakeAmp;

  if (DEBUG_COLLISIONS) {
    collisionDebugSet = buildCollisionSet();
  } else {
    collisionDebugSet = new Set();
  }

  ctx.save();
  // Camera zoom makes cars appear larger and tighter on screen.
  ctx.scale(currentZoom, currentZoom);
  ctx.translate(
    viewW / (2 * currentZoom) + shakeX - camera.x,
    viewH / (2 * currentZoom) + shakeY - camera.y
  );

  drawArena();
  drawBoxes();
  drawBoosts();
  if (ENABLE_TIRE_MARKS) {
    drawTireMarks();
  }
  drawCars();
  drawParticles();
  drawBoostSparks();

  ctx.restore();

  drawHud();
}

function drawArena() {
  // Procedural pixel-art map (no external file dependency).
  if (mapCanvas) {
    ctx.drawImage(mapCanvas, 0, 0);
  } else {
    ctx.fillStyle = "#0f141a";
    ctx.fillRect(0, 0, arena.w, arena.h);
  }
}

function drawBoxes() {
  const boxes = serverState.boxes || [];
  for (const b of boxes) {
    const img = b.state === 1 ? box2Img : box1Img;
    if (!img) continue;
    const size = 96;
    ctx.drawImage(img, b.pos.x - size / 2, b.pos.y - size / 2, size, size);
  }
}

function drawBoosts() {
  const boosts = serverState.boosts || [];
  for (const b of boosts) {
    let img = boostSpeedImg;
    if (b.type === "hp") img = boostHpImg;
    if (b.type === "damage") img = boostDamageImg;
    if (b.type === "size") img = boostSizeImg;
    if (!img) continue;
    const size = 96;
    // Small pop/jump animation
    const t = performance.now() * 0.005 + b.id * 0.7;
    const bob = Math.sin(t) * 6;
    const scale = 1 + Math.max(0, Math.sin(t)) * 0.08;
    ctx.save();
    ctx.translate(b.pos.x, b.pos.y - bob);
    ctx.scale(scale, scale);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
}

function drawCars() {
  for (const p of serverState.players) {
    const r = renderState.get(p.id);
    if (!r) continue;

    const drawX = r.deathPhase > 0 ? r.lockX : r.x;
    const drawY = r.deathPhase > 0 ? r.lockY : r.y;
    const drawAngle = r.deathPhase > 0
      ? r.lockAngle
      : (r.freezeTime > 0 ? r.freezeAngle : (p.angle || 0));
    const baseX = drawX + (r.knockX || 0);
    const baseY = drawY + (r.knockY || 0);
    
    if (r.deathPhase === 3) {
      continue;
    }

    const stageIndex = r.deathPhase >= 1 ? 3 : Math.min(2, p.stage || 0);
    const sprite = getSpriteFor(p, stageIndex);
    if (!sprite) continue;
    const forwardAngle = drawAngle;
    const drawRot = forwardAngle + Math.PI;
    const hb = getHitboxForPlayer(p);
    const halfLen = hb.length * 0.5;
    const offset = getSpriteOffset(p.car);
    const sizeScale = getSizeScaleForPlayer(p);
    ctx.save();
    // Pivot handling:
    // Sprite front is on the left. We rotate around the front (pivot),
    // then offset so the physics position stays at the car center.
    const pivot = getFrontPivotWorldAt(baseX, baseY, p, forwardAngle);
    ctx.translate(pivot.x, pivot.y);
    ctx.rotate(drawRot);
    ctx.scale(carScale * sizeScale, carScale * sizeScale);
    // Align sprite center to physics center using offset (independent of PNG size).
    const drawOffsetX = (halfLen / sizeScale - sprite.width / 2) - offset.x;
    const drawOffsetY = (-sprite.height / 2) - offset.y;
    
    ctx.drawImage(sprite, drawOffsetX, drawOffsetY);

    // Boost flames (rear, two jets)
    if (ENABLE_BOOST_FLAMES && flameAnim) {
      const boosting = p.id === myId ? boostHeld : (p.boostCharge ?? 0) > 0.05;
      if (boosting) {
        const anchors = getFlameAnchors(p.car);
        drawBoostFlames(drawOffsetX, drawOffsetY, sprite, anchors);
      }
    }

    // No flame overlay during destruction; explosion handled separately.
    ctx.restore();

    if (debugHitboxes) {
      drawHitbox(p, { x: baseX, y: baseY }, collisionDebugSet.has(p.id));
    }

    // Name tag (pixel-style with shadow + plate)
    const label = p.name || "";
    const fontSize = 14;
    ctx.font = `bold ${fontSize}px "Lucida Console", "Consolas", monospace`;
    ctx.textAlign = "center";
    const tagY = baseY - 30;
    ctx.fillStyle = "#2a1450";
    ctx.fillText(label, baseX + 1, tagY + 1);
    ctx.fillStyle = "#e6edf3";
    ctx.fillText(label, baseX, tagY);
  }
}

function drawTireMarks() {
  for (const mark of tireMarks) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, mark.life) * 0.6;
    ctx.translate(mark.x, mark.y);
    ctx.rotate(mark.a);
    ctx.fillStyle = "#0a0f14";
    const w = mark.width;
    const h = Math.max(2, w * 0.35);
    const gap = 45;
    const len = mark.len || Math.max(24, w * 1.2);

    const drawCircleBlock = (cx, cy) => {
      // Pixelated 15x15 circle (radius 7.5).
      ctx.beginPath();
      ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawTrack = (yOff) => {
      // Single circle per wheel (top/bottom) per spawn.
      drawCircleBlock(0, yOff);
    };

    // Double strip spaced vertically (top/bottom) to look like two wheels.
    drawTrack(-gap / 2);
    drawTrack(gap / 2);

    // Pixel dust specks.
    if (Math.random() < 0.2) {
      ctx.fillRect(-w * 0.4, h, 2, 2);
    }
    ctx.restore();
  }
}

function drawBoostFlames(drawOffsetX, drawOffsetY, sprite, anchors) {
  // Draw flame image at anchor points inside the sprite space.
  const flameW = Math.max(8, sprite.width * 0.08);
  const flameH = flameW * 1.2;
  for (const a of anchors) {
    const lx = drawOffsetX + a.x;
    const ly = drawOffsetY + a.y;
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(Math.PI / 2); // 90 degrees
    const frame = getGifFrame(flameAnim, performance.now(), true);
    if (frame) {
      ctx.drawImage(frame, -flameW / 2, -flameH / 2, flameW, flameH);
    }
    ctx.restore();
  }
}



function drawParticles() {
  for (const s of smoke) {
    ctx.save();
    ctx.globalAlpha = s.life;
    ctx.fillStyle = "#7b8b93";
    ctx.fillRect(s.x, s.y, s.size, s.size);
    ctx.restore();
  }

  for (const ex of explosions) {
    ctx.save();
    ctx.globalAlpha = ex.life;
    ctx.fillStyle = "#ff6d00";
    for (const p of ex.bits) {
      ctx.fillRect(ex.x + p.x, ex.y + p.y, ex.size, ex.size);
    }
    ctx.restore();
  }

  // Explosion GIFs (one-shot)
  const now = performance.now();
  for (let i = explosionSprites.length - 1; i >= 0; i--) {
    const ex = explosionSprites[i];
    if (now - ex.start > ex.duration) {
      explosionSprites.splice(i, 1);
      continue;
    }
    if (explosionAnim) {
      const frame = getGifFrame(explosionAnim, now - ex.start, false);
      if (frame) {
        ctx.save();
        ctx.drawImage(frame, ex.x - ex.size / 2, ex.y - ex.size / 2, ex.size, ex.size);
        ctx.restore();
      }
    }
  }
}

function drawBoostSparks() {
  for (const s of boostSparks) {
    ctx.save();
    ctx.globalAlpha = s.life;
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x, s.y, s.size, s.size);
    ctx.restore();
  }
}

function drawHud() {
  drawBoostOverlay();
  drawMinimap();
  drawPlayerList();

  // Boost bar (bottom-left)
  const me = serverState.players.find((p) => p.id === myId) || serverState.players[0];
  const meR = myId ? renderState.get(myId) : null;
  const boost = meR?.boostUi ?? (me ? (me.boost ?? 1) : 1);
  const charge = meR?.boostCharge ?? (me ? (me.boostCharge ?? 0) : 0);
  const speedBoostActive = me ? (me.speedBoostUntil ?? 0) > serverNow : false;
  const maxFactor = speedBoostActive ? 5.0 : 2.5;
  const speed = me ? Math.hypot(me.vel?.x || 0, me.vel?.y || 0) : (meR ? Math.hypot(meR.vx || 0, meR.vy || 0) : 0);
  const speedByVel = speed / 650;
  const speedByBoost = 1 + (maxFactor - 1.0) * (meR?.boostCharge ?? (me ? (me.boostCharge ?? 0) : 0));
  const speedFactor = Math.min(maxFactor, Math.max(1.0, speedByVel, speedByBoost));
  const now = performance.now();
  if (speedFactor >= maxFactor && speedMaxFlashUntil < now) {
    speedMaxFlashUntil = now + 500;
  }
  const barW = 160;
  const barH = 10;
  const x = 12;
  const y = viewH - 90;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - 2, y - 2, barW + 4, barH + 4);

  // Speed label above the bar.
  ctx.font = "12px monospace";
  if (speedMaxFlashUntil > now) {
    ctx.fillStyle = "#7334C7";
    const pulse = 1 + Math.sin((now - (speedMaxFlashUntil - 500)) * 0.03) * 0.15;
    ctx.save();
    ctx.translate(x + 18, y - 10);
    ctx.scale(pulse, pulse);
    ctx.fillText("max!", 0, 0);
    ctx.restore();
  } else {
    ctx.fillStyle = "#e6edf3";
  const debugSpeed = debugHitboxes ? ` (${Math.round(speed)})` : "";
    ctx.fillText(`speed ${speedFactor.toFixed(1)}x${debugSpeed}`, x, y - 6);
  }

  ctx.fillStyle = "#3a3a42";
  ctx.fillRect(x, y, barW, barH);
  // Charge overlay shows current acceleration state.
  ctx.fillStyle = "#2f2f36";
  ctx.fillRect(x, y, barW * charge, barH);
  ctx.fillStyle = speedBoostActive ? "#3aa7ff" : "#7334C7";
  ctx.fillRect(x, y, barW * boost, barH);
  ctx.restore();

  // Health bar (below speed)
  let hits = 0;
  if (me) {
    // Size boost gives two hidden shield hits; the visible health bar stays 5-step.
    hits = Math.max(0, Math.min(5, me.hits ?? 0));
  }
  const maxHits = 5;
  const healthFrac = Math.max(0, Math.min(1, (maxHits - hits) / maxHits));
  const hy = y + 30;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(x - 2, hy - 2, barW + 4, barH + 4);
  ctx.fillStyle = "#3a3a42";
  ctx.fillRect(x, hy, barW, barH);
  let healthColor = "#00c853";
  if (hits >= 1) healthColor = "#7cff00";
  if (hits >= 2) healthColor = "#ffd600";
  if (hits >= 3) healthColor = "#ff9800";
  if (hits >= 4) healthColor = "#ff3d00";
  if (hits >= 5) healthColor = "transparent";
  ctx.fillStyle = healthColor;
  ctx.fillRect(x, hy, barW * healthFrac, barH);
  ctx.fillStyle = "#e6edf3";
  ctx.font = "12px monospace";
  ctx.fillText("health", x, hy - 6);
  ctx.restore();
}

function drawBoostOverlay() {
  const me = serverState.players.find((p) => p.id === myId) || serverState.players[0];
  if (!me) return;
  const now = performance.now();
  let color = null;
  let alpha = 0.35;
  if (me.speedBoostUntil && serverNow < me.speedBoostUntil) {
    const remaining = me.speedBoostUntil - serverNow;
    const total = 4.0;
    const t = Math.min(1, Math.max(0, remaining / total));
    const fade = t * t * (3 - 2 * t); // smoothstep
    color = "rgba(80,170,255,1)";
    alpha = 0.35 * fade;
    if (remaining <= 2.0) {
      const pulse = 0.5 + Math.sin(performance.now() * 0.012) * 0.5;
      alpha = (0.2 + 0.2 * pulse) * fade;
    }
  }
  if (me.damageBoostUntil && serverNow < me.damageBoostUntil) {
    const remaining = me.damageBoostUntil - serverNow;
    const total = 6.0;
    const t = Math.min(1, Math.max(0, remaining / total));
    const fade = t * t * (3 - 2 * t); // smoothstep
    color = "rgba(255,60,60,1)";
    alpha = 0.35 * fade;
    if (remaining <= 2.0) {
      const pulse = 0.5 + Math.sin(performance.now() * 0.012) * 0.5;
      alpha = (0.2 + 0.2 * pulse) * fade;
    }
  }
  if (me.sizeBoostUntil && serverNow < me.sizeBoostUntil) {
    const remaining = me.sizeBoostUntil - serverNow;
    const total = 6.0;
    const t = Math.min(1, Math.max(0, remaining / total));
    const fade = t * t * (3 - 2 * t); // smoothstep
    color = "rgba(255,140,40,1)";
    alpha = 0.35 * fade;
  }
  if (hpFlashUntil > now) {
    color = "rgba(80,255,120,1)";
    const t = (hpFlashUntil - now) / 3000;
    alpha = 0.2 + 0.3 * (0.5 + Math.sin((1 - t) * Math.PI * 4) * 0.5);
  }
  if (!color) return;

  const pad = 100;
  ctx.save();
  // Radial fade from edges to center
  const grad = ctx.createRadialGradient(
    viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.25,
    viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.75
  );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(1, color.replace("1)", `${alpha})`));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, viewW, viewH);
  // Stronger top/bottom bands
  const band = ctx.createLinearGradient(0, 0, 0, pad);
  band.addColorStop(0, color.replace("1)", `${alpha})`));
  band.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, viewW, pad);
  const bandB = ctx.createLinearGradient(0, viewH - pad, 0, viewH);
  bandB.addColorStop(0, "rgba(0,0,0,0)");
  bandB.addColorStop(1, color.replace("1)", `${alpha})`));
  ctx.fillStyle = bandB;
  ctx.fillRect(0, viewH - pad, viewW, pad);
  ctx.restore();
}

function drawMinimap() {
  const size = 150;
  const pad = 12;
  const x = pad;
  const y = pad;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const radius = size / 2;
  const me = serverState.players.find((p) => p.id === myId) || serverState.players[0];
  if (!me) return;

  ctx.save();
  // Background circle
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Clip to circle
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 2, 0, Math.PI * 2);
  ctx.clip();

  // Scale world positions into minimap radius
  // Show a larger area inside the minimap (zoomed out).
  const zoomIn = 0.5;
  const scaleX = (radius - 2) / (arena.w * zoomIn);
  const scaleY = (radius - 2) / (arena.h * zoomIn);
  const scale = Math.min(scaleX, scaleY);

  // Draw inner playfield bounds (square) for extra detail.
  const innerLeft = (INNER_MIN_X - me.pos.x) * scale;
  const innerTop = (INNER_MIN_Y - me.pos.y) * scale;
  const innerRight = (INNER_MAX_X - me.pos.x) * scale;
  const innerBottom = (INNER_MAX_Y - me.pos.y) * scale;
  ctx.strokeStyle = "rgba(115,52,199,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(cx + innerLeft, cy + innerTop, innerRight - innerLeft, innerBottom - innerTop);
  ctx.lineWidth = 1;

  // Subtle center crosshair
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy);
  ctx.lineTo(cx + 6, cy);
  ctx.moveTo(cx, cy - 6);
  ctx.lineTo(cx, cy + 6);
  ctx.stroke();

  // Draw dots for players relative to local player (player stays centered).
  for (const p of serverState.players) {
    const dx = (p.pos.x - me.pos.x) * scale;
    const dy = (p.pos.y - me.pos.y) * scale;
    const px = cx + dx;
    const py = cy + dy;
    // Skip dots outside the circle
    if (Math.hypot(px - cx, py - cy) > radius - 4) continue;
    ctx.fillStyle = p.id === me.id ? "#7334C7" : "#e6edf3";
    ctx.fillRect(px - 3, py - 3, 6, 6);
  }

  ctx.restore();

  // Outline
  ctx.save();
  ctx.strokeStyle = "#7334C7";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPlayerList() {
  const pad = 12;
  const boxW = 200;
  const lineH = 18;
  const players = serverState.players ? [...serverState.players] : [];
  if (sortByKills) {
    players.sort((a, b) => {
      const ak = a.kills || 0;
      const bk = b.kills || 0;
      if (ak !== bk) return bk - ak;
      return (a.name || "").localeCompare(b.name || "");
    });
  } else {
    // Sorting by damage stage (same rule for all models).
    players.sort((a, b) => {
      const aStage = a.destroyed ? 3 : (a.stage || 0);
      const bStage = b.destroyed ? 3 : (b.stage || 0);
      if (aStage !== bStage) return bStage - aStage;
      return (a.name || "").localeCompare(b.name || "");
    });
  }
  const visible = players.slice(0, 10);
  const boxH = 14 + visible.length * lineH + 8;
  const x = viewW - boxW - pad;
  const y = pad;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(x, y, boxW, boxH);
  ctx.strokeStyle = "#7334C7";
  ctx.strokeRect(x, y, boxW, boxH);

  ctx.font = "12px monospace";
  let ty = y + 18;
  const now = performance.now();
  for (const p of visible) {
    const isMe = p.id === myId;
    if (p.destroyed) {
      const pulse = 0.5 + Math.sin(now * 0.02) * 0.3;
      ctx.fillStyle = `rgba(230,237,243,${pulse.toFixed(2)})`;
    } else {
      ctx.fillStyle = isMe ? "#7334C7" : "#e6edf3";
    }
    if (sortByKills) {
      const kills = p.kills || 0;
      ctx.fillText(`${p.name}  •  ${kills}`, x + 10, ty);
    } else {
      ctx.fillText(p.name, x + 10, ty);
    }
    ty += lineH;
  }
  ctx.restore();
}

function updatePlayerListState() {
  const now = performance.now();
  for (const p of serverState.players || []) {
    const prev = playerDestroyedState.get(p.id) || false;
    if (prev && !p.destroyed) {
      // Respawned: push to end.
      playerRespawnOrder.set(p.id, now);
    }
    if (!prev && p.destroyed) {
      // On destruction, clear respawn ordering so they jump to top.
      playerRespawnOrder.delete(p.id);
    }
    playerDestroyedState.set(p.id, p.destroyed);
  }
}

function handleEvents(events) {
  for (const ev of events) {
    if (ev.type === "hit") {
      if (ENABLE_IMPACT_EFFECTS) {
        applyKnockback(ev);
      }
      if (ev.target === myId || ev.causer === myId) {
        camera.shakeAmp = Math.max(camera.shakeAmp, Math.min(16, ev.force * 0.28));
        camera.shakeTime = 0.22;
        camera.shakeDur = 0.22;
      }
    }
    if (ev.type === "hit") {
      if (ev.force > 80) {
        smoke.push({ x: ev.x, y: ev.y, vx: 0, vy: -12 * EFFECT_SCALE, life: 1, size: 4 * EFFECT_SCALE });
      }
    }
    if (ev.type === "boost_pickup") {
      spawnBoostSparks(ev.x, ev.y, ev.causer);
      if (ev.target === myId && ev.causer === "hp") {
        hpFlashUntil = performance.now() + 3000;
      }
    }
  }

  // Check destroyed transitions
  for (const p of serverState.players) {
    const r = renderState.get(p.id);
    if (!r) continue;
    if (!r.destroyed && p.destroyed) {
      const radius = getBoundsRadiusForModel(p.car);
      spawnExplosion(r.x, r.y, radius);
      explosionSprites.push({
        x: r.x,
        y: r.y,
        size: Math.max(64, radius * 3.0),
        start: performance.now(),
        duration: explosionAnim ? explosionAnim.total : 700,
      });
    }
  }
}

function spawnBoostSparks(x, y, type) {
  let colors = ["#4fc3f7", "#81d4fa"];
  if (type === "hp") {
    colors = ["#7cff00", "#4caf50"];
  }
  if (type === "damage") {
    colors = ["#ff3d00", "#111111"];
  }
  if (type === "size") {
    colors = ["#ffb347", "#ff7a00"];
  }
  for (let i = 0; i < 16; i++) {
    boostSparks.push({
      x: x + (Math.random() - 0.5) * 10,
      y: y + (Math.random() - 0.5) * 10,
      vx: (Math.random() - 0.5) * 110,
      vy: (Math.random() - 0.5) * 110,
      life: 1,
      size: 4 + Math.random() * 4,
      color: colors[i % colors.length],
    });
  }
}

function spawnExplosion(x, y, radius) {
  const bits = [];
  const spread = Math.max(24, radius * 0.6);
  const size = Math.max(6, radius * 0.12);
  for (let i = 0; i < 14; i++) {
    bits.push({
      x: (Math.random() - 0.5) * spread,
      y: (Math.random() - 0.5) * spread,
    });
  }
  explosions.push({ x, y, bits, life: 1, size });
}

function buildSprites() {
  // Legacy placeholder builder removed in favor of real assets.
  return [];
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function getZoom() {
  // Ensure the full map fills the screen with no blank areas.
  const minZoomToCover = Math.max(viewW / arena.w, viewH / arena.h);
  return Math.max(CAMERA_ZOOM, minZoomToCover);
}

function getFrontPivotWorldAt(x, y, p, forwardAngle) {
  // Pivot handling: front of sprite is on the left; use logical hitbox length.
  const hb = getHitboxForPlayer(p);
  const halfLen = (hb.length * 0.5);
  const forward = { x: Math.cos(forwardAngle), y: Math.sin(forwardAngle) };
  // Front pivot is half-length ahead of center in the forward direction.
  return {
    x: x + forward.x * halfLen,
    y: y + forward.y * halfLen,
  };
}

function getRearWorldAt(x, y, p, forwardAngle) {
  // Rear point is half-length behind the center based on logical hitbox length.
  const hb = getHitboxForPlayer(p);
  const halfLen = (hb.length * 0.5);
  const forward = { x: Math.cos(forwardAngle), y: Math.sin(forwardAngle) };
  // Rear is behind center opposite forward direction.
  return {
    x: x - forward.x * halfLen,
    y: y - forward.y * halfLen,
  };
}

function isNearEdge(p) {
  const radius = getBoundsRadiusForModel(p.car);
  return (
    p.pos.x <= INNER_MIN_X + radius + 2 ||
    p.pos.y <= INNER_MIN_Y + radius + 2 ||
    p.pos.x >= INNER_MAX_X - radius - 2 ||
    p.pos.y >= INNER_MAX_Y - radius - 2
  );
}

function spawnEdgeFall(x, y) {
  for (let i = 0; i < 8; i++) {
    smoke.push({
      x: x + (Math.random() - 0.5) * 16,
      y: y + (Math.random() - 0.5) * 16,
      vx: (Math.random() - 0.5) * 12 * EFFECT_SCALE,
      vy: (10 + Math.random() * 12) * EFFECT_SCALE,
      life: 0.8,
      size: (2 + Math.random() * 4) * EFFECT_SCALE,
    });
  }
}

function getHitboxForModel(model) {
  const idx = Math.max(0, Math.min(HITBOXES.length - 1, model));
  return HITBOXES[idx];
}

function getSizeScaleForPlayer(p) {
  if (!p) return 1;
  return (p.sizeBoostUntil ?? 0) > serverNow ? 2 : 1;
}

function getHitboxForPlayer(p) {
  const hb = getHitboxForModel(p.car);
  const s = getSizeScaleForPlayer(p);
  // Slightly reduce size-boosted hitbox to better match visuals.
  const sizeMul = s > 1 ? 2 : 1;
  return { length: hb.length * sizeMul, width: hb.width * sizeMul };
}

function getSpriteFor(p, stageIndex) {
  const idx = p.car % CAR_COUNT;
  const stage = Math.max(0, Math.min(3, stageIndex));
  return carSprites[stage]?.[idx] || carSprites[0]?.[idx] || null;
}

function getSpriteOffset(model) {
  const idx = Math.max(0, Math.min(CAR_COUNT - 1, model));
  return spriteOffsets[idx] || { x: 0, y: 0 };
}

function getBoundsRadiusForModel(model) {
  const hb = getHitboxForModel(model);
  const halfL = hb.length * 0.5;
  const halfW = hb.width * 0.5;
  return Math.hypot(halfL, halfW);
}

function drawHitbox(p, r, isColliding) {
  const hb = getHitboxForPlayer(p);
  const halfL = hb.length * 0.5;
  const halfW = hb.width * 0.5;
  const forwardAngle = p.angle || 0;
  const fx = Math.cos(forwardAngle);
  const fy = Math.sin(forwardAngle);
  const rx = -fy;
  const ry = fx;

  const cx = r.x;
  const cy = r.y;

  const corners = [
    { x: cx + fx * halfL + rx * halfW, y: cy + fy * halfL + ry * halfW },
    { x: cx + fx * halfL - rx * halfW, y: cy + fy * halfL - ry * halfW },
    { x: cx - fx * halfL - rx * halfW, y: cy - fy * halfL - ry * halfW },
    { x: cx - fx * halfL + rx * halfW, y: cy - fy * halfL + ry * halfW },
  ];

  ctx.save();
  ctx.strokeStyle = isColliding ? "rgba(255,80,80,0.85)" : "rgba(0,255,255,0.7)";
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function buildCollisionSet() {
  const ids = serverState.players.map((p) => p.id);
  const colliding = new Set();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = serverState.players.find((p) => p.id === ids[i]);
      const b = serverState.players.find((p) => p.id === ids[j]);
      const ra = renderState.get(a.id);
      const rb = renderState.get(b.id);
      if (!a || !b || !ra || !rb) continue;
      if (!broadPhaseOBB(a, b, ra, rb)) continue;
      if (obbIntersectJS(a, b, ra, rb)) {
        colliding.add(a.id);
        colliding.add(b.id);
      }
    }
  }
  return colliding;
}

function broadPhaseOBB(a, b, ra, rb) {
  const raBound = getBoundsRadiusForModel(a.car);
  const rbBound = getBoundsRadiusForModel(b.car);
  const dx = rb.x - ra.x;
  const dy = rb.y - ra.y;
  const maxDist = raBound + rbBound;
  return dx * dx + dy * dy <= maxDist * maxDist;
}

function obbIntersectJS(a, b, ra, rb) {
  const ha = getHitboxForPlayer(a);
  const hb = getHitboxForPlayer(b);
  const aHalfL = ha.length * 0.5;
  const aHalfW = ha.width * 0.5;
  const bHalfL = hb.length * 0.5;
  const bHalfW = hb.width * 0.5;

  const ax = Math.cos(a.angle || 0);
  const ay = Math.sin(a.angle || 0);
  const bx = Math.cos(b.angle || 0);
  const by = Math.sin(b.angle || 0);

  const axes = [
    { x: ax, y: ay },
    { x: -ay, y: ax },
    { x: bx, y: by },
    { x: -by, y: bx },
  ];

  const dx = rb.x - ra.x;
  const dy = rb.y - ra.y;

  for (const axis of axes) {
    const ux = axis.x;
    const uy = axis.y;
    const raProj = Math.abs(ux * ax + uy * ay) * aHalfL + Math.abs(ux * -ay + uy * ax) * aHalfW;
    const rbProj = Math.abs(ux * bx + uy * by) * bHalfL + Math.abs(ux * -by + uy * bx) * bHalfW;
    const dist = Math.abs(dx * ux + dy * uy);
    if (raProj + rbProj - dist <= 0) {
      return false;
    }
  }
  return true;
}

function loadAssets() {
  if (assetsReady) return Promise.resolve();
  const carPromises = [];
  for (let i = 1; i <= CAR_COUNT; i++) {
    carPromises.push(loadImage(`${ASSET_BASE}/cars/car_${i}.png`));
  }
  const stage1Promises = [];
  const stage2Promises = [];
  const stage3Promises = [];
  for (let i = 1; i <= CAR_COUNT; i++) {
    stage1Promises.push(loadImage(`${ASSET_BASE}/cars_stage1/car_${i}.png`));
    stage2Promises.push(loadImage(`${ASSET_BASE}/cars_stage2/car_${i}.png`));
    stage3Promises.push(loadImage(`${ASSET_BASE}/cars_stage3/car_${i}.png`));
  }
  const tilePromise = loadImage(`${ASSET_BASE}/map/map_8.png`);
  const flamePromise = loadGif(`${ASSET_BASE}/effects/flame_1.gif`);
  const explosionPromise = loadGif(`${ASSET_BASE}/effects/explosion_1.gif`);
  const box1Promise = loadImage(`${ASSET_BASE}/boosts/WoodBox_1.png`);
  const box2Promise = loadImage(`${ASSET_BASE}/boosts/WoodBox_2.png`);
  const speedPromise = loadImage(`${ASSET_BASE}/boosts/Speed_1.png`);
  const hpPromise = loadImage(`${ASSET_BASE}/boosts/HP_1.png`);
  const dmgPromise = loadImage(`${ASSET_BASE}/boosts/Damage_1.png`);
  const sizePromise = loadImage(`${ASSET_BASE}/boosts/Size_1.png`);
  return Promise.all([
    Promise.all(carPromises),
    Promise.all(stage1Promises),
    Promise.all(stage2Promises),
    Promise.all(stage3Promises),
    tilePromise,
    flamePromise,
    explosionPromise,
    box1Promise,
    box2Promise,
    speedPromise,
    hpPromise,
    dmgPromise,
    sizePromise,
  ]).then(([cars, stage1, stage2, stage3, tile, flame, explosion, box1, box2, speed, hp, dmg, size]) => {
    carSprites[0] = cars;
    carSprites[1] = stage1;
    carSprites[2] = stage2;
    carSprites[3] = stage3;
    // Compute visual offsets from stage 0 sprites to align visuals to physics center.
    spriteOffsets.length = 0;
    for (let i = 0; i < cars.length; i++) {
      spriteOffsets.push(computeOpaqueCenterOffset(cars[i]));
    }
    // Build tiled map from the provided tile image.
    mapTile = tile;
    mapCanvas = buildTiledMap();
    arena.w = mapCanvas.width;
    arena.h = mapCanvas.height;
    // Car scaling is decoupled from collision radius for cleaned sprites.
    carScale = CAR_VISUAL_SCALE;
    flameAnim = flame;
    explosionAnim = explosion;
    box1Img = box1;
    box2Img = box2;
    boostSpeedImg = speed;
    boostHpImg = hp;
    boostDamageImg = dmg;
    boostSizeImg = size;
    // Build template anchors from first sprite that has markers.
    const template = findTemplateAnchors(cars);
    flameAnchors.length = 0;
    for (let i = 0; i < cars.length; i++) {
      flameAnchors.push(computeFlameAnchors(cars[i], template, i));
    }
    assetsReady = true;
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

async function loadGif(src) {
  if ("ImageDecoder" in window) {
    const res = await fetch(src);
    const buf = await res.arrayBuffer();
    const decoder = new ImageDecoder({ data: buf, type: "image/gif" });
    await decoder.tracks.ready;
    const count = decoder.tracks.selectedTrack.frameCount || 1;
    const frames = [];
    const delays = [];
    for (let i = 0; i < count; i++) {
      const frame = await decoder.decode({ frameIndex: i });
      frames.push(frame.image);
      delays.push(frame.duration || 100);
    }
    const total = delays.reduce((a, b) => a + b, 0);
    return { frames, delays, total };
  }
  // Fallback: static image
  const img = await loadImage(src);
  return { frames: [img], delays: [100], total: 100 };
}

function getGifFrame(anim, timeMs, loop = true) {
  if (!anim || !anim.frames.length) return null;
  const total = anim.total || 100;
  let t = loop ? (timeMs % total) : Math.min(timeMs, total - 1);
  for (let i = 0; i < anim.frames.length; i++) {
    const d = anim.delays[i] || 100;
    if (t < d) return anim.frames[i];
    t -= d;
  }
  return anim.frames[anim.frames.length - 1];
}

// GIFs are loaded as Images and animated by the browser.


function computeOpaqueCenterOffset(img) {
  // Finds the visual center of opaque pixels; used for rendering alignment only.
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const a = data[(y * c.width + x) * 4 + 3];
      if (a > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0 };
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: cx - c.width / 2, y: cy - c.height / 2 };
}

function computeFlameAnchors(img, template, index) {
  // Find red marker pixels and return two anchor points (top/bottom).
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;

  const reds = [];
  let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      const r = data[i];
      const gch = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      if (a > 10 && r > 200 && gch < 80 && b < 80) {
        reds.push({ x, y });
      }
    }
  }

  const hasMarkers = reds.length >= 2;
  if (!hasMarkers) {
    // No red markers: anchor to rear corners based on opaque bounds.
    if (maxX < 0) {
      return [
        { x: img.width - 4, y: img.height * 0.35 },
        { x: img.width - 4, y: img.height * 0.65 },
      ];
    }
    const marginX = Math.max(2, (maxX - minX) * 0.05);
    const marginY = Math.max(2, (maxY - minY) * 0.15);
    const x = maxX - marginX;
    const topY = minY + marginY;
    const botY = maxY - marginY;
    return [
      { x, y: topY },
      { x, y: botY },
    ];
  }

  // Split by median Y to get top/bottom anchors.
  const ys = reds.map((p) => p.y).sort((a, b) => a - b);
  const midY = ys[Math.floor(ys.length / 2)];
  let top = { x: 0, y: 0, n: 0 };
  let bot = { x: 0, y: 0, n: 0 };
  for (const p of reds) {
    if (p.y <= midY) {
      top.x += p.x; top.y += p.y; top.n++;
    } else {
      bot.x += p.x; bot.y += p.y; bot.n++;
    }
  }
  if (top.n === 0 || bot.n === 0) {
    return [
      { x: img.width - 4, y: img.height * 0.35 },
      { x: img.width - 4, y: img.height * 0.65 },
    ];
  }
  let anchors = [
    { x: top.x / top.n, y: top.y / top.n },
    { x: bot.x / bot.n, y: bot.y / bot.n },
  ];

  // Per-model manual tweaks (car_8 index = 7)
  if (index === 7) {
    anchors = [
      { x: anchors[0].x + 95, y: anchors[0].y },
      { x: anchors[0].x + 95, y: anchors[0].y + 55 },
    ];
  }
  return anchors;
}

function findTemplateAnchors(images) {
  // Return normalized anchors from the first sprite with valid markers.
  for (const img of images) {
    const anchors = computeFlameAnchors(img, null);
    // Check for real red markers by scanning once more quickly.
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], gch = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a > 10 && r > 200 && gch < 80 && b < 80) { count++; if (count > 10) break; }
    }
    if (count > 10) {
      return [
        { x: anchors[0].x / img.width, y: anchors[0].y / img.height },
        { x: anchors[1].x / img.width, y: anchors[1].y / img.height },
      ];
    }
  }
  return null;
}

function getFlameAnchors(model) {
  const idx = Math.max(0, Math.min(CAR_COUNT - 1, model));
  return flameAnchors[idx] || [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
}


function buildTiledMap() {
  // Tile the provided texture across the whole arena.
  const tileW = Math.max(1, Math.floor(mapTile.width * TILE_SCALE));
  const tileH = Math.max(1, Math.floor(mapTile.height * TILE_SCALE));
  const cols = OUTER_COLS;
  const rows = OUTER_ROWS;
  const c = document.createElement("canvas");
  c.width = cols * tileW;
  c.height = rows * tileH;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;

  const innerX0 = INNER_MIN_X;
  const innerY0 = INNER_MIN_Y;
  const innerX1 = INNER_MAX_X;
  const innerY1 = INNER_MAX_Y;
  const darken = "rgba(0,0,0,0.28)";

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * tileW;
      const py = y * tileH;
      g.drawImage(mapTile, px, py, tileW, tileH);
      const cx = px + tileW * 0.5;
      const cy = py + tileH * 0.5;
      const inInner = cx >= innerX0 && cx <= innerX1 && cy >= innerY0 && cy <= innerY1;
      if (!inInner) {
        g.fillStyle = darken;
        g.fillRect(px, py, tileW, tileH);
      }
    }
  }
  return c;
}

function buildFireFrames() {
  // Lightweight pixel fire overlays (sprite-style).
  const frames = [];
  const w = 24;
  const h = 24;
  const palette = ["#ffb000", "#ff7a00", "#ff3b00", "#ffd36a"];
  for (let f = 0; f < 4; f++) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 30; i++) {
      const px = Math.floor(Math.random() * w);
      const py = Math.floor(Math.random() * h);
      const size = 1 + Math.floor(Math.random() * 3);
      g.fillStyle = palette[(i + f) % palette.length];
      g.fillRect(px, py, size, size);
    }
    frames.push(c);
  }
  return frames;
}

function applyKnockback(ev) {
  const target = renderState.get(ev.target);
  const causer = renderState.get(ev.causer);
  if (!target || !causer) return;
  const dx = target.x - causer.x;
  const dy = target.y - causer.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  // Server applies positional knockback; client only freezes angle.
  target.ignoreServerTime = 0;
  target.freezeAngle = target.lastAngle || 0;
  target.freezeTime = target.knockDur;
}
