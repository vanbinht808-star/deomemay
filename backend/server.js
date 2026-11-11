const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Server } = require('socket.io');

const rootDirectory = path.resolve(__dirname, '..');
const frontendDirectory = path.join(rootDirectory, 'frontend');
const builtDirectory = path.join(frontendDirectory, 'dist');
const dataFile = path.join(rootDirectory, 'data', 'site.json');
const port = Number(process.env.PORT) || 3000;
const roomName = 'prison-main';
const roomCapacity = 20;
const reconnectGraceMs = 12000;
const updateIntervalMs = 50;
const cellCenters = [7.5, 12.5, 17.5];
const allowedAnimations = new Set(['idle', 'walk', 'run', 'jump', 'fall', 'crouch', 'sleep', 'toilet']);
const allowedOffenses = new Set([
  'Trộm cắp',
  'Đánh nhau',
  'Buôn lậu',
  'Phá hoại tài sản',
  'Vượt ngục',
  'Cướp tài sản',
  'Vi phạm nội quy nhà tù',
]);
const players = new Map();
let nextInmateNumber = 1;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
};

const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  try {
    if (pathname === '/api/site') {
      const siteData = await fs.readFile(dataFile, 'utf8');
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(siteData);
      return;
    }

    const legacyFiles = {
      '/style.css': path.join(frontendDirectory, 'style.css'),
      '/script.js': path.join(frontendDirectory, 'script.js'),
    };
    const requestedFile = legacyFiles[pathname]
      || path.resolve(builtDirectory, `.${pathname === '/' ? '/index.html' : pathname}`);
    const isLegacyFile = Object.hasOwn(legacyFiles, pathname);
    const isInsideBuild = requestedFile.startsWith(`${builtDirectory}${path.sep}`)
      || requestedFile === path.join(builtDirectory, 'index.html');

    if (!isLegacyFile && !isInsideBuild) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Không được phép truy cập tệp này.');
      return;
    }

    const fileContent = await fs.readFile(requestedFile);
    const contentType = contentTypes[path.extname(requestedFile)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': contentType });
    response.end(fileContent);
  } catch (error) {
    if (error.code === 'ENOENT') {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Không tìm thấy trang.');
      return;
    }

    console.error(error);
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Máy chủ gặp lỗi khi xử lý yêu cầu.');
  }
});

const io = new Server(server, {
  maxHttpBufferSize: 16_384,
  pingInterval: 10000,
  pingTimeout: 8000,
});

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    inmateCode: player.inmateCode,
    age: player.profile.age,
    offense: player.profile.offense,
    reason: player.profile.reason,
    position: player.position,
    yaw: player.yaw,
    animation: player.animation,
    area: player.area,
    appearance: player.appearance,
    connected: player.connected,
  };
}

function sanitizeProfile(profile) {
  const rawName = typeof profile?.name === 'string' ? profile.name : '';
  const name = rawName.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 28);
  const ageValue = Number(profile?.age);
  const age = Number.isInteger(ageValue) && ageValue >= 18 && ageValue <= 99 ? ageValue : 25;
  const rawOffense = typeof profile?.offense === 'string'
    ? profile.offense.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 60)
    : '';
  const offense = allowedOffenses.has(rawOffense) ? rawOffense : rawOffense || 'Vi phạm nội quy nhà tù';
  const rawReason = typeof profile?.reason === 'string' ? profile.reason : '';
  const reason = rawReason.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 140);
  return {
    name: name || 'Tù nhân mới',
    age,
    offense,
    reason: reason || 'Hồ sơ nhập vai ban đầu.',
  };
}

function activePlayerCount() {
  let count = 0;
  for (const player of players.values()) {
    if (player.connected) count += 1;
  }
  return count;
}

function allocateSpawn() {
  for (let slot = 0; slot < roomCapacity; slot += 1) {
    const column = slot % 5;
    const row = Math.floor(slot / 5);
    const spawn = { x: -8 + column * 4, y: 0.86, z: 24 + row * 3.5 };
    const occupied = [...players.values()].some((player) => (
      Math.hypot(player.position.x - spawn.x, player.position.z - spawn.z) < 1.6
    ));
    if (!occupied) return spawn;
  }
  return { x: 0, y: 0.86, z: 24 };
}

