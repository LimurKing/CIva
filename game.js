"use strict";

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const loading = document.querySelector("#loading");
const fullscreenButton = document.querySelector("#fullscreen-button");
const fpsCounter = document.querySelector("#fps-counter");
const harvestButton = document.querySelector("#harvest-button");
const buildButton = document.querySelector("#build-button");
const demolishButton = document.querySelector("#demolish-button");
const builderButton = document.querySelector("#builder-button");
const buildingSelect = document.querySelector("#building-select");
const rotateWallButton = document.querySelector("#rotate-wall-button");
const mainMenu = document.querySelector("#main-menu");
const worldNameInput = document.querySelector("#world-name-input");
const seedInput = document.querySelector("#seed-input");
const newGameButton = document.querySelector("#new-game-button");
const savedWorlds = document.querySelector("#saved-worlds");
const menuStatus = document.querySelector("#menu-status");
const saveButton = document.querySelector("#save-button");
const menuButton = document.querySelector("#menu-button");
const mainHouseColorSelect = document.querySelector("#main-house-color");
const minimap = document.querySelector("#minimap");
const minimapCtx = minimap.getContext("2d");

const WORLD_WIDTH = 4800;
const WORLD_HEIGHT = 3600;
const CAMERA_ZOOM = 1.3;
const CHUNK_SIZE = 256;
const MINIMAP_COLS = Math.ceil(WORLD_WIDTH / 64);
const MINIMAP_ROWS = Math.ceil(WORLD_HEIGHT / 64);
const CHUNK_RENDER_MARGIN = 180;
const LAND_MARGIN = 170;
const LAND_SAFE_MARGIN = LAND_MARGIN + 80;
const START_HOME = { x: 400, y: 400 };
const TILE_SIZE = 96;
const PLAYER_SIZE = 58;
const WORKER_SIZE = 48;
const TREE_SIZE = { width: 104, height: 139 };
const HOME_SIZE = { width: 92, height: 138 };
const WALL_LENGTH = 64;
const BUILDING_TYPES = {
  house: { name: "Дом", wood: 10, stone: 0 },
  tower: { name: "Башня", wood: 18, stone: 5 },
  barracks: { name: "Казарма", wood: 24, stone: 8 },
  archery: { name: "Стрельбище", wood: 20, stone: 5 },
  wall: { name: "Стена", wood: 4, stone: 0 },
};
const BUILDING_LIMITS = { house: 3, tower: 4, archery: 2 };
const BUILDER_COST = 5;
const WORK_RADIUS = 600;
const PLAYER_SPEED = 240;
const WORKER_SPEED = 105;
const RAIDER_SPEED = 90;
const CHOP_DISTANCE = 75;
const CHOP_TIME = 2.5;
const STONE_MINE_TIME = 1.25;
const HARVEST_DISTANCE = 105;
const DEFENSE_RADIUS = 390;
const ARCHER_RANGE = 245;
const ENEMY_AGGRO_RADIUS = 250;
const ENEMY_LEASH_RADIUS = 520;

let viewWidth = window.innerWidth;
let viewHeight = window.innerHeight;
let camera = { x: 0, y: 0 };
let lastTime = 0;
let playerAnimTime = 0;
let placingHouse = false;
let demolishMode = false;
let selectedBuilding = "house";
let wallOrientation = "horizontal";
let gameStarted = false;
let currentSeed = "";
let currentSaveName = "";
let currentSaveId = "";
let mainHouseColor = "yellow";
let mainSettlement = null;
let randomState = 1;
let autosaveTime = 0;
let fpsFrames = 0;
let fpsSampleStart = 0;

const player = { x: 400, y: 500, target: null, harvesting: null, harvestTime: 0, hp: 100, maxHp: 100, respawnTime: 0 };
let woodCount = 0;
let stoneCount = 0;
let goldCount = 0;
let markerTime = 0;
let trees = [];
let stoneNodes = [];
let stumps = [];
let workers = [];
let builders = [];
let settlements = [];
let structures = [];
let walls = [];
let enemySettlements = [];
let decorations = [];
let defenders = [];
let raiders = [];
let effects = [];
let resourceRespawns = [];
let enemyRespawns = [];
let explored = new Uint8Array(MINIMAP_COLS * MINIMAP_ROWS);
let minimapTerrain = null;
let minimapFogCanvas = null;
let minimapFogCtx = null;
let minimapUpdateTime = 0;
let raidTimer = 55;
let raidWarningTime = 0;
let pendingRaid = null;
let raidMessageTime = 0;
const SAVE_KEY = "forest-settlement-save-v1";
const CHUNK_KINDS = ["decorations", "stumps", "trees", "stoneNodes", "settlements", "enemySettlements", "structures", "walls"];
let worldChunks = new Map();
let worldChunksDirty = true;
let terrainChunks = new Map();
const darknessCanvas = document.createElement("canvas");
const darknessCtx = darknessCanvas.getContext("2d");
let darknessCacheKey = "";
const makeSaveId = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;

function markWorldChunksDirty() {
  worldChunksDirty = true;
}

function rebuildWorldChunks() {
  worldChunks = new Map();
  const collections = {
    decorations, stumps, trees, stoneNodes, settlements, enemySettlements, structures, walls,
  };
  for (const kind of CHUNK_KINDS) {
    for (const entity of collections[kind]) {
      const column = Math.floor(entity.x / CHUNK_SIZE);
      const row = Math.floor(entity.y / CHUNK_SIZE);
      const key = `${column}:${row}`;
      if (!worldChunks.has(key)) {
        worldChunks.set(key, Object.fromEntries(CHUNK_KINDS.map((name) => [name, []])));
      }
      worldChunks.get(key)[kind].push(entity);
    }
  }
  worldChunksDirty = false;
}

function getVisibleChunkEntities() {
  if (worldChunksDirty) rebuildWorldChunks();
  const left = Math.floor((camera.x - CHUNK_RENDER_MARGIN) / CHUNK_SIZE);
  const right = Math.floor((camera.x + viewWidth / CAMERA_ZOOM + CHUNK_RENDER_MARGIN) / CHUNK_SIZE);
  const top = Math.floor((camera.y - CHUNK_RENDER_MARGIN) / CHUNK_SIZE);
  const bottom = Math.floor((camera.y + viewHeight / CAMERA_ZOOM + CHUNK_RENDER_MARGIN) / CHUNK_SIZE);
  const visible = Object.fromEntries(CHUNK_KINDS.map((kind) => [kind, []]));
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      const chunk = worldChunks.get(`${column}:${row}`);
      if (!chunk) continue;
      for (const kind of CHUNK_KINDS) visible[kind].push(...chunk[kind]);
    }
  }
  return visible;
}

function buildTerrainChunks() {
  terrainChunks = new Map();
  const columns = Math.ceil(WORLD_WIDTH / CHUNK_SIZE);
  const rows = Math.ceil(WORLD_HEIGHT / CHUNK_SIZE);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const worldX = column * CHUNK_SIZE;
      const worldY = row * CHUNK_SIZE;
      const width = Math.min(CHUNK_SIZE, WORLD_WIDTH - worldX);
      const height = Math.min(CHUNK_SIZE, WORLD_HEIGHT - worldY);
      const chunkCanvas = document.createElement("canvas");
      chunkCanvas.width = width;
      chunkCanvas.height = height;
      const chunkCtx = chunkCanvas.getContext("2d");
      chunkCtx.imageSmoothingEnabled = false;
      chunkCtx.fillStyle = "#55aaa7";
      chunkCtx.fillRect(0, 0, width, height);

      for (let y = Math.floor(worldY / 64) * 64; y < worldY + height; y += 64) {
        for (let x = Math.floor(worldX / 64) * 64; x < worldX + width; x += 64) {
          chunkCtx.drawImage(art.water, x - worldX, y - worldY, 64, 64);
        }
      }
      chunkCtx.strokeStyle = "rgba(218,250,232,0.24)";
      chunkCtx.lineWidth = 2;
      for (let y = Math.floor(worldY / 128) * 128 + 32; y < worldY + height + 64; y += 128) {
        for (let x = Math.floor(worldX / 128) * 128 + 30; x < worldX + width + 64; x += 128) {
          const phase = Math.sin(x * 0.017 + y * 0.023);
          chunkCtx.beginPath();
          chunkCtx.moveTo(x - worldX, y - worldY);
          chunkCtx.quadraticCurveTo(x + 12 - worldX, y + phase * 5 - worldY, x + 25 - worldX, y - worldY);
          chunkCtx.stroke();
        }
      }

      chunkCtx.save();
      chunkCtx.beginPath();
      coastline.forEach((point, index) => {
        const x = point.x - worldX;
        const y = point.y - worldY;
        if (index === 0) chunkCtx.moveTo(x, y);
        else chunkCtx.lineTo(x, y);
      });
      chunkCtx.closePath();
      chunkCtx.clip();
      for (let y = Math.floor(worldY / TILE_SIZE) * TILE_SIZE; y < worldY + height + TILE_SIZE; y += TILE_SIZE) {
        for (let x = Math.floor(worldX / TILE_SIZE) * TILE_SIZE; x < worldX + width + TILE_SIZE; x += TILE_SIZE) {
          chunkCtx.drawImage(art.ground, 64, 64, 64, 64, x - worldX, y - worldY, TILE_SIZE, TILE_SIZE);
        }
      }
      chunkCtx.restore();

      chunkCtx.save();
      chunkCtx.lineJoin = "round";
      chunkCtx.beginPath();
      coastline.forEach((point, index) => {
        const x = point.x - worldX;
        const y = point.y - worldY;
        if (index === 0) chunkCtx.moveTo(x, y);
        else chunkCtx.lineTo(x, y);
      });
      chunkCtx.closePath();
      chunkCtx.strokeStyle = "rgba(205,186,122,0.9)";
      chunkCtx.lineWidth = 22;
      chunkCtx.stroke();
      chunkCtx.beginPath();
      coastline.forEach((point, index) => {
        const x = point.x - worldX;
        const y = point.y - worldY;
        if (index === 0) chunkCtx.moveTo(x, y);
        else chunkCtx.lineTo(x, y);
      });
      chunkCtx.closePath();
      chunkCtx.strokeStyle = "rgba(239,230,177,0.9)";
      chunkCtx.lineWidth = 5;
      chunkCtx.stroke();
      chunkCtx.restore();
      terrainChunks.set(`${column}:${row}`, chunkCanvas);
    }
  }
}

function isInsideCamera(entity, margin = 140) {
  return entity.x >= camera.x - margin && entity.x <= camera.x + viewWidth / CAMERA_ZOOM + margin
    && entity.y >= camera.y - margin && entity.y <= camera.y + viewHeight / CAMERA_ZOOM + margin;
}

