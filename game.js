"use strict";

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const loading = document.querySelector("#loading");
const fullscreenButton = document.querySelector("#fullscreen-button");
const harvestButton = document.querySelector("#harvest-button");
const buildButton = document.querySelector("#build-button");

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1800;
const LAND_MARGIN = 170;
const LAND_SAFE_MARGIN = LAND_MARGIN + 80;
const START_HOME = { x: 400, y: 400 };
const TILE_SIZE = 96;
const PLAYER_SIZE = 58;
const WORKER_SIZE = 48;
const TREE_SIZE = { width: 104, height: 139 };
const HOME_SIZE = { width: 92, height: 138 };
const WORK_RADIUS = 600;
const PLAYER_SPEED = 240;
const WORKER_SPEED = 105;
const RAIDER_SPEED = 82;
const CHOP_DISTANCE = 75;
const CHOP_TIME = 2.5;
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

const player = { x: 400, y: 500, target: null, harvesting: null, harvestTime: 0, hp: 100, maxHp: 100, respawnTime: 0 };
let woodCount = 0;
let markerTime = 0;
let trees = [];
let stumps = [];
let workers = [];
let settlements = [];
let enemySettlements = [];
let decorations = [];
let defenders = [];
let raiders = [];
let effects = [];

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
    image.onerror = () => reject(new Error(`Не удалось загрузить ${path}`));
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
  return ["Tiny Swords (Free Pack)", ...parts].join("/");
}