function getArea(position) {
  if (position.z >= 20) return 'yard';
  if (Math.abs(position.x) <= 3.2) return 'corridor';
  return 'cell-block';
}

function areaRoom(area) {
  return `${roomName}:${area}`;
}

function validPosition(value) {
  return value
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.z)
    && Math.abs(value.x) <= 13.3
    && value.y >= 0.15
    && value.y <= 9
    && value.z >= 5.5
    && value.z <= 39.3
    && isWalkablePosition(value);
}

function isWalkablePosition(position) {
  if (position.z >= 20) return Math.abs(position.x) <= 13.3;
  if (position.z < 5.5 || position.z >= 20) return false;
  if (Math.abs(position.x) <= 3.2) return true;

  const cellCenter = cellCenters.find((center) => Math.abs(position.z - center) <= 1.8);
  if (cellCenter === undefined || Math.abs(position.x) > 9.1) return false;
  if (Math.abs(position.x) < 6) return Math.abs(position.z - cellCenter) <= 0.85;
  return true;
}

function cellIndex(position) {
  if (Math.abs(position.x) < 6 || Math.abs(position.x) > 9.5) return null;
  const index = cellCenters.findIndex((center) => Math.abs(position.z - center) <= 1.8);
  if (index < 0) return null;
  return index;
}

function isCellInteractionMove(current, position, animation) {
  const currentCell = cellIndex(current.position);
  const targetCell = cellIndex(position);
  if (currentCell === null || currentCell !== targetCell) return false;

  const enteringBed = animation === 'sleep'
    && current.position.y <= 1.25
    && Math.abs(position.x) >= 7.6
    && Math.abs(position.x) <= 8.8
    && position.y >= 0.55
    && position.y <= 2.2;
  const leavingInteraction = ['sleep', 'toilet'].includes(current.animation)
    && !['sleep', 'toilet'].includes(animation)
    && Math.abs(position.x) >= 6.2
    && Math.abs(position.x) <= 7.8
    && position.y >= 0.6
    && position.y <= 1.2;
  return enteringBed || leavingInteraction;
}

function emitCount() {
  io.to(roomName).emit('players:count', { count: activePlayerCount(), capacity: roomCapacity });
}

function removePlayer(player) {
  if (!players.has(player.id) || player.connected) return;
  if (player.cleanupTimer) clearTimeout(player.cleanupTimer);
  players.delete(player.id);
  io.to(areaRoom(player.area)).emit('player:left', { id: player.id });
  emitCount();
}