function drawNightOverlay() {
  const width = canvas.width;
  const height = canvas.height;
  const lightX = Math.round((player.x - camera.x) * CAMERA_ZOOM);
  const lightY = Math.round((player.y - camera.y) * CAMERA_ZOOM);
  const key = `${width}:${height}:${lightX}:${lightY}`;
  if (darknessCacheKey !== key) {
    darknessCanvas.width = width;
    darknessCanvas.height = height;
    darknessCtx.globalCompositeOperation = "source-over";
    darknessCtx.fillStyle = "rgba(5, 11, 24, 0.68)";
    darknessCtx.fillRect(0, 0, width, height);
    darknessCtx.globalCompositeOperation = "destination-out";
    const radius = Math.min(width, height) * 0.48;
    const light = darknessCtx.createRadialGradient(lightX, lightY, 34, lightX, lightY, radius);
    light.addColorStop(0, "rgba(0, 0, 0, 1)");
    light.addColorStop(0.38, "rgba(0, 0, 0, 0.92)");
    light.addColorStop(0.76, "rgba(0, 0, 0, 0.42)");
    light.addColorStop(1, "rgba(0, 0, 0, 0)");
    darknessCtx.fillStyle = light;
    darknessCtx.fillRect(0, 0, width, height);
    darknessCtx.globalCompositeOperation = "source-over";
    darknessCacheKey = key;
  }
  ctx.drawImage(darknessCanvas, 0, 0);
}

function readSavedGames() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((entry) => entry?.id && entry?.game);
    // Migrate the original single-save format to the world list.
    if (parsed?.version === 1) {
      const legacy = { id: makeSaveId(), name: parsed.seed || "Мой мир", updatedAt: Date.now(), game: parsed };
      localStorage.setItem(SAVE_KEY, JSON.stringify([legacy]));
      return [legacy];
    }
  } catch (error) {
    console.warn("Не удалось прочитать сохранения:", error);
  }
  return [];
}

function writeSavedGames(games) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(games));
}