async function loadAssets() {
  const paths = {
    ground: asset("Terrain", "Tileset", "Tilemap_color1.png"),
    water: asset("Terrain", "Tileset", "Water Background color.png"),
    home: asset("Buildings", "Yellow Buildings", "House1.png"),
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
  if (remaining <= step + 0.5) {
    entity.x = point.x - (dx / d) * stoppingDistance;
    entity.y = point.y - (dy / d) * stoppingDistance;
  } else {
    entity.x += (dx / d) * step;
    entity.y += (dy / d) * step;
  }
  return true;
}

function generateForest(count = 75) {
  const result = [];
  const base = START_HOME;
  let attempts = 0;
  while (result.length < count && attempts < count * 200) {
    attempts += 1;
    const p = {
      x: LAND_SAFE_MARGIN + Math.random() * (WORLD_WIDTH - 2 * LAND_SAFE_MARGIN),
      y: LAND_SAFE_MARGIN + Math.random() * (WORLD_HEIGHT - 2 * LAND_SAFE_MARGIN),
      frames: art.treeTypes[Math.floor(Math.random() * art.treeTypes.length)],
    };
    if (!isLandPoint(p) || distance(p, base) < 280) continue;
    if (result.every((tree) => distance(p, tree) >= 105)) result.push(p);
  }
  return result;
}

function makeWorker(position, home) {
  return { x: position.x, y: position.y, home, tree: null, chopTime: 0, animTime: Math.random(), moving: false, facing: "down", hp: 65, maxHp: 65 };
}

function makeSettlement(x, y) {
  return { x, y, hp: 500, maxHp: 500 };
}

function addSettlement(x, y) {
  const house = makeSettlement(x, y);
  settlements.push(house);
  workers.push(makeWorker({ x: x - 24, y: y + 24 }, house));
  workers.push(makeWorker({ x: x + 24, y: y + 24 }, house));
  defenders.push(makeDefender(house, "warrior", -36, 30));
  defenders.push(makeDefender(house, "archer", 36, 30));
  return house;
}

function makeDefender(house, role, ox, oy) {
  return {
    x: house.x + ox, y: house.y + oy, house, role, hp: 100, maxHp: 100,
    cooldown: Math.random() * 0.7, flash: 0, animTime: Math.random(), moving: false, facing: "down",
  };
}

function generateEnemySettlements(count = 3) {
  let attempts = 0;
  while (enemySettlements.length < count && attempts < count * 300) {
    attempts += 1;
    const house = {
      x: LAND_SAFE_MARGIN + 100 + Math.random() * (WORLD_WIDTH - 2 * (LAND_SAFE_MARGIN + 100)),
      y: LAND_SAFE_MARGIN + 100 + Math.random() * (WORLD_HEIGHT - 2 * (LAND_SAFE_MARGIN + 100)),
      hp: 700,
      maxHp: 700,
    };
    if (!isLandPoint(house)) continue;
    if (settlements.some((friendly) => distance(house, friendly) < 760)) continue;
    if (enemySettlements.some((other) => distance(house, other) < 700)) continue;
    enemySettlements.push(house);
  }

  for (const house of enemySettlements) {
    const guards = [
      ["warrior", -50, 30], ["warrior", 45, 35], ["warrior", 0, 65], ["archer", 0, -50],
    ];
    for (const [role, ox, oy] of guards) {
      const maxHp = role === "warrior" ? 120 : 85;
      raiders.push({
        x: house.x + ox, y: house.y + oy, home: house, role,
        hp: maxHp, maxHp, cooldown: Math.random() * 0.8, flash: 0,
        animTime: Math.random(), moving: false, facing: "down", target: null,
      });
    }
  }
}

function generateDecorations(count = 125) {
  let attempts = 0;
  while (decorations.length < count && attempts < count * 80) {
    attempts += 1;
    const point = {
      x: LAND_SAFE_MARGIN + Math.random() * (WORLD_WIDTH - 2 * LAND_SAFE_MARGIN),
      y: LAND_SAFE_MARGIN + Math.random() * (WORLD_HEIGHT - 2 * LAND_SAFE_MARGIN),
    };
    if (!isLandPoint(point)) continue;
    if (trees.some((tree) => distance(point, tree) < 115)) continue;
    if ([...settlements, ...enemySettlements].some((house) => distance(point, house) < 150)) continue;

    if (Math.random() < 0.58) {
      decorations.push({
        ...point,
        kind: "bush",
        frames: art.bushes[Math.floor(Math.random() * art.bushes.length)],
        phase: Math.random() * 8,
      });
    } else {
      decorations.push({
        ...point,
        kind: "rock",
        image: art.rocks[Math.floor(Math.random() * art.rocks.length)],
        size: 30 + Math.random() * 22,
      });
    }
  }
}

function setupWorld() {
  const base = addSettlement(START_HOME.x, START_HOME.y);
  workers[0].x = base.x - 24;
  workers[0].y = base.y + 24;
  workers[1].x = base.x + 24;
  workers[1].y = base.y + 24;
  trees = generateForest();
  generateEnemySettlements();
  generateDecorations();
}

function update(dt) {
  playerAnimTime += dt;
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
  camera.x = Math.max(0, Math.min(player.x - viewWidth / 2, WORLD_WIDTH - viewWidth));
  camera.y = Math.max(0, Math.min(player.y - viewHeight / 2, WORLD_HEIGHT - viewHeight));

  if (player.harvesting) {
    player.harvestTime += dt;
    if (player.harvestTime >= 1) {
      const tree = player.harvesting;
      trees = trees.filter((item) => item !== tree);
      stumps.push({ x: tree.x, y: tree.y, art: art.stumps[Math.floor(Math.random() * art.stumps.length)] });
      player.harvesting = null;
      woodCount += 1;
    }
  }

  const claimed = new Set();
  const choppingTrees = new Set();
  for (const worker of workers) {
    worker.animTime += dt;
    worker.moving = false;
    if (!trees.includes(worker.tree) || worker.tree === player.harvesting) {
      worker.tree = null;
      worker.chopTime = 0;
    }
    if (!worker.tree) {
      const choices = trees.filter((tree) => tree !== player.harvesting && !claimed.has(tree) && distance(tree, worker.home) <= WORK_RADIUS);
      if (choices.length) worker.tree = choices.reduce((a, b) => distance(worker, a) < distance(worker, b) ? a : b);
    }
    if (!worker.tree) continue;
    claimed.add(worker.tree);
    const d = distance(worker, worker.tree);
    if (d > CHOP_DISTANCE + 0.5) {
      worker.moving = moveToward(worker, worker.tree, WORKER_SPEED, dt, CHOP_DISTANCE);
      worker.chopTime = 0;
    } else {
      worker.chopTime += dt;
      choppingTrees.add(worker.tree);
      if (worker.chopTime >= CHOP_TIME) {
        trees = trees.filter((tree) => tree !== worker.tree);
        stumps.push({ x: worker.tree.x, y: worker.tree.y, art: art.stumps[Math.floor(Math.random() * art.stumps.length)] });
        woodCount += 1;
        claimed.delete(worker.tree);
        worker.tree = null;
        worker.chopTime = 0;
      }
    }
  }

  const friendlyTargets = [];
  if (player.hp > 0) friendlyTargets.push({ type: "player", entity: player });
  for (const worker of workers) friendlyTargets.push({ type: "worker", entity: worker });
  for (const guard of defenders) friendlyTargets.push({ type: "defender", entity: guard });
  for (const house of settlements) friendlyTargets.push({ type: "settlement", entity: house });

  for (const raider of raiders) {
    raider.animTime += dt;
    raider.cooldown = Math.max(0, raider.cooldown - dt);
    raider.flash = Math.max(0, raider.flash - dt);
    raider.moving = false;
    const target = raider.target;
    const targetStillExists = target && friendlyTargets.some(
      (item) => item.type === target.type && item.entity === target.entity,
    );
    if (target && (!targetStillExists || distance(raider, target.entity) > ENEMY_LEASH_RADIUS)) {
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
    } else if (raider.cooldown <= 0) {
      const damage = raider.role === "archer" ? 9 : 13;
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
    const threats = raiders.filter((raider) => raider.hp > 0 && distance(raider, guard.house) <= DEFENSE_RADIUS);
    if (!threats.length) continue;
    const enemy = threats.reduce((a, b) => distance(guard, a) < distance(guard, b) ? a : b);
    const range = guard.role === "archer" ? ARCHER_RANGE : 58;
    if (distance(guard, enemy) > range) {
      guard.moving = moveToward(guard, enemy, WORKER_SPEED, dt, range);
    } else if (guard.cooldown <= 0) {
      enemy.hp -= guard.role === "archer" ? 18 : 26;
      guard.cooldown = guard.role === "archer" ? 1.15 : 0.9;
      guard.flash = 0.35;
      if (guard.role === "archer") effects.push({ from: { x: guard.x, y: guard.y }, to: { x: enemy.x, y: enemy.y }, time: 0.16 });
    }
  }

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
  ctx.fillRect(0, 0, viewWidth, viewHeight);

  // Sea texture and gentle wave marks.
  for (let y = Math.floor(camera.y / 64) * 64; y < camera.y + viewHeight + 64; y += 64) {
    for (let x = Math.floor(camera.x / 64) * 64; x < camera.x + viewWidth + 64; x += 64) {
      ctx.drawImage(art.water, x - camera.x, y - camera.y, 64, 64);
    }
  }
  ctx.strokeStyle = "rgba(218,250,232,0.24)";
  ctx.lineWidth = 2;
  for (let y = Math.floor(camera.y / 128) * 128 + 32; y < camera.y + viewHeight + 64; y += 128) {
    for (let x = Math.floor(camera.x / 128) * 128 + 30; x < camera.x + viewWidth + 64; x += 128) {
      const phase = Math.sin(x * 0.017 + y * 0.023);
      ctx.beginPath();
      ctx.moveTo(x - camera.x, y - camera.y);
      ctx.quadraticCurveTo(x + 12 - camera.x, y + phase * 5 - camera.y, x + 25 - camera.x, y - camera.y);
      ctx.stroke();
    }
  }

  // Clip the grass tiles to an irregular island shape.
  ctx.save();
  traceCoastline();
  ctx.clip();
  for (let y = Math.floor(camera.y / TILE_SIZE) * TILE_SIZE; y < camera.y + viewHeight + TILE_SIZE; y += TILE_SIZE) {
    for (let x = Math.floor(camera.x / TILE_SIZE) * TILE_SIZE; x < camera.x + viewWidth + TILE_SIZE; x += TILE_SIZE) {
      ctx.drawImage(art.ground, 64, 64, 64, 64, x - camera.x, y - camera.y, TILE_SIZE, TILE_SIZE);
    }
  }
  ctx.restore();

  // A sandy lip and a thin foam line make the coastline easy to read.
  ctx.save();
  ctx.lineJoin = "round";
  traceCoastline();
  ctx.strokeStyle = "rgba(205,186,122,0.9)";
  ctx.lineWidth = 22;
  ctx.stroke();
  traceCoastline();
  ctx.strokeStyle = "rgba(239,230,177,0.9)";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, viewWidth, viewHeight);
  drawTerrain();

  for (const item of decorations) {
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

  for (const stump of stumps) {
    ctx.drawImage(stump.art.image, stump.x - camera.x - 25, stump.y - camera.y - 43, 50, 68);
  }

  for (const house of settlements) {
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

  for (const house of enemySettlements) {
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
    ctx.globalAlpha = 0.55;
    ctx.drawImage(art.home, mouse.x - HOME_SIZE.width / 2, mouse.y - HOME_SIZE.height, HOME_SIZE.width, HOME_SIZE.height);
    ctx.globalAlpha = 1;
  }

  for (const tree of trees) {
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
    let frames;
    let index;
    if (worker.tree && worker.chopTime > 0) {
      frames = art.workerChop;
      index = Math.min(frames.length - 1, Math.floor(worker.chopTime / CHOP_TIME * frames.length));
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

  for (const guard of defenders) {
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
  } else {
    ctx.fillStyle = "rgba(15,20,18,0.72)";
    ctx.fillRect(viewWidth / 2 - 130, viewHeight / 2 - 28, 260, 56);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "bold 20px system-ui, sans-serif";
    ctx.fillText("Вы потеряли сознание…", viewWidth / 2, viewHeight / 2 + 7);
    ctx.textAlign = "left";
  }

  drawHud();
}

function drawHud() {
  const panelWidth = 142;
  const panelHeight = 52;
  ctx.fillStyle = "rgba(20,25,24,0.82)";
  ctx.fillRect(12, 12, panelWidth, panelHeight);
  ctx.drawImage(art.woodIcon, 20, 19, 36, 36);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 21px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(String(woodCount), 68, 38);
  if (placingHouse) {
    ctx.font = "bold 18px system-ui, sans-serif";
    ctx.fillStyle = "#fff2a8";
    ctx.textAlign = "center";
    ctx.fillText("Щёлкните, чтобы поставить дом · Esc — отмена", viewWidth / 2, viewHeight - 34);
    ctx.textAlign = "left";
  }
  if (player.harvesting) {
    ctx.fillStyle = "#fff2a8";
    ctx.textAlign = "center";
    ctx.fillText("Рубка дерева…", viewWidth / 2, viewHeight - 34);
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
  if (woodCount >= 10) {
    placingHouse = true;
    player.target = null;
  }
}

const lastPointer = { x: 0, y: 0 };
canvas.addEventListener("pointermove", (event) => {
  lastPointer.x = event.clientX;
  lastPointer.y = event.clientY;
});

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const p = pointerPosition(event);
  const world = { x: p.x + camera.x, y: p.y + camera.y };
  if (placingHouse) {
    if (woodCount >= 10 && isLandPoint(world)) {
      addSettlement(world.x, world.y);
      woodCount -= 10;
      placingHouse = false;
    } else if (woodCount < 10) {
      placingHouse = false;
    }
  } else {
    player.target = {
      x: Math.max(LAND_SAFE_MARGIN, Math.min(WORLD_WIDTH - LAND_SAFE_MARGIN, world.x)),
      y: Math.max(LAND_SAFE_MARGIN, Math.min(WORLD_HEIGHT - LAND_SAFE_MARGIN, world.y)),
    };
    markerTime = 0;
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "e") {
    startHarvesting();
  } else if (event.key.toLowerCase() === "h") {
    startBuilding();
  } else if (event.key === "Escape") {
    placingHouse = false;
  } else if (event.key === "F11") {
    event.preventDefault();
    toggleFullscreen();
  }
});

harvestButton.addEventListener("click", startHarvesting);
buildButton.addEventListener("click", startBuilding);

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
  markerTime += dt;
  update(dt);
  draw();
  buildButton.disabled = woodCount < 10;
  requestAnimationFrame(frame);
}

loadAssets().then((loadedArt) => {
  art = loadedArt;
  setupWorld();
  loading.classList.add("hidden");
  requestAnimationFrame(frame);
}).catch((error) => {
  loading.textContent = `${error.message}. Откройте игру через локальный веб-сервер.`;
  console.error(error);
});