io.on('connection', (socket) => {
  const requestedToken = socket.handshake.auth?.sessionToken;
  const hasSubmittedProfile = socket.handshake.auth?.profile && typeof socket.handshake.auth.profile === 'object';
  const requestedProfile = sanitizeProfile(socket.handshake.auth?.profile);
  let player = typeof requestedToken === 'string'
    ? [...players.values()].find((candidate) => candidate.sessionToken === requestedToken && !candidate.connected)
    : null;

  if (!player && players.size >= roomCapacity) {
    socket.emit('session:error', { message: 'Phiên nhà tù đã đủ 20 người.' });
    socket.disconnect(true);
    return;
  }

  const isReconnect = Boolean(player);
  if (player) {
    if (player.cleanupTimer) clearTimeout(player.cleanupTimer);
    player.cleanupTimer = null;
    player.connected = true;
    player.socketId = socket.id;
    player.lastAcceptedAt = Date.now();
    if (hasSubmittedProfile) {
      player.profile = requestedProfile;
      player.name = requestedProfile.name;
    }
  } else {
    const id = randomUUID();
    player = {
      id,
      sessionToken: randomUUID(),
      socketId: socket.id,
      name: requestedProfile.name,
      inmateCode: `PR${String(nextInmateNumber).padStart(3, '0')}`,
      profile: requestedProfile,
      position: allocateSpawn(),
      yaw: 0,
      animation: 'idle',
      area: 'yard',
      appearance: { uniform: 'burnt-orange', hair: 'short-dark' },
      connected: true,
      lastAcceptedAt: Date.now(),
      lastSocketUpdateAt: 0,
      cleanupTimer: null,
    };
    nextInmateNumber += 1;
    players.set(id, player);
  }

  socket.data.playerId = player.id;
  socket.join(roomName);
  socket.join(areaRoom(player.area));
  socket.emit('session:welcome', {
    player: publicPlayer(player),
    sessionToken: player.sessionToken,
    players: [...players.values()]
      .filter((candidate) => candidate.id !== player.id && candidate.area === player.area)
      .map(publicPlayer),
    count: activePlayerCount(),
    capacity: roomCapacity,
    reconnectGraceMs,
    reconnected: isReconnect,
  });

  if (isReconnect) {
    socket.to(areaRoom(player.area)).emit('player:reconnected', publicPlayer(player));
    socket.to(areaRoom(player.area)).emit('player:state', publicPlayer(player));
  } else {
    socket.to(areaRoom(player.area)).emit('player:joined', publicPlayer(player));
  }
  emitCount();

  socket.on('player:state', (payload) => {
    const current = players.get(socket.data.playerId);
    if (!current || !current.connected || current.socketId !== socket.id || !payload || typeof payload !== 'object') return;

    const now = Date.now();
    if (now - current.lastSocketUpdateAt < updateIntervalMs) return;
    current.lastSocketUpdateAt = now;

    if (!validPosition(payload.position) || !Number.isFinite(payload.yaw)) {
      socket.emit('player:correction', publicPlayer(current));
      return;
    }

    const animation = allowedAnimations.has(payload.animation) ? payload.animation : 'idle';
    const elapsed = Math.min(Math.max((now - current.lastAcceptedAt) / 1000, 0), 0.5);
    const dx = payload.position.x - current.position.x;
    const dz = payload.position.z - current.position.z;
    const horizontalDistance = Math.hypot(dx, dz);
    const speedLimit = animation === 'run' ? 7.2 : animation === 'crouch' ? 2.2 : 4.1;
    const interactionMove = isCellInteractionMove(current, payload.position, animation);
    const maxDistance = interactionMove ? 2.6 : Math.max(0.42, speedLimit * elapsed + 0.28);
    const maxVerticalDistance = interactionMove ? 1.8 : Math.max(0.75, 8.5 * elapsed + 0.25);

    if (horizontalDistance > maxDistance || Math.abs(payload.position.y - current.position.y) > maxVerticalDistance) {
      socket.emit('player:correction', publicPlayer(current));
      return;
    }

    const yaw = ((payload.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const previousArea = current.area;
    const area = getArea(payload.position);
    const changed = horizontalDistance > 0.015
      || Math.abs(payload.position.y - current.position.y) > 0.015
      || Math.abs(yaw - current.yaw) > 0.015
      || animation !== current.animation
      || area !== current.area;

    if (!changed) return;
    current.position = {
      x: payload.position.x,
      y: payload.position.y,
      z: payload.position.z,
    };
    current.yaw = yaw;
    current.animation = animation;
    current.area = area;
    current.lastAcceptedAt = now;
    if (previousArea !== area) {
      socket.leave(areaRoom(previousArea));
      socket.join(areaRoom(area));
      socket.to(areaRoom(previousArea)).emit('player:left', { id: current.id });
      socket.to(areaRoom(area)).emit('player:joined', publicPlayer(current));
    } else {
      socket.to(areaRoom(area)).volatile.emit('player:state', publicPlayer(current));
    }
  });

  socket.on('disconnect', () => {
    const current = players.get(socket.data.playerId);
    if (!current || current.socketId !== socket.id) return;
    current.connected = false;
    current.cleanupTimer = setTimeout(() => removePlayer(current), reconnectGraceMs);
    io.to(areaRoom(current.area)).emit('player:disconnected', { id: current.id, graceMs: reconnectGraceMs });
    emitCount();
  });
});

server.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});