function renderSavedGames() {
  const games = readSavedGames().sort((a, b) => b.updatedAt - a.updatedAt);
  savedWorlds.replaceChildren();
  if (!games.length) {
    const empty = document.createElement("p");
    empty.className = "empty-saves";
    empty.textContent = "Пока нет сохранений";
    savedWorlds.append(empty);
    return;
  }
  for (const entry of games) {
    const row = document.createElement("div");
    row.className = "saved-world";
    const details = document.createElement("div");
    details.className = "saved-world-details";
    const title = document.createElement("strong");
    title.textContent = entry.name || entry.game.seed || "Мой мир";
    const meta = document.createElement("span");
    meta.textContent = `Seed: ${entry.game.seed || "—"} · ${new Date(entry.updatedAt).toLocaleString()}`;
    details.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "saved-world-actions";
    const load = document.createElement("button");
    load.type = "button";
    load.textContent = "Играть";
    load.addEventListener("click", () => loadSavedGame(entry.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-save";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Удалить сохранение ${title.textContent}`);
    remove.addEventListener("click", () => deleteSavedGame(entry.id));
    actions.append(load, remove);
    row.append(details, actions);
    savedWorlds.append(row);
  }
}

function deleteSavedGame(id) {
  writeSavedGames(readSavedGames().filter((entry) => entry.id !== id));
  if (currentSaveId === id) currentSaveId = "";
  renderSavedGames();
}

function setRandomSeed(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  randomState = hash >>> 0 || 1;
}

function random() {
  randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
  return randomState / 4294967296;
}

function makeCoastline() {
  const points = [];
  const step = 100;
  for (let x = LAND_MARGIN; x <= WORLD_WIDTH - LAND_MARGIN; x += step) {
    points.push({ x, y: LAND_MARGIN + Math.sin(x * 0.008) * 24 + Math.sin(x * 0.021) * 11 });
  }
  for (let y = LAND_MARGIN; y <= WORLD_HEIGHT - LAND_MARGIN; y += step) {
    points.push({ x: WORLD_WIDTH - LAND_MARGIN + Math.sin(y * 0.009) * 22, y });
  }
  for (let x = WORLD_WIDTH - LAND_MARGIN; x >= LAND_MARGIN; x -= step) {
    points.push({ x, y: WORLD_HEIGHT - LAND_MARGIN + Math.sin(x * 0.007) * 23 + Math.cos(x * 0.019) * 12 });
  }
  for (let y = WORLD_HEIGHT - LAND_MARGIN; y >= LAND_MARGIN; y -= step) {
    points.push({ x: LAND_MARGIN + Math.cos(y * 0.008) * 22, y });
  }
  return points;
}

const coastline = makeCoastline();

function isLandPoint(point) {
  let inside = false;
  for (let i = 0, j = coastline.length - 1; i < coastline.length; j = i++) {
    const a = coastline[i];
    const b = coastline[j];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function buildMinimapTerrain() {
  minimapTerrain = document.createElement("canvas");
  minimapTerrain.width = MINIMAP_COLS;
  minimapTerrain.height = MINIMAP_ROWS;
  const terrainCtx = minimapTerrain.getContext("2d");
  for (let row = 0; row < MINIMAP_ROWS; row += 1) {
    for (let column = 0; column < MINIMAP_COLS; column += 1) {
      terrainCtx.fillStyle = isLandPoint({ x: column * 64 + 32, y: row * 64 + 32 }) ? "#58834d" : "#347d91";
      terrainCtx.fillRect(column, row, 1, 1);
    }
  }
  terrainCtx.imageSmoothingEnabled = false;
  minimapFogCanvas = document.createElement("canvas");
  minimapFogCanvas.width = MINIMAP_COLS;
  minimapFogCanvas.height = MINIMAP_ROWS;
  minimapFogCtx = minimapFogCanvas.getContext("2d");
  resetMinimapFog();
}

function resetMinimapFog() {
  if (!minimapFogCtx) return;
  minimapFogCtx.clearRect(0, 0, MINIMAP_COLS, MINIMAP_ROWS);
  minimapFogCtx.fillStyle = "rgba(3, 8, 14, 0.88)";
  minimapFogCtx.fillRect(0, 0, MINIMAP_COLS, MINIMAP_ROWS);
}

function revealMapAround(point, radius = 360) {
  const minCol = Math.max(0, Math.floor((point.x - radius) / 64));
  const maxCol = Math.min(MINIMAP_COLS - 1, Math.floor((point.x + radius) / 64));
  const minRow = Math.max(0, Math.floor((point.y - radius) / 64));
  const maxRow = Math.min(MINIMAP_ROWS - 1, Math.floor((point.y + radius) / 64));
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minCol; column <= maxCol; column += 1) {
      const dx = column * 64 + 32 - point.x;
      const dy = row * 64 + 32 - point.y;
      const index = row * MINIMAP_COLS + column;
      if (!explored[index] && dx * dx + dy * dy <= radius * radius) {
        explored[index] = 1;
        minimapFogCtx?.clearRect(column, row, 1, 1);
      }
    }
  }
}

function resizeCanvas() {
  viewWidth = Math.max(320, window.innerWidth);
  viewHeight = Math.max(240, window.innerHeight);
  canvas.width = viewWidth;
  canvas.height = viewHeight;
  ctx.imageSmoothingEnabled = false;
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function loadImage(path) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Не удалось загрузить файл «${path}»`));
    image.src = encodeURI(path);
  });
}

async function loadSheet(path, frameWidth = 192, frameHeight = 192, size = WORKER_SIZE) {
  const image = await loadImage(path);
  const frames = [];
  for (let sx = 0; sx + frameWidth <= image.width; sx += frameWidth) {
    frames.push({ image, sx, sy: 0, sw: frameWidth, sh: frameHeight, width: size, height: size });
  }
  return frames;
}

function asset(...parts) {
  return ["Assets", ...parts].join("/");
}

async function loadAssets() {
  const paths = {
    ground: asset("Terrain", "Tileset", "Tilemap_color1.png"),
    water: asset("Terrain", "Tileset", "Water Background color.png"),
    enemyHome: asset("Buildings", "Red Buildings", "House1.png"),
    woodIcon: asset("Terrain", "Resources", "Wood", "Wood Resource", "Wood Resource.png"),
    playerIdle: asset("Units", "Blue Units", "Pawn", "Pawn_Idle Axe.png"),
    playerRun: asset("Units", "Blue Units", "Pawn", "Pawn_Run Axe.png"),
    playerChop: asset("Units", "Blue Units", "Pawn", "Pawn_Interact Axe.png"),
    workerIdle: asset("Units", "Yellow Units", "Pawn", "Pawn_Idle Axe.png"),
    workerRun: asset("Units", "Yellow Units", "Pawn", "Pawn_Run Axe.png"),
    workerChop: asset("Units", "Yellow Units", "Pawn", "Pawn_Interact Axe.png"),
    warriorIdle: asset("Units", "Yellow Units", "Warrior", "Warrior_Idle.png"),
    warriorRun: asset("Units", "Yellow Units", "Warrior", "Warrior_Run.png"),
    warriorAttack: asset("Units", "Yellow Units", "Warrior", "Warrior_Attack1.png"),
    archerIdle: asset("Units", "Yellow Units", "Archer", "Archer_Idle.png"),
    archerRun: asset("Units", "Yellow Units", "Archer", "Archer_Run.png"),
    archerAttack: asset("Units", "Yellow Units", "Archer", "Archer_Shoot.png"),
    raiderIdle: asset("Units", "Red Units", "Warrior", "Warrior_Idle.png"),
    raiderRun: asset("Units", "Red Units", "Warrior", "Warrior_Run.png"),
    raiderAttack: asset("Units", "Red Units", "Warrior", "Warrior_Attack1.png"),
    raiderArcherIdle: asset("Units", "Red Units", "Archer", "Archer_Idle.png"),
    raiderArcherRun: asset("Units", "Red Units", "Archer", "Archer_Run.png"),
    raiderArcherAttack: asset("Units", "Red Units", "Archer", "Archer_Shoot.png"),
  };

  const loaded = {};
  await Promise.all(Object.entries(paths).map(async ([key, path]) => {
    loaded[key] = await loadImage(path);
  }));
  loaded.buildingVariants = {};
  await Promise.all(["Yellow", "Blue", "Purple"].map(async (color) => {
    const folder = `${color} Buildings`;
    const [home, tower, barracks, archery] = await Promise.all([
      loadImage(asset("Buildings", folder, "House1.png")),
      loadImage(asset("Buildings", folder, "Tower.png")),
      loadImage(asset("Buildings", folder, "Barracks.png")),
      loadImage(asset("Buildings", folder, "Archery.png")),
    ]);
    loaded.buildingVariants[color.toLowerCase()] = { home, tower, barracks, archery };
  }));
  Object.assign(loaded, loaded.buildingVariants.yellow);
  const frameJobs = [
    ["playerIdle", PLAYER_SIZE], ["playerRun", PLAYER_SIZE], ["playerChop", PLAYER_SIZE],
    ["workerIdle", WORKER_SIZE], ["workerRun", WORKER_SIZE], ["workerChop", WORKER_SIZE],
    ["warriorIdle", WORKER_SIZE], ["warriorRun", WORKER_SIZE], ["warriorAttack", WORKER_SIZE],
    ["archerIdle", WORKER_SIZE], ["archerRun", WORKER_SIZE], ["archerAttack", WORKER_SIZE],
    ["raiderIdle", WORKER_SIZE], ["raiderRun", WORKER_SIZE], ["raiderAttack", WORKER_SIZE],
    ["raiderArcherIdle", WORKER_SIZE], ["raiderArcherRun", WORKER_SIZE], ["raiderArcherAttack", WORKER_SIZE],
  ];
  for (const [key, size] of frameJobs) {
    const image = loaded[key];
    loaded[key] = [];
    for (let sx = 0; sx + 192 <= image.width; sx += 192) {
      loaded[key].push({ image, sx, sy: 0, sw: 192, sh: 192, width: size, height: size });
    }
  }

  loaded.treeTypes = [];
  for (const [name, frameHeight] of [["Tree1.png", 256], ["Tree2.png", 256], ["Tree3.png", 192], ["Tree4.png", 192]]) {
    const image = await loadImage(asset("Terrain", "Resources", "Wood", "Trees", name));
    const frames = [];
    for (let sx = 0; sx + 192 <= image.width; sx += 192) {
      frames.push({ image, sx, sy: 0, sw: 192, sh: frameHeight, width: TREE_SIZE.width, height: TREE_SIZE.height });
    }
    loaded.treeTypes.push(frames);
  }
  loaded.stumps = await Promise.all([1, 2, 3, 4].map(async (n) => ({
    image: await loadImage(asset("Terrain", "Resources", "Wood", "Trees", `Stump ${n}.png`)),
  })));
  loaded.rocks = await Promise.all([1, 2, 3, 4].map((n) =>
    loadImage(asset("Terrain", "Decorations", "Rocks", `Rock${n}.png`))));
  loaded.goldIcon = await loadImage(asset("Terrain", "Resources", "Gold", "Gold Resource", "Gold_Resource.png"));
  loaded.bushes = await Promise.all([1, 2, 3, 4].map(async (n) => {
    const image = await loadImage(asset("Terrain", "Decorations", "Bushes", `Bushe${n}.png`));
    const frames = [];
    for (let sx = 0; sx + 128 <= image.width; sx += 128) {
      frames.push({ image, sx, sy: 0, sw: 128, sh: 128, width: 52, height: 52 });
    }
    return frames;
  }));
  return loaded;
}

let art;

function setMainHouseColor(color) {
  const normalized = ["yellow", "blue", "purple"].includes(color) ? color : "yellow";
  mainHouseColor = normalized;
  if (art?.buildingVariants?.[normalized]) Object.assign(art, art.buildingVariants[normalized]);
  if (mainHouseColorSelect) mainHouseColorSelect.value = normalized;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function moveToward(entity, point, speed, dt, stoppingDistance = 0) {
  const dx = point.x - entity.x;
  const dy = point.y - entity.y;
  const d = Math.hypot(dx, dy);
  const remaining = d - stoppingDistance;
  if (remaining <= 0 || d === 0) return false;
  entity.facing = Math.abs(dx) >= Math.abs(dy)
    ? (dx < 0 ? "left" : "right")
    : (dy < 0 ? "up" : "down");
  const step = speed * dt;
  const amount = remaining <= step + 0.5 ? remaining : step;
  let nextX = entity.x + (dx / d) * amount;
  let nextY = entity.y + (dy / d) * amount;
  if (entity.hostile && isWallBlocked(entity.x, entity.y, nextX, nextY)) return false;
  if (remaining <= step + 0.5) {
    entity.x = nextX;
    entity.y = nextY;
  } else {
    entity.x = nextX;
    entity.y = nextY;
  }
  return true;
}

function isWallBlocked(fromX, fromY, toX, toY) {
  const inside = (x, y, bounds) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  for (const wall of walls) {
    const bounds = wall.orientation === "vertical"
      ? { left: wall.x - 14, right: wall.x + 14, top: wall.y - WALL_LENGTH / 2 - 8, bottom: wall.y + WALL_LENGTH / 2 + 8 }
      : { left: wall.x - WALL_LENGTH / 2 - 8, right: wall.x + WALL_LENGTH / 2 + 8, top: wall.y - 32, bottom: wall.y - 4 };
    if (!inside(fromX, fromY, bounds) && inside(toX, toY, bounds)) return true;
  }
  return false;
}

function generateForest(count = 300) {
  const result = [];
  const base = START_HOME;
  let attempts = 0;
  while (result.length < count && attempts < count * 200) {
    attempts += 1;
    const p = {
      x: LAND_SAFE_MARGIN + random() * (WORLD_WIDTH - 2 * LAND_SAFE_MARGIN),
      y: LAND_SAFE_MARGIN + random() * (WORLD_HEIGHT - 2 * LAND_SAFE_MARGIN),
      frames: art.treeTypes[Math.floor(random() * art.treeTypes.length)],
    };
    if (!isLandPoint(p) || distance(p, base) < 280) continue;
    if (result.every((tree) => distance(p, tree) >= 105)) result.push(p);
  }
  return result;
}

function generateStoneNodes(count = 120) {
  const result = [];
  let attempts = 0;
  while (result.length < count && attempts < count * 150) {
    attempts += 1;
    const node = {
      x: LAND_SAFE_MARGIN + random() * (WORLD_WIDTH - 2 * LAND_SAFE_MARGIN),
      y: LAND_SAFE_MARGIN + random() * (WORLD_HEIGHT - 2 * LAND_SAFE_MARGIN),
      image: art.rocks[Math.floor(random() * art.rocks.length)],
      size: 46 + random() * 20,
    };
    if (!isLandPoint(node)) continue;
    if (trees.some((tree) => distance(node, tree) < 100)) continue;
    if ([...settlements, ...enemySettlements].some((house) => distance(node, house) < 170)) continue;
    if (result.some((other) => distance(node, other) < 115)) continue;
    result.push(node);
  }
  return result;
}

function makeWorker(position, home) {
  return { x: position.x, y: position.y, home, tree: null, stone: null, chopTime: 0, animTime: random(), moving: false, facing: "down", hp: 65, maxHp: 65 };
}

function makeBuilder(position) {
  return { x: position.x, y: position.y, target: null, animTime: random(), moving: false,
    facing: "down", hp: 75, maxHp: 75, repairing: false };
}

function repairableBuildings() {
  return [...settlements, ...structures, ...walls].filter((building) => building.hp > 0 && building.hp < building.maxHp);
}

function updateBuilders(dt) {
  const damaged = repairableBuildings();
  for (const builder of builders) {
    builder.animTime += dt;
    builder.moving = false;
    builder.repairing = false;
    if (!builder.target || !damaged.includes(builder.target)) {
      builder.target = damaged.length
        ? damaged.reduce((best, building) => distance(builder, building) < distance(builder, best) ? building : best)
        : null;
    }
    if (!builder.target) continue;
    if (distance(builder, builder.target) > 68) {
      builder.moving = moveToward(builder, builder.target, 115, dt, 56);
    } else {
      builder.repairing = true;
      builder.target.hp = Math.min(builder.target.maxHp, builder.target.hp + 24 * dt);
    }
  }
  builders = builders.filter((builder) => builder.hp > 0);
}

function makeSettlement(x, y) {
  return { x, y, hp: 500, maxHp: 500 };
}

function addSettlement(x, y) {
  const house = makeSettlement(x, y);
  settlements.push(house);
  if (!mainSettlement) mainSettlement = house;
  workers.push(makeWorker({ x: x - 24, y: y + 24 }, house));
  workers.push(makeWorker({ x: x + 24, y: y + 24 }, house));
  defenders.push(makeDefender(house, "warrior", -36, 30));
  defenders.push(makeDefender(house, "archer", 36, 30));
  markWorldChunksDirty();
  return house;
}

function makeDefender(house, role, ox, oy) {
  return {
    x: house.x + ox, y: house.y + oy, house, role, hp: 100, maxHp: 100,
    cooldown: random() * 0.7, flash: 0, animTime: random(), moving: false, facing: "down",
  };
}

function spawnEnemyGuards(house, count = 12, startIndex = 0) {
  const guards = [
    ["warrior", -62, -8], ["warrior", -42, 36], ["warrior", -16, 66], ["warrior", 20, 66],
    ["warrior", 50, 38], ["warrior", 66, 2], ["warrior", 36, -38], ["warrior", -32, -46],
    ["archer", -68, -58], ["archer", 68, -52], ["archer", 0, 90], ["archer", 0, -92],
  ];
  for (const [role, ox, oy] of guards.slice(startIndex, startIndex + count)) {
    const maxHp = role === "warrior" ? 160 : 120;
    raiders.push({ x: house.x + ox, y: house.y + oy, home: house, role, hp: maxHp, maxHp,
      cooldown: random() * 0.8, flash: 0, animTime: random(), moving: false, facing: "down", target: null,
      raidTarget: null, raidTime: 0, hostile: true });
}
}

function generateEnemySettlements(count = 6) {
  let attempts = 0;
  while (enemySettlements.length < count && attempts < count * 300) {
    attempts += 1;
    const house = {
      x: LAND_SAFE_MARGIN + 100 + random() * (WORLD_WIDTH - 2 * (LAND_SAFE_MARGIN + 100)),
      y: LAND_SAFE_MARGIN + 100 + random() * (WORLD_HEIGHT - 2 * (LAND_SAFE_MARGIN + 100)),
      hp: 700,
      maxHp: 700,
    };
    if (!isLandPoint(house)) continue;
    if (settlements.some((friendly) => distance(house, friendly) < 760)) continue;
    if (enemySettlements.some((other) => distance(house, other) < 700)) continue;
    enemySettlements.push(house);
  }

  for (const house of enemySettlements) {
    spawnEnemyGuards(house);
  }
}

function generateDecorations(count = 500) {
  let attempts = 0;
  while (decorations.length < count && attempts < count * 80) {
    attempts += 1;
    const point = {
      x: LAND_SAFE_MARGIN + random() * (WORLD_WIDTH - 2 * LAND_SAFE_MARGIN),
      y: LAND_SAFE_MARGIN + random() * (WORLD_HEIGHT - 2 * LAND_SAFE_MARGIN),
    };
    if (!isLandPoint(point)) continue;
    if (trees.some((tree) => distance(point, tree) < 115)) continue;
    if (stoneNodes.some((node) => distance(point, node) < 90)) continue;
    if ([...settlements, ...enemySettlements].some((house) => distance(point, house) < 150)) continue;

    if (random() < 0.58) {
      decorations.push({
        ...point,
        kind: "bush",
        frames: art.bushes[Math.floor(random() * art.bushes.length)],
        phase: random() * 8,
      });
    } else {
      decorations.push({
        ...point,
        kind: "rock",
        image: art.rocks[Math.floor(random() * art.rocks.length)],
        size: 30 + random() * 22,
      });
    }
  }
}

function restoreDepletedResources(dt) {
  for (const entry of resourceRespawns) entry.time -= dt;
  const ready = resourceRespawns.filter((entry) => entry.time <= 0);
  resourceRespawns = resourceRespawns.filter((entry) => entry.time > 0);
  for (const entry of ready) {
    const blocked = [...settlements, ...enemySettlements, ...structures].some((building) => distance(entry, building) < 100)
      || trees.some((tree) => distance(entry, tree) < 80)
      || stoneNodes.some((node) => distance(entry, node) < 60);
    if (blocked) {
      entry.time = 8;
      resourceRespawns.push(entry);
    } else if (entry.kind === "tree") {
      trees.push({ x: entry.x, y: entry.y, frames: entry.frames });
      markWorldChunksDirty();
    } else {
      stoneNodes.push({ x: entry.x, y: entry.y, image: entry.image, size: entry.size });
      markWorldChunksDirty();
    }
  }
}

function restoreDestroyedEnemySettlements(dt) {
  for (const entry of enemyRespawns) entry.time -= dt;
  const ready = enemyRespawns.filter((entry) => entry.time <= 0);
  enemyRespawns = enemyRespawns.filter((entry) => entry.time > 0);
  for (const entry of ready) {
    const blocked = [...settlements, ...enemySettlements, ...structures].some((building) => distance(entry, building) < 280);
    if (blocked) {
      entry.time = 12;
      enemyRespawns.push(entry);
      continue;
    }
    const house = { x: entry.x, y: entry.y, hp: 700, maxHp: 700 };
    enemySettlements.push(house);
    spawnEnemyGuards(house);
    markWorldChunksDirty();
  }
}

function updateRaids(dt) {
  raidMessageTime = Math.max(0, raidMessageTime - dt);
  if (raidWarningTime > 0) {
    raidWarningTime -= dt;
    if (raidWarningTime <= 0 && pendingRaid) {
      for (const raider of raiders) {
        if (raider.home === pendingRaid.home && raider.hp > 0) {
          raider.raidTarget = pendingRaid.target;
          raider.raidTime = 30;
          raider.target = null;
        }
      }
      raidMessageTime = 5;
      pendingRaid = null;
    }
    return;
  }
  raidTimer -= dt;
  if (raidTimer > 0 || !settlements.length) return;
  const candidates = enemySettlements.filter((home) => raiders.some((raider) => raider.home === home && raider.hp > 0));
  if (!candidates.length) {
    raidTimer = 20;
    return;
  }
  const home = candidates.reduce((best, item) => {
    const itemDistance = Math.min(...settlements.map((settlement) => distance(item, settlement)));
    const bestDistance = Math.min(...settlements.map((settlement) => distance(best, settlement)));
    return itemDistance < bestDistance ? item : best;
  });
  const target = settlements.includes(mainSettlement)
    ? mainSettlement
    : settlements.reduce((best, item) => distance(home, item) < distance(home, best) ? item : best);
  pendingRaid = { home, target };
  raidWarningTime = 5;
  raidMessageTime = 5;
  raidTimer = 60 + random() * 30;
}

function setupWorld(seed) {
  placingHouse = false;
  demolishMode = false;
  demolishButton.setAttribute("aria-pressed", "false");
  demolishButton.textContent = "Снос: выкл.";
  currentSeed = String(seed);
  setRandomSeed(currentSeed);
  woodCount = 0;
  stoneCount = 0;
  goldCount = 0;
  stumps = [];
  resourceRespawns = [];
  enemyRespawns = [];
  explored = new Uint8Array(MINIMAP_COLS * MINIMAP_ROWS);
  resetMinimapFog();
  minimapUpdateTime = 0;
  raidTimer = 45 + random() * 25;
  raidWarningTime = 0;
  raidMessageTime = 0;
  pendingRaid = null;
  stoneNodes = [];
  workers = [];
  builders = [];
  settlements = [];
  mainSettlement = null;
  structures = [];
  walls = [];
  enemySettlements = [];
  defenders = [];
  raiders = [];
  effects = [];
  decorations = [];
  player.x = START_HOME.x;
  player.y = START_HOME.y + 100;
  player.hp = player.maxHp;
  player.respawnTime = 0;
  player.target = null;
  player.harvesting = null;
  player.harvestTime = 0;
  revealMapAround({ x: START_HOME.x, y: START_HOME.y }, 460);
  playerAnimTime = 0;

  addSettlement(START_HOME.x, START_HOME.y);
  trees = generateForest();
  generateEnemySettlements();
  stoneNodes = generateStoneNodes();
  generateDecorations();
  markWorldChunksDirty();
  const worldViewWidth = viewWidth / CAMERA_ZOOM;
  const worldViewHeight = viewHeight / CAMERA_ZOOM;
  camera.x = Math.max(0, Math.min(player.x - worldViewWidth / 2, WORLD_WIDTH - worldViewWidth));
  camera.y = Math.max(0, Math.min(player.y - worldViewHeight / 2, WORLD_HEIGHT - worldViewHeight));
}

function serializeGame() {
  const treeType = (tree) => Math.max(0, art.treeTypes.indexOf(tree.frames));
  return {
    version: 1,
    seed: currentSeed,
    enemyGarrisonSize: 12,
    mainHouseColor,
    mainSettlement: settlements.indexOf(mainSettlement),
    woodCount,
    stoneCount,
    goldCount,
    player: { x: player.x, y: player.y, hp: player.hp },
    settlements: settlements.map((house) => ({ x: house.x, y: house.y, hp: house.hp })),
    structures: structures.map((building) => ({
      x: building.x, y: building.y, type: building.type, hp: building.hp,
    })),
    walls: walls.map((wall) => ({ x: wall.x, y: wall.y, orientation: wall.orientation, hp: wall.hp })),
    enemySettlements: enemySettlements.map((house) => ({ x: house.x, y: house.y, hp: house.hp })),
    trees: trees.map((tree) => ({ x: tree.x, y: tree.y, type: treeType(tree) })),
    stoneNodes: stoneNodes.map((node) => ({
      x: node.x, y: node.y, size: node.size, type: Math.max(0, art.rocks.indexOf(node.image)),
    })),
    stumps: stumps.map((stump) => ({ x: stump.x, y: stump.y, type: Math.max(0, art.stumps.indexOf(stump.art)) })),
    decorations: decorations.map((item) => ({
      x: item.x, y: item.y, kind: item.kind, phase: item.phase, size: item.size,
      type: item.kind === "bush" ? art.bushes.indexOf(item.frames) : art.rocks.indexOf(item.image),
    })),
    workers: workers.map((worker) => ({ x: worker.x, y: worker.y, hp: worker.hp, home: settlements.indexOf(worker.home) })),
    builders: builders.map((builder) => ({ x: builder.x, y: builder.y, hp: builder.hp })),
    defenders: defenders.map((guard) => ({ x: guard.x, y: guard.y, hp: guard.hp, role: guard.role, home: settlements.indexOf(guard.house) })),
    raiders: raiders.map((raider) => ({ x: raider.x, y: raider.y, hp: raider.hp, role: raider.role, home: enemySettlements.indexOf(raider.home) })),
    resourceRespawns: resourceRespawns.map((item) => ({ ...item, frames: item.kind === "tree" ? Math.max(0, art.treeTypes.indexOf(item.frames)) : undefined,
      image: item.kind === "stone" ? Math.max(0, art.rocks.indexOf(item.image)) : undefined })),
    enemyRespawns: enemyRespawns.map(({ x, y, time }) => ({ x, y, time })),
    explored: Array.from(explored),
  };
}

function saveGame(showStatus = true) {
  if (!gameStarted || !currentSeed) return false;
  try {
    const games = readSavedGames();
    const game = serializeGame();
    if (!currentSaveId) currentSaveId = makeSaveId();
    const existing = games.find((entry) => entry.id === currentSaveId);
    const entry = { id: currentSaveId, name: currentSaveName || existing?.name || currentSeed, updatedAt: Date.now(), game };
    writeSavedGames(existing
      ? games.map((item) => item.id === currentSaveId ? entry : item)
      : [...games, entry]);
    if (showStatus) menuStatus.textContent = `Сохранено · seed: ${currentSeed}`;
    return true;
  } catch (error) {
    if (showStatus) menuStatus.textContent = "Не удалось сохранить в этом браузере.";
    console.warn("Не удалось сохранить игру:", error);
    return false;
  }
}

function restoreGame(save) {
  if (!save || save.version !== 1 || !Array.isArray(save.settlements)) return false;
  setMainHouseColor(save.mainHouseColor || "yellow");
  currentSeed = String(save.seed || "restored-map");
  setRandomSeed(currentSeed);
  woodCount = Math.max(0, Number(save.woodCount) || 0);
  stoneCount = Math.max(0, Number(save.stoneCount) || 0);
  goldCount = Math.max(0, Number(save.goldCount) || 0);
  settlements = save.settlements.map((item) => ({ x: item.x, y: item.y, hp: item.hp, maxHp: 500 }));
  mainSettlement = settlements[save.mainSettlement ?? 0] || settlements[0] || null;
  structures = (save.structures || []).map((item) => ({
    x: item.x, y: item.y, type: BUILDING_TYPES[item.type] ? item.type : "tower",
    hp: item.hp ?? 450, maxHp: item.type === "barracks" ? 650 : 450, cooldown: 8,
  }));
  walls = (save.walls || []).map((item) => ({
    x: item.x, y: item.y, orientation: item.orientation === "vertical" ? "vertical" : "horizontal",
    hp: item.hp ?? 160, maxHp: 160,
  }));
  enemySettlements = (save.enemySettlements || []).map((item) => ({ x: item.x, y: item.y, hp: item.hp, maxHp: 700 }));
  trees = (save.trees || []).map((item) => ({
    x: item.x, y: item.y, frames: art.treeTypes[item.type] || art.treeTypes[0],
  }));
  stoneNodes = Array.isArray(save.stoneNodes) ? save.stoneNodes.map((item) => ({
    x: item.x, y: item.y, size: item.size || 56, image: art.rocks[item.type] || art.rocks[0],
  })) : generateStoneNodes();
  stumps = (save.stumps || []).map((item) => ({
    x: item.x, y: item.y, art: art.stumps[item.type] || art.stumps[0],
  }));
  decorations = (save.decorations || []).map((item) => item.kind === "bush"
    ? { ...item, frames: art.bushes[item.type] || art.bushes[0] }
    : { ...item, image: art.rocks[item.type] || art.rocks[0] });
  workers = (save.workers || []).map((item) => ({
    ...makeWorker({ x: item.x, y: item.y }, settlements[item.home] || settlements[0]),
    hp: item.hp,
  })).filter((item) => item.home);
  builders = (save.builders || []).map((item) => ({
    ...makeBuilder({ x: item.x, y: item.y }), hp: item.hp ?? 75,
  }));
  defenders = (save.defenders || []).map((item) => {
    const guard = makeDefender(settlements[item.home] || settlements[0], item.role, 0, 0);
    guard.x = item.x;
    guard.y = item.y;
    guard.hp = item.hp;
    return guard;
  }).filter((guard) => guard.house);
  raiders = (save.raiders || []).map((item) => ({
    x: item.x, y: item.y, home: enemySettlements[item.home] || enemySettlements[0], role: item.role,
    hp: item.hp, maxHp: item.role === "archer" ? 120 : 160, cooldown: 0, flash: 0,
    animTime: 0, moving: false, facing: "down", target: null, raidTarget: null, raidTime: 0, hostile: true,
  })).filter((item) => item.home);
  if ((save.enemyGarrisonSize || 4) < 12) {
    for (const house of enemySettlements) {
      const existing = raiders.filter((raider) => raider.home === house).length;
      if (existing < 12) spawnEnemyGuards(house, 12 - existing, existing);
    }
  }
  raidTimer = 55;
  raidWarningTime = 0;
  raidMessageTime = 0;
  pendingRaid = null;
  resourceRespawns = (save.resourceRespawns || []).map((item) => ({
    ...item,
    frames: item.kind === "tree" ? art.treeTypes[item.frames] || art.treeTypes[0] : undefined,
    image: item.kind === "stone" ? art.rocks[item.image] || art.rocks[0] : undefined,
  }));
  enemyRespawns = save.enemyRespawns || [];
  explored = new Uint8Array(MINIMAP_COLS * MINIMAP_ROWS);
  resetMinimapFog();
  if (Array.isArray(save.explored)) explored.set(save.explored.slice(0, explored.length));
  if (Array.isArray(save.explored)) {
    for (let index = 0; index < explored.length; index += 1) {
      if (explored[index]) minimapFogCtx?.clearRect(index % MINIMAP_COLS, Math.floor(index / MINIMAP_COLS), 1, 1);
    }
  } else revealMapAround(save.player || START_HOME, 460);
  effects = [];
  player.x = save.player?.x ?? START_HOME.x;
  player.y = save.player?.y ?? START_HOME.y + 100;
  player.hp = Math.max(1, Math.min(player.maxHp, save.player?.hp ?? player.maxHp));
  player.respawnTime = 0;
  player.target = null;
  player.harvesting = null;
  player.harvestTime = 0;
  placingHouse = false;
  demolishMode = false;
  playerAnimTime = 0;
  markWorldChunksDirty();
  return true;
}

function update(dt) {
  playerAnimTime += dt;
  revealMapAround(player);
  restoreDepletedResources(dt);
  restoreDestroyedEnemySettlements(dt);
  updateRaids(dt);
  if (player.hp <= 0) {
    player.respawnTime += dt;
    player.target = null;
    if (player.respawnTime >= 3 && settlements.length) {
      const home = settlements.reduce((a, b) => distance(player, a) < distance(player, b) ? a : b);
      player.x = home.x;
      player.y = Math.min(WORLD_HEIGHT - LAND_SAFE_MARGIN, home.y + 90);
      player.hp = player.maxHp;
      player.respawnTime = 0;
    }
  }
  if (player.target) {
    const moving = moveToward(player, player.target, PLAYER_SPEED, dt);
    if (!moving) player.target = null;
    player.x = Math.max(LAND_SAFE_MARGIN, Math.min(WORLD_WIDTH - LAND_SAFE_MARGIN, player.x));
    player.y = Math.max(LAND_SAFE_MARGIN, Math.min(WORLD_HEIGHT - LAND_SAFE_MARGIN, player.y));
  }
  const worldViewWidth = viewWidth / CAMERA_ZOOM;
  const worldViewHeight = viewHeight / CAMERA_ZOOM;
  camera.x = Math.max(0, Math.min(player.x - worldViewWidth / 2, WORLD_WIDTH - worldViewWidth));
  camera.y = Math.max(0, Math.min(player.y - worldViewHeight / 2, WORLD_HEIGHT - worldViewHeight));

  if (player.harvesting) {
    player.harvestTime += dt;
    if (player.harvestTime >= 1) {
      const tree = player.harvesting;
      trees = trees.filter((item) => item !== tree);
      resourceRespawns.push({ kind: "tree", x: tree.x, y: tree.y, frames: tree.frames, time: 45 });
      stumps.push({ x: tree.x, y: tree.y, art: art.stumps[Math.floor(random() * art.stumps.length)] });
      markWorldChunksDirty();
      player.harvesting = null;
      woodCount += 1;
    }
  }

  const claimed = new Set();
  const choppingTrees = new Set();
  const miningStones = new Set();
  for (const worker of workers) {
    worker.animTime += dt;
    worker.moving = false;
    if (worker.tree && (!trees.includes(worker.tree) || worker.tree === player.harvesting)) {
      worker.tree = null;
      worker.chopTime = 0;
    }
    if (worker.stone && !stoneNodes.includes(worker.stone)) {
      worker.stone = null;
      worker.chopTime = 0;
    }
    if (!worker.tree && !worker.stone) {
      const choices = [
        ...trees.filter((tree) => tree !== player.harvesting && !claimed.has(tree) && distance(tree, worker.home) <= WORK_RADIUS)
          .map((node) => ({ node, type: "tree" })),
        ...stoneNodes.filter((node) => !claimed.has(node) && distance(node, worker.home) <= WORK_RADIUS)
          .map((node) => ({ node, type: "stone" })),
      ];
      if (choices.length) {
        const choice = choices.reduce((a, b) => distance(worker, a.node) < distance(worker, b.node) ? a : b);
        if (choice.type === "tree") worker.tree = choice.node;
        else worker.stone = choice.node;
      }
    }
    const target = worker.tree || worker.stone;
    if (!target) continue;
    claimed.add(target);
    const d = distance(worker, target);
    if (d > CHOP_DISTANCE + 0.5) {
      worker.moving = moveToward(worker, target, WORKER_SPEED, dt, CHOP_DISTANCE);
      worker.chopTime = 0;
    } else {
      worker.chopTime += dt;
      if (worker.tree) choppingTrees.add(worker.tree);
      if (worker.stone) miningStones.add(worker.stone);
      const workTime = worker.stone ? STONE_MINE_TIME : CHOP_TIME;
      if (worker.chopTime >= workTime) {
        if (worker.tree) {
          trees = trees.filter((tree) => tree !== worker.tree);
          resourceRespawns.push({ kind: "tree", x: worker.tree.x, y: worker.tree.y, frames: worker.tree.frames, time: 45 });
          stumps.push({ x: worker.tree.x, y: worker.tree.y, art: art.stumps[Math.floor(random() * art.stumps.length)] });
          markWorldChunksDirty();
          woodCount += 1;
          claimed.delete(worker.tree);
          worker.tree = null;
        } else if (worker.stone) {
          stoneNodes = stoneNodes.filter((node) => node !== worker.stone);
          resourceRespawns.push({ kind: "stone", x: worker.stone.x, y: worker.stone.y, image: worker.stone.image, size: worker.stone.size, time: 45 });
          markWorldChunksDirty();
          stoneCount += 1;
          if (random() < 0.08) goldCount += 1;
          claimed.delete(worker.stone);
          worker.stone = null;
        }
        worker.chopTime = 0;
      }
    }
  }

  updateBuilders(dt);

  const friendlyTargets = [];
  if (player.hp > 0) friendlyTargets.push({ type: "player", entity: player });
  for (const worker of workers) friendlyTargets.push({ type: "worker", entity: worker });
  for (const builder of builders) friendlyTargets.push({ type: "builder", entity: builder });
  for (const guard of defenders) friendlyTargets.push({ type: "defender", entity: guard });
  for (const house of settlements) friendlyTargets.push({ type: "settlement", entity: house });
  for (const building of structures) friendlyTargets.push({ type: "structure", entity: building });
  for (const wall of walls) friendlyTargets.push({ type: "wall", entity: wall });

  for (const raider of raiders) {
    raider.animTime += dt;
    raider.cooldown = Math.max(0, raider.cooldown - dt);
    raider.flash = Math.max(0, raider.flash - dt);
    raider.moving = false;
    raider.raidTime = Math.max(0, raider.raidTime - dt);
    if (raider.raidTime <= 0 || !settlements.includes(raider.raidTarget)) raider.raidTarget = null;
    if (raider.hp <= raider.maxHp * 0.35) {
      raider.target = null;
      if (distance(raider, raider.home) > 90) raider.moving = moveToward(raider, raider.home, RAIDER_SPEED * 1.2, dt, 72);
      else raider.hp = Math.min(raider.maxHp, raider.hp + 16 * dt);
      continue;
    }
    if (raider.raidTarget && raider.target?.type !== "wall") {
      raider.target = { type: "settlement", entity: raider.raidTarget };
    }
    const target = raider.target;
    const targetStillExists = target && friendlyTargets.some(
      (item) => item.type === target.type && item.entity === target.entity,
    );
    if (target && (!targetStillExists || (!raider.raidTarget && distance(raider, target.entity) > ENEMY_LEASH_RADIUS))) {
      raider.target = null;
    }
    if (!raider.target) {
      const nearby = friendlyTargets.filter((item) => distance(raider, item.entity) <= ENEMY_AGGRO_RADIUS);
      if (nearby.length) {
        raider.target = nearby.reduce((a, b) => distance(raider, a.entity) < distance(raider, b.entity) ? a : b);
      }
    }

    if (!raider.target) {
      // Stay around the red settlement; do not raid the map on their own.
      if (distance(raider, raider.home) > 180) {
        raider.moving = moveToward(raider, raider.home, RAIDER_SPEED, dt, 75);
      }
      continue;
    }

    const victim = raider.target.entity;
    const range = raider.role === "archer" ? 195 : 50;
    if (distance(raider, victim) > range) {
      raider.moving = moveToward(raider, victim, RAIDER_SPEED, dt, range);
      if (!raider.moving && raider.target.type !== "wall") {
        const blockingWall = walls.find((wall) => distance(raider, wall) <= 90);
        if (blockingWall) raider.target = { type: "wall", entity: blockingWall };
      }
    } else if (raider.cooldown <= 0) {
      const damage = raider.role === "archer" ? 12 : 17;
      victim.hp -= damage;
      raider.cooldown = raider.role === "archer" ? 1.25 : 0.9;
      raider.flash = 0.35;
      if (raider.role === "archer") effects.push({ from: { x: raider.x, y: raider.y }, to: { x: victim.x, y: victim.y }, time: 0.16 });
    }
  }

  for (const guard of defenders) {
    guard.animTime += dt;
    guard.cooldown = Math.max(0, guard.cooldown - dt);
    guard.flash = Math.max(0, guard.flash - dt);
    guard.moving = false;
    if (guard.hp <= 0 || !settlements.includes(guard.house)) continue;
    if (guard.hp <= guard.maxHp * 0.35) {
      if (distance(guard, guard.house) > 78) guard.moving = moveToward(guard, guard.house, WORKER_SPEED * 1.2, dt, 54);
      else guard.hp = Math.min(guard.maxHp, guard.hp + 18 * dt);
      continue;
    }
    const threats = raiders.filter((raider) => raider.hp > 0 && distance(raider, guard) <= DEFENSE_RADIUS);
    const enemy = threats.length
      ? threats.reduce((a, b) => distance(guard, a) < distance(guard, b) ? a : b)
      : null;

    if (enemy) {
      const range = guard.role === "archer" ? ARCHER_RANGE : 58;
      if (distance(guard, enemy) > range) {
        guard.moving = moveToward(guard, enemy, WORKER_SPEED, dt, range);
      } else if (guard.cooldown <= 0) {
        enemy.hp -= guard.role === "archer" ? 18 : 26;
        guard.cooldown = guard.role === "archer" ? 1.15 : 0.9;
        guard.flash = 0.35;
        if (guard.role === "archer") effects.push({ from: { x: guard.x, y: guard.y }, to: { x: enemy.x, y: enemy.y }, time: 0.16 });
      }
      continue;
    }

    const targets = enemySettlements.filter((house) => house.hp > 0);
    if (!targets.length) continue;
    const target = targets.reduce((a, b) => distance(guard, a) < distance(guard, b) ? a : b);
    const range = guard.role === "archer" ? ARCHER_RANGE : 58;
    if (distance(guard, target) > range) {
      guard.moving = moveToward(guard, target, WORKER_SPEED, dt, range);
    } else if (guard.cooldown <= 0) {
      target.hp -= guard.role === "archer" ? 16 : 24;
      guard.cooldown = guard.role === "archer" ? 1.15 : 0.9;
      guard.flash = 0.35;
      if (guard.role === "archer") effects.push({ from: { x: guard.x, y: guard.y }, to: { x: target.x, y: target.y }, time: 0.16 });
      if (target.hp <= 0) {
        target.hp = 0;
        target.destroyed = true;
        enemyRespawns.push({ x: target.x, y: target.y, time: 75 });
        raiders = raiders.filter((raider) => raider.home !== target);
        woodCount += 8;
      }
    }
  }

  for (const building of structures) {
    building.cooldown = Math.max(0, building.cooldown - dt);
    if (building.type === "tower") {
      const targets = raiders.filter((raider) => raider.hp > 0 && distance(building, raider) <= 300);
      if (!targets.length || building.cooldown > 0) continue;
      const target = targets.reduce((a, b) => distance(building, a) < distance(building, b) ? a : b);
      target.hp -= 22;
      building.cooldown = 1.2;
      effects.push({ from: { x: building.x, y: building.y - 70 }, to: { x: target.x, y: target.y }, time: 0.16 });
    } else if ((building.type === "barracks" || building.type === "archery")
      && building.cooldown <= 0 && settlements.length) {
      const home = settlements.reduce((a, b) => distance(building, a) < distance(building, b) ? a : b);
      const role = building.type === "archery" ? "archer" : "warrior";
      const guard = makeDefender(home, role, 0, 0);
      guard.x = building.x;
      guard.y = building.y;
      defenders.push(guard);
      building.cooldown = 30;
    }
  }

  const enemySettlementCount = enemySettlements.length;
  enemySettlements = enemySettlements.filter((house) => !house.destroyed);
  if (enemySettlements.length !== enemySettlementCount) markWorldChunksDirty();
  raiders = raiders.filter((raider) => raider.hp > 0);
  defenders = defenders.filter((guard) => guard.hp > 0);
  workers = workers.filter((worker) => worker.hp > 0);
  if (player.hp <= 0 && player.respawnTime === 0) player.respawnTime = 0.001;
  const destroyed = settlements.filter((house) => house.hp <= 0);
  for (const house of destroyed) {
    settlements = settlements.filter((item) => item !== house);
    defenders = defenders.filter((guard) => guard.house !== house);
    workers = workers.filter((worker) => worker.home !== house);
  }
  if (destroyed.length) markWorldChunksDirty();
  const structureCount = structures.length;
  const wallCount = walls.length;
  structures = structures.filter((building) => building.hp > 0);
  walls = walls.filter((wall) => wall.hp > 0);
  if (structures.length !== structureCount || walls.length !== wallCount) markWorldChunksDirty();
  effects = effects.map((effect) => ({ ...effect, time: effect.time - dt })).filter((effect) => effect.time > 0);
}

function drawFrame(frame, x, y, facing = "right") {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (facing === "left") ctx.scale(-1, 1);
  ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh,
    -frame.width / 2, -frame.height / 2, frame.width, frame.height);
  ctx.restore();
}

function drawHealthBar(x, y, hp, maxHp, width = 42) {
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  ctx.fillStyle = "#231919";
  ctx.fillRect(Math.round(x - width / 2), Math.round(y), width, 6);
  ctx.fillStyle = ratio > 0.5 ? "#46d255" : ratio > 0.25 ? "#ebb437" : "#dc3737";
  ctx.fillRect(Math.round(x - width / 2 + 1), Math.round(y + 1), Math.floor((width - 2) * ratio), 4);
  ctx.strokeStyle = "#141414";
  ctx.strokeRect(Math.round(x - width / 2), Math.round(y), width, 6);
}

function buildingDimensions(type) {
  if (type === "tower") return { width: 82, height: 158 };
  if (type === "barracks") return { width: 118, height: 158 };
  return { width: 112, height: 150 };
}

function drawWallSegment(wall, x, y) {
  ctx.save();
  ctx.translate(x, y);
  if (wall.orientation === "vertical") {
    ctx.rotate(Math.PI / 2);
    ctx.translate(0, 18);
  }
  ctx.fillStyle = "rgba(25, 24, 18, 0.45)";
  ctx.fillRect(-WALL_LENGTH / 2, -5, WALL_LENGTH, 10);
  ctx.fillStyle = "#694329";
  ctx.strokeStyle = "#382719";
  ctx.lineWidth = 2;
  for (const postX of [-WALL_LENGTH / 2 + 5, 0, WALL_LENGTH / 2 - 5]) {
    ctx.fillRect(postX - 4, -34, 8, 34);
    ctx.strokeRect(postX - 4, -34, 8, 34);
    ctx.fillStyle = "#b18655";
    ctx.fillRect(postX - 5, -37, 10, 5);
    ctx.fillStyle = "#694329";
  }
  for (const railY of [-26, -12]) {
    ctx.fillRect(-WALL_LENGTH / 2, railY, WALL_LENGTH, 7);
    ctx.strokeRect(-WALL_LENGTH / 2, railY, WALL_LENGTH, 7);
    ctx.fillStyle = "rgba(235, 193, 129, 0.55)";
    ctx.fillRect(-WALL_LENGTH / 2 + 2, railY + 1, WALL_LENGTH - 4, 1);
    ctx.fillStyle = "#694329";
  }
  ctx.restore();
}

function traceCoastline() {
  ctx.beginPath();
  coastline.forEach((point, index) => {
    const x = point.x - camera.x;
    const y = point.y - camera.y;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function drawTerrain() {
  ctx.fillStyle = "#55aaa7";
  ctx.fillRect(0, 0, viewWidth / CAMERA_ZOOM, viewHeight / CAMERA_ZOOM);
  const left = Math.max(0, Math.floor(camera.x / CHUNK_SIZE));
  const right = Math.min(Math.ceil(WORLD_WIDTH / CHUNK_SIZE) - 1,
    Math.floor((camera.x + viewWidth / CAMERA_ZOOM) / CHUNK_SIZE));
  const top = Math.max(0, Math.floor(camera.y / CHUNK_SIZE));
  const bottom = Math.min(Math.ceil(WORLD_HEIGHT / CHUNK_SIZE) - 1,
    Math.floor((camera.y + viewHeight / CAMERA_ZOOM) / CHUNK_SIZE));
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      const terrainChunk = terrainChunks.get(`${column}:${row}`);
      if (terrainChunk) ctx.drawImage(terrainChunk,
        column * CHUNK_SIZE - camera.x, row * CHUNK_SIZE - camera.y);
    }
  }
}

function draw() {
  ctx.clearRect(0, 0, viewWidth, viewHeight);
  ctx.save();
  ctx.scale(CAMERA_ZOOM, CAMERA_ZOOM);
  drawTerrain();
  const visible = getVisibleChunkEntities();

  for (const item of visible.decorations) {
    if (item.kind === "bush") {
      const frame = item.frames[Math.floor(performance.now() / 550 + item.phase) % item.frames.length];
      ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh,
        item.x - camera.x - frame.width / 2, item.y - camera.y - frame.height / 2,
        frame.width, frame.height);
    } else {
      const size = item.size;
      ctx.drawImage(item.image, item.x - camera.x - size / 2, item.y - camera.y - size / 2, size, size);
    }
  }

  for (const stump of visible.stumps) {
    ctx.drawImage(stump.art.image, stump.x - camera.x - 25, stump.y - camera.y - 43, 50, 68);
  }

  for (const node of visible.stoneNodes) {
    const mining = workers.some((worker) => worker.stone === node && worker.chopTime > 0);
    const shake = mining ? Math.sin(performance.now() * 0.045) * 3 : 0;
    ctx.drawImage(node.image, node.x - camera.x - node.size / 2 + shake,
      node.y - camera.y - node.size, node.size, node.size);
  }

  for (const house of visible.settlements) {
    const cx = house.x - camera.x;
    const cy = house.y - camera.y;
    ctx.beginPath();
    ctx.arc(cx, cy - HOME_SIZE.height / 2, WORK_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(100,220,130,0.035)";
    ctx.fill();
    ctx.strokeStyle = "rgba(130,245,155,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.drawImage(art.home, cx - HOME_SIZE.width / 2, cy - HOME_SIZE.height, HOME_SIZE.width, HOME_SIZE.height);
    drawHealthBar(cx, cy - HOME_SIZE.height - 12, house.hp, house.maxHp, 70);
  }

  for (const building of visible.structures) {
    const { width, height } = buildingDimensions(building.type);
    const image = art[building.type];
    const cx = building.x - camera.x;
    const cy = building.y - camera.y;
    ctx.drawImage(image, cx - width / 2, cy - height, width, height);
    drawHealthBar(cx, cy - height - 10, building.hp, building.maxHp, 62);
  }

  for (const wall of visible.walls) {
    drawWallSegment(wall, wall.x - camera.x, wall.y - camera.y);
    drawHealthBar(wall.x - camera.x, wall.y - camera.y - 42, wall.hp, wall.maxHp, 48);
  }

  for (const house of visible.enemySettlements) {
    const cx = house.x - camera.x;
    const cy = house.y - camera.y;
    ctx.beginPath();
    ctx.arc(cx, cy - HOME_SIZE.height / 2, 300, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(190,45,45,0.035)";
    ctx.fill();
    ctx.strokeStyle = "rgba(225,80,75,0.55)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.drawImage(art.enemyHome, cx - HOME_SIZE.width / 2, cy - HOME_SIZE.height, HOME_SIZE.width, HOME_SIZE.height);
    drawHealthBar(cx, cy - HOME_SIZE.height - 12, house.hp, house.maxHp, 70);
  }

  if (placingHouse) {
    const mouse = pointerPosition();
    const localX = mouse.x / CAMERA_ZOOM;
    const localY = mouse.y / CAMERA_ZOOM;
    const worldX = localX + camera.x;
    const worldY = localY + camera.y;
    ctx.globalAlpha = 0.55;
    if (selectedBuilding === "wall") {
      const snappedX = Math.round(worldX / WALL_LENGTH) * WALL_LENGTH - camera.x;
      const snappedY = Math.round(worldY / WALL_LENGTH) * WALL_LENGTH - camera.y;
      drawWallSegment({ orientation: wallOrientation }, snappedX, snappedY);
    } else {
      const image = selectedBuilding === "house" ? art.home : art[selectedBuilding];
      const { width, height } = selectedBuilding === "house" ? HOME_SIZE : buildingDimensions(selectedBuilding);
      ctx.drawImage(image, localX - width / 2, localY - height, width, height);
    }
    ctx.globalAlpha = 1;
  }

  for (const tree of visible.trees) {
    const chopping = tree === player.harvesting || workers.some((worker) => worker.tree === tree && worker.chopTime > 0);
    const frameIndex = chopping ? Math.floor(performance.now() / 110) % tree.frames.length : 0;
    const shake = chopping ? Math.sin(performance.now() * 0.045) * 4 : 0;
    const frame = tree.frames[frameIndex];
    ctx.drawImage(frame.image, frame.sx, frame.sy, frame.sw, frame.sh,
      tree.x - camera.x - TREE_SIZE.width / 2 + shake,
      tree.y - camera.y - TREE_SIZE.height,
      TREE_SIZE.width, TREE_SIZE.height);
  }

  for (const worker of workers) {
    if (!isInsideCamera(worker, WORKER_SIZE)) continue;
    let frames;
    let index;
    if ((worker.tree || worker.stone) && worker.chopTime > 0) {
      frames = art.workerChop;
      const workTime = worker.stone ? STONE_MINE_TIME : CHOP_TIME;
      index = Math.min(frames.length - 1, Math.floor(worker.chopTime / workTime * frames.length));
    } else if (worker.moving) {
      frames = art.workerRun;
      index = Math.floor(worker.animTime * 10) % frames.length;
    } else {
      frames = art.workerIdle;
      index = Math.floor(worker.animTime * 3) % frames.length;
    }
    drawFrame(frames[index], worker.x - camera.x, worker.y - camera.y, worker.facing);
    drawHealthBar(worker.x - camera.x, worker.y - camera.y - 29, worker.hp, worker.maxHp);
  }

  for (const builder of builders) {
    if (!isInsideCamera(builder, WORKER_SIZE)) continue;
    const frames = builder.repairing ? art.workerChop : builder.moving ? art.workerRun : art.workerIdle;
    const index = builder.repairing ? Math.floor(builder.animTime * 8) % frames.length
      : builder.moving ? Math.floor(builder.animTime * 10) % frames.length : Math.floor(builder.animTime * 3) % frames.length;
    drawFrame(frames[index], builder.x - camera.x, builder.y - camera.y, builder.facing);
    drawHealthBar(builder.x - camera.x, builder.y - camera.y - 29, builder.hp, builder.maxHp);
    ctx.fillStyle = "#ffd35c";
    ctx.beginPath();
    ctx.arc(builder.x - camera.x + 13, builder.y - camera.y - 17, 5, 0, Math.PI * 2);
    ctx.fill();
    if (builder.repairing) {
      ctx.fillStyle = "#8ff08a";
      ctx.font = "bold 18px system-ui, sans-serif";
      ctx.fillText("+", builder.x - camera.x + 8, builder.y - camera.y - 30);
    }
  }

  for (const guard of defenders) {
    if (!isInsideCamera(guard, WORKER_SIZE)) continue;
    const prefix = guard.role === "archer" ? "archer" : "warrior";
    const idle = art[`${prefix}Idle`];
    const run = art[`${prefix}Run`];
    const attack = art[`${prefix}Attack`];
    const frames = guard.flash > 0 ? attack : guard.moving ? run : idle;
    const index = guard.flash > 0 ? Math.floor((0.35 - guard.flash) * 18) % frames.length
      : guard.moving ? Math.floor(guard.animTime * 10) % frames.length
        : Math.floor(guard.animTime * 3) % frames.length;
    drawFrame(frames[index], guard.x - camera.x, guard.y - camera.y, guard.facing);
    drawHealthBar(guard.x - camera.x, guard.y - camera.y - 30, guard.hp, guard.maxHp);
  }

  for (const raider of raiders) {
    if (!isInsideCamera(raider, WORKER_SIZE)) continue;
    const idle = raider.role === "archer" ? art.raiderArcherIdle : art.raiderIdle;
    const run = raider.role === "archer" ? art.raiderArcherRun : art.raiderRun;
    const attack = raider.role === "archer" ? art.raiderArcherAttack : art.raiderAttack;
    const frames = raider.flash > 0 ? attack : raider.moving ? run : idle;
    const index = raider.flash > 0 ? Math.floor((0.35 - raider.flash) * 18) % frames.length
      : raider.moving ? Math.floor(raider.animTime * 10) % frames.length
        : Math.floor(raider.animTime * 3) % frames.length;
    drawFrame(frames[index], raider.x - camera.x, raider.y - camera.y, raider.facing);
    drawHealthBar(raider.x - camera.x, raider.y - camera.y - 30, raider.hp, raider.maxHp);
  }

  for (const effect of effects) {
    ctx.strokeStyle = "#ffeb78";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(effect.from.x - camera.x, effect.from.y - camera.y);
    ctx.lineTo(effect.to.x - camera.x, effect.to.y - camera.y);
    ctx.stroke();
  }

  if (player.target) {
    const x = player.target.x - camera.x;
    const y = player.target.y - camera.y;
    const pulse = 3 + Math.floor((markerTime * 5) % 7);
    ctx.strokeStyle = "white";
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#ff4b41";
    ctx.beginPath();
    ctx.arc(x, y, pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ff4b41";
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  const playerFrames = player.harvesting ? art.playerChop : player.target ? art.playerRun : art.playerIdle;
  const playerFrame = player.harvesting
    ? Math.min(playerFrames.length - 1, Math.floor(player.harvestTime * playerFrames.length))
    : player.target ? Math.floor(playerAnimTime * 10) % playerFrames.length
      : Math.floor(playerAnimTime * 3) % playerFrames.length;
  drawFrame(playerFrames[playerFrame], player.x - camera.x, player.y - camera.y, player.facing || "down");
  if (player.hp > 0) {
    drawHealthBar(player.x - camera.x, player.y - camera.y - 36, player.hp, player.maxHp, 48);
  }

  ctx.restore();
  drawNightOverlay();
  drawHud();
  drawMinimap(1 / 60);
}

function drawMinimap(dt) {
  minimapUpdateTime += dt;
  if (minimapUpdateTime < 0.15) return;
  minimapUpdateTime = 0;
  const width = minimap.width;
  const height = minimap.height;
  const sx = width / WORLD_WIDTH;
  const sy = height / WORLD_HEIGHT;
  minimapCtx.clearRect(0, 0, width, height);
  if (minimapTerrain) minimapCtx.drawImage(minimapTerrain, 0, 0, width, height);
  if (minimapFogCanvas) minimapCtx.drawImage(minimapFogCanvas, 0, 0, width, height);
  const isRevealed = (item) => explored[Math.floor(item.y / 64) * MINIMAP_COLS + Math.floor(item.x / 64)];
  const mark = (items, color, size = 3) => {
    minimapCtx.fillStyle = color;
    for (const item of items) {
      if (!isRevealed(item)) continue;
      minimapCtx.fillRect(item.x * sx - size / 2, item.y * sy - size / 2, size, size);
    }
  };
  const playerMapColor = { yellow: "#ffe47a", blue: "#68b9ff", purple: "#d89aff" }[mainHouseColor];
  mark(settlements, playerMapColor, 5);
  mark(enemySettlements, "#ff554b", 5);
  mark(structures, "#f7f2d0", 3);
  mark(walls, "#ded6b3", 2);
  minimapCtx.strokeStyle = "rgba(255,255,255,0.85)";
  minimapCtx.lineWidth = 1;
  minimapCtx.strokeRect(camera.x * sx, camera.y * sy, (viewWidth / CAMERA_ZOOM) * sx, (viewHeight / CAMERA_ZOOM) * sy);
  minimapCtx.fillStyle = "#ffffff";
  minimapCtx.beginPath();
  minimapCtx.arc(player.x * sx, player.y * sy, 2.5, 0, Math.PI * 2);
  minimapCtx.fill();
}

function drawHud() {
  const panelWidth = 350;
  const panelHeight = 66;
  const panelScale = Math.min(1, (viewWidth - 24) / panelWidth);
  ctx.save();
  ctx.scale(panelScale, panelScale);
  ctx.fillStyle = "rgba(20,25,24,0.82)";
  ctx.fillRect(12, 12, panelWidth, panelHeight);
  ctx.drawImage(art.woodIcon, 20, 24, 40, 40);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(String(woodCount), 66, 45);
  ctx.drawImage(art.rocks[0], 130, 24, 40, 40);
  ctx.fillText(String(stoneCount), 176, 45);
  // The gold resource sprite has wide transparent margins; crop them so the icon reads at HUD size.
  ctx.drawImage(art.goldIcon, 48, 46, 30, 32, 239, 21, 48, 48);
  ctx.fillText(String(goldCount), 294, 45);
  ctx.restore();
  if (raidWarningTime > 0 || raidMessageTime > 0) {
    const warning = raidWarningTime > 0;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.fillStyle = warning ? "#ffd86a" : "#ff8a72";
    ctx.fillText(warning ? `Варвары собираются в рейд · ${Math.ceil(raidWarningTime)}` : "Варвары атакуют поселение!", viewWidth / 2, 36);
    ctx.restore();
  }
  if (placingHouse) {
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.fillStyle = "#fff2a8";
    ctx.textAlign = "center";
    ctx.fillText(`Щёлкните, чтобы поставить: ${BUILDING_TYPES[selectedBuilding].name} · Esc — отмена`, viewWidth / 2, viewHeight - 34);
    ctx.textAlign = "left";
  } else if (demolishMode) {
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.fillStyle = "#ffcf9f";
    ctx.textAlign = "center";
    ctx.fillText("Выберите свою постройку для сноса · возврат половины стоимости", viewWidth / 2, viewHeight - 34);
    ctx.textAlign = "left";
  }
  if (player.harvesting) {
    ctx.fillStyle = "#fff2a8";
    ctx.textAlign = "center";
    ctx.fillText("Рубка дерева…", viewWidth / 2, viewHeight - 34);
    ctx.textAlign = "left";
  }
  if (player.hp <= 0) {
    ctx.fillStyle = "rgba(15,20,18,0.72)";
    ctx.fillRect(viewWidth / 2 - 150, viewHeight / 2 - 32, 300, 64);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.fillText("Вы потеряли сознание…", viewWidth / 2, viewHeight / 2 + 7);
    ctx.textAlign = "left";
  }
}

function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const source = event || { clientX: lastPointer.x, clientY: lastPointer.y };
  return {
    x: (source.clientX - rect.left) * (canvas.width / rect.width),
    y: (source.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function startHarvesting() {
  if (player.harvesting || !trees.length) return;
  const tree = trees.reduce((a, b) => distance(player, a) < distance(player, b) ? a : b);
  if (distance(player, tree) <= HARVEST_DISTANCE) {
    player.harvesting = tree;
    player.harvestTime = 0;
    player.target = null;
  }
}

function startBuilding() {
  if (placingHouse) {
    placingHouse = false;
    updateBuildButton();
    return;
  }
  if (!canAffordBuilding(selectedBuilding) || !canBuildMore(selectedBuilding)) return;
  demolishMode = false;
  demolishButton.setAttribute("aria-pressed", "false");
  demolishButton.textContent = "Снос: выкл.";
  placingHouse = true;
  rotateWallButton.hidden = !placingHouse || selectedBuilding !== "wall";
  player.target = null;
  updateBuildButton();
}

function toggleDemolishMode() {
  demolishMode = !demolishMode;
  if (demolishMode) placingHouse = false;
  demolishButton.setAttribute("aria-pressed", String(demolishMode));
  demolishButton.textContent = demolishMode ? "Снос: ВКЛ" : "Снос: выкл.";
  player.target = null;
  updateBuildButton();
}

function canAffordBuilding(type) {
  const cost = BUILDING_TYPES[type];
  return Boolean(cost && woodCount >= cost.wood && stoneCount >= cost.stone);
}

function buildingCount(type) {
  if (type === "house") return settlements.length;
  return structures.filter((building) => building.type === type).length;
}

function canBuildMore(type) {
  return !BUILDING_LIMITS[type] || buildingCount(type) < BUILDING_LIMITS[type];
}

function hireBuilder() {
  if (goldCount < BUILDER_COST) return;
  const home = mainSettlement || settlements[0] || player;
  builders.push(makeBuilder({ x: home.x + 70, y: home.y + 15 }));
  goldCount -= BUILDER_COST;
  updateBuildButton();
}

function updateBuildButton() {
  const info = BUILDING_TYPES[selectedBuilding];
  const limit = BUILDING_LIMITS[selectedBuilding];
  const count = buildingCount(selectedBuilding);
  buildButton.textContent = placingHouse ? "Отмена" : limit ? `Построить · ${count}/${limit}` : "Построить";
  buildButton.title = limit && count >= limit
    ? `Достигнут лимит: ${limit} · ${info.name}`
    : `${info.name}: ${info.wood} дерева, ${info.stone} камня`;
  buildButton.disabled = !placingHouse && (!canAffordBuilding(selectedBuilding) || !canBuildMore(selectedBuilding));
  builderButton.textContent = `Нанять строителя · ${BUILDER_COST} золота (${builders.length})`;
  builderButton.disabled = goldCount < BUILDER_COST;
  rotateWallButton.hidden = !placingHouse || selectedBuilding !== "wall";
  rotateWallButton.textContent = `Стена: ${wallOrientation === "horizontal" ? "горизонтально" : "вертикально"}`;
}

function demolishBuildingAt(point) {
  const candidates = [
    ...settlements.map((entity) => ({ entity, kind: "house", radius: 76 })),
    ...structures.map((entity) => ({ entity, kind: entity.type, radius: 76 })),
    ...walls.map((entity) => ({ entity, kind: "wall", radius: 46 })),
  ].map((candidate) => ({ ...candidate, distance: distance(point, candidate.entity) }))
    .filter((candidate) => candidate.distance <= candidate.radius)
    .sort((a, b) => a.distance - b.distance);
  const target = candidates[0];
  if (!target) return false;
  if (target.kind === "house" && settlements.length <= 1) return false;

  const cost = BUILDING_TYPES[target.kind];
  woodCount += Math.floor(cost.wood / 2);
  stoneCount += Math.floor(cost.stone / 2);
  if (target.kind === "house") {
    const removed = target.entity;
    settlements = settlements.filter((item) => item !== removed);
    workers = workers.filter((worker) => worker.home !== removed);
    defenders = defenders.filter((guard) => guard.house !== removed);
    if (mainSettlement === removed) {
      mainSettlement = settlements.reduce((best, item) => distance(removed, item) < distance(removed, best) ? item : best);
    }
  } else if (target.kind === "wall") {
    walls = walls.filter((item) => item !== target.entity);
  } else {
    structures = structures.filter((item) => item !== target.entity);
  }
  markWorldChunksDirty();
  updateBuildButton();
  return true;
}

function clearBuildingSpot(x, y, type) {
  const wall = type === "wall";
  const buildingClearance = wall ? 54 : 92;
  if ([...settlements, ...enemySettlements, ...structures].some((item) => distance({ x, y }, item) < buildingClearance)) return false;
  if (walls.some((item) => distance({ x, y }, item) < (wall ? WALL_LENGTH * 0.78 : 76))) return false;
  if (!wall && trees.some((item) => distance({ x, y }, item) < 80)) return false;
  if (!wall && stoneNodes.some((item) => distance({ x, y }, item) < 64)) return false;
  return true;
}

function placeSelectedBuilding(point) {
  const type = selectedBuilding;
  if (!canAffordBuilding(type) || !canBuildMore(type)) {
    placingHouse = false;
    updateBuildButton();
    return;
  }
  const position = type === "wall"
    ? { x: Math.round(point.x / WALL_LENGTH) * WALL_LENGTH, y: Math.round(point.y / WALL_LENGTH) * WALL_LENGTH }
    : point;
  if (!isLandPoint(position) || !clearBuildingSpot(position.x, position.y, type)) return;

  const cost = BUILDING_TYPES[type];
  if (type === "house") {
    addSettlement(position.x, position.y);
  } else if (type === "wall") {
    walls.push({ x: position.x, y: position.y, orientation: wallOrientation, hp: 180, maxHp: 180 });
    markWorldChunksDirty();
  } else {
    const maxHp = type === "barracks" ? 650 : 450;
    structures.push({ x: position.x, y: position.y, type, hp: maxHp, maxHp, cooldown: type === "tower" ? 0 : 18 });
    markWorldChunksDirty();
  }
  woodCount -= cost.wood;
  stoneCount -= cost.stone;
  if (type !== "wall" || !canAffordBuilding(type)) placingHouse = false;
  updateBuildButton();
}

const lastPointer = { x: 0, y: 0 };
canvas.addEventListener("pointermove", (event) => {
  lastPointer.x = event.clientX;
  lastPointer.y = event.clientY;
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const p = pointerPosition(event);
  const world = { x: p.x / CAMERA_ZOOM + camera.x, y: p.y / CAMERA_ZOOM + camera.y };
  if (placingHouse) {
    placeSelectedBuilding(world);
  } else if (demolishMode) {
    demolishBuildingAt(world);
  } else {
    player.target = {
      x: Math.max(LAND_SAFE_MARGIN, Math.min(WORLD_WIDTH - LAND_SAFE_MARGIN, world.x)),
      y: Math.max(LAND_SAFE_MARGIN, Math.min(WORLD_HEIGHT - LAND_SAFE_MARGIN, world.y)),
    };
    markerTime = 0;
  }
});

window.addEventListener("keydown", (event) => {
  if (!gameStarted && event.key !== "F11") return;
  if (event.key.toLowerCase() === "e") {
    startHarvesting();
  } else if (event.key.toLowerCase() === "h") {
    startBuilding();
  } else if (event.key === "Escape") {
    placingHouse = false;
    demolishMode = false;
    demolishButton.setAttribute("aria-pressed", "false");
    demolishButton.textContent = "Снос: выкл.";
    updateBuildButton();
  } else if (event.key.toLowerCase() === "r" && placingHouse && selectedBuilding === "wall") {
    toggleWallOrientation();
  } else if (event.key === "F11") {
    event.preventDefault();
    toggleFullscreen();
  }
});

harvestButton.addEventListener("click", startHarvesting);
buildButton.addEventListener("click", startBuilding);
builderButton.addEventListener("click", hireBuilder);
demolishButton.addEventListener("click", toggleDemolishMode);
buildingSelect.addEventListener("change", () => {
  selectedBuilding = BUILDING_TYPES[buildingSelect.value] ? buildingSelect.value : "house";
  updateBuildButton();
});

function toggleWallOrientation() {
  wallOrientation = wallOrientation === "horizontal" ? "vertical" : "horizontal";
  updateBuildButton();
}

rotateWallButton.addEventListener("click", toggleWallOrientation);

function createSeed() {
  if (window.crypto?.getRandomValues) {
    const words = new Uint32Array(2);
    window.crypto.getRandomValues(words);
    return `${words[0].toString(36)}-${words[1].toString(36)}`;
  }
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}

function startNewGame() {
  const seed = seedInput.value.trim() || createSeed();
  seedInput.value = seed;
  setMainHouseColor(mainHouseColorSelect.value);
  currentSaveName = worldNameInput.value.trim() || `Мир ${seed}`;
  worldNameInput.value = currentSaveName;
  currentSaveId = makeSaveId();
  placingHouse = false;
  demolishMode = false;
  demolishButton.setAttribute("aria-pressed", "false");
  demolishButton.textContent = "Снос: выкл.";
  setupWorld(seed);
  gameStarted = true;
  fpsCounter.hidden = false;
  fpsFrames = 0;
  fpsSampleStart = 0;
  mainMenu.hidden = true;
  minimap.hidden = false;
  saveButton.hidden = false;
  menuButton.hidden = false;
  document.querySelector("#mobile-controls").hidden = false;
  autosaveTime = 0;
  saveGame(false);
  updateBuildButton();
}

function loadSavedGame(id) {
  try {
    const entry = readSavedGames().find((item) => item.id === id);
    if (!entry || !restoreGame(entry.game)) {
      menuStatus.textContent = "Сохранение не найдено или повреждено.";
      renderSavedGames();
      return;
    }
    currentSaveId = entry.id;
    currentSaveName = entry.name || entry.game.seed || "Мой мир";
    gameStarted = true;
    fpsCounter.hidden = false;
    fpsFrames = 0;
    fpsSampleStart = 0;
    mainMenu.hidden = true;
    minimap.hidden = false;
    saveButton.hidden = false;
    menuButton.hidden = false;
    document.querySelector("#mobile-controls").hidden = false;
    autosaveTime = 0;
    updateBuildButton();
  } catch (error) {
    menuStatus.textContent = "Не удалось открыть сохранение.";
    console.warn("Не удалось загрузить сохранение:", error);
  }
}

function returnToMenu() {
  saveGame(false);
  gameStarted = false;
  fpsCounter.hidden = true;
  placingHouse = false;
  demolishMode = false;
  demolishButton.setAttribute("aria-pressed", "false");
  demolishButton.textContent = "Снос: выкл.";
  worldNameInput.value = "";
  seedInput.value = "";
  menuStatus.textContent = currentSeed ? `Последняя игра · seed: ${currentSeed}` : "";
  mainMenu.hidden = false;
  minimap.hidden = true;
  saveButton.hidden = true;
  menuButton.hidden = true;
  document.querySelector("#mobile-controls").hidden = true;
  updateBuildButton();
  renderSavedGames();
}

newGameButton.addEventListener("click", startNewGame);
saveButton.addEventListener("click", () => {
  if (saveGame(false)) {
    saveButton.textContent = "Сохранено";
    window.setTimeout(() => { saveButton.textContent = "Сохранить"; }, 1200);
  } else {
    saveButton.textContent = "Ошибка сохранения";
    window.setTimeout(() => { saveButton.textContent = "Сохранить"; }, 1600);
  }
});
menuButton.addEventListener("click", returnToMenu);
window.addEventListener("pagehide", () => saveGame(false));

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    console.warn("Полноэкранный режим недоступен:", error);
  }
}

fullscreenButton.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  fullscreenButton.textContent = document.fullscreenElement ? "Выйти из полного экрана" : "На весь экран";
  resizeCanvas();
});

function frame(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
  lastTime = now;
  if (gameStarted) {
    if (!fpsSampleStart) fpsSampleStart = now;
    fpsFrames += 1;
    const fpsElapsed = now - fpsSampleStart;
    if (fpsElapsed >= 500) {
      fpsCounter.textContent = `FPS: ${Math.round(fpsFrames * 1000 / fpsElapsed)}`;
      fpsFrames = 0;
      fpsSampleStart = now;
    }
    markerTime += dt;
    update(dt);
    draw();
    updateBuildButton();
    autosaveTime += dt;
    if (autosaveTime >= 12) {
      saveGame(false);
      autosaveTime = 0;
    }
  }
  requestAnimationFrame(frame);
}

loadAssets().then((loadedArt) => {
  art = loadedArt;
  buildMinimapTerrain();
  buildTerrainChunks();
  loading.classList.add("hidden");
  mainMenu.hidden = false;
  renderSavedGames();
  requestAnimationFrame(frame);
}).catch((error) => {
  const fileProtocol = window.location.protocol === "file:";
  loading.textContent = fileProtocol
    ? `${error.message}. Запустите игру через веб-сервер, а не открывайте index.html напрямую.`
    : `${error.message}. Проверьте, что папка «Assets» загружена рядом с index.html, а имена папок и файлов совпадают по регистру.`;
  console.error(error);
});
