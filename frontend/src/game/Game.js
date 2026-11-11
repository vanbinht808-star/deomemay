import * as THREE from 'three';
import { CameraRig } from './CameraRig.js';
import { DoorSystem } from './DoorSystem.js';
import { Input } from './Input.js';
import { MultiplayerClient } from './MultiplayerClient.js';
import { Physics } from './Physics.js';
import { createNameTag, RemotePlayer } from './RemotePlayer.js';
import { Player } from '../player/Player.js';
import { PlayerController } from '../player/PlayerController.js';
import { World } from './World.js';

export class Game {
  static async create(canvas, onStateChange, onInspectProfile) {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch {
      throw new Error('Không thể tạo WebGL context. Hãy bật tăng tốc phần cứng hoặc dùng Chrome/Edge phiên bản mới.');
    }
    const physics = await Physics.create();
    return new Game(canvas, renderer, physics, onStateChange, onInspectProfile);
  }

  constructor(canvas, renderer, physics, onStateChange, onInspectProfile) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.physics = physics;
    this.onStateChange = onStateChange;
    this.onInspectProfile = onInspectProfile;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
    this.playerRaycaster = new THREE.Raycaster();
    this.playerRay = new THREE.Vector2(0, 0);
    this.clock = new THREE.Clock();
    this.input = new Input();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.world = new World(this.scene, physics);
    this.player = new Player(this.scene);
    this.playerController = new PlayerController(physics, this.input, this.player, { x: 0, y: 0.86, z: 18.5 });
    this.cameraRig = new CameraRig(this.camera, canvas, this.world.cameraOccluders);
    this.doorSystem = new DoorSystem(
      this.world.doors,
      this.world.interactables,
      physics,
      document.querySelector('#interaction-hint'),
      this.playerController,
    );
    this.remotePlayers = new Map();
    this.localPlayerId = null;
    this.localNameTag = null;
    this.onlineCount = 0;
    this.roomCapacity = 20;
    this.multiplayer = new MultiplayerClient({
      onStatus: (status) => this.updateNetworkStatus(status),
      onWelcome: (welcome) => this.handleWelcome(welcome),
      onJoined: (snapshot) => this.upsertRemotePlayer(snapshot),
      onState: (snapshot) => this.handleRemoteState(snapshot),
      onDisconnected: (event) => this.remotePlayers.get(event.id)?.setConnected(false),
      onLeft: (playerId) => this.removeRemotePlayer(playerId),
      onCount: (event) => this.updatePlayerCount(event.count, event.capacity),
      onCorrection: (snapshot) => {
        if (snapshot.id === this.localPlayerId) this.playerController.applyServerState(snapshot);
      },
      onError: (message) => this.updateNetworkStatus('error', message),
    });
    this.state = 'menu';
    this.hasStarted = false;

    this.handleResize = () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    };
    this.handleResize();
    this.handlePointerLock = () => {
      if (this.hasStarted && this.state === 'playing' && document.pointerLockElement !== this.canvas) {
        this.pause();
      }
    };
    this.handleEscape = (event) => {
      if (event.code !== 'Escape' || this.state !== 'playing') return;
      event.preventDefault();
      this.pause();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    };
    this.handleCursorToggle = (event) => {
      if (!['ControlLeft', 'ControlRight'].includes(event.code) || event.repeat || !this.hasStarted) return;
      event.preventDefault();
      if (this.state === 'playing') {
        this.pause();
        if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      } else if (this.state === 'paused') {
        this.play();
      }
    };
    this.handleCanvasClick = () => {
      if (!this.hasStarted || this.state !== 'playing') return;
      if (document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock?.();
        return;
      }

      this.playerRaycaster.setFromCamera(this.playerRay, this.camera);
      const candidates = [...this.remotePlayers.values()];
      const hit = this.playerRaycaster.intersectObjects(candidates.map((remote) => remote.player.model), true)[0];
      if (!hit) return;
      const selected = candidates.find((remote) => remote.player.model.getObjectById(hit.object.id));
      if (!selected) return;

      this.pause();
      document.exitPointerLock?.();
      this.onInspectProfile?.(selected.getProfile());
    };
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleEscape);
    window.addEventListener('keydown', this.handleCursorToggle);
    document.addEventListener('pointerlockchange', this.handlePointerLock);
    canvas.addEventListener('click', this.handleCanvasClick);
    this.setState('menu');
    this.animate();
  }

  async enterPrison(profile) {
    await this.multiplayer.connect(profile);
    this.play();
  }

  handleWelcome(welcome) {
    this.localPlayerId = welcome.player.id;
    this.playerController.applyServerState(welcome.player);
    this.updatePlayerCount(welcome.count, welcome.capacity);
    const visiblePlayerIds = new Set(welcome.players.map((snapshot) => snapshot.id));
    for (const playerId of this.remotePlayers.keys()) {
      if (!visiblePlayerIds.has(playerId)) this.removeRemotePlayer(playerId);
    }
    if (this.localNameTag) {
      this.localNameTag.removeFromParent();
      this.localNameTag.material.map?.dispose();
      this.localNameTag.material.dispose();
    }
    this.localNameTag = createNameTag(welcome.player.name, welcome.player.inmateCode);
    this.scene.add(this.localNameTag);
    for (const snapshot of welcome.players) this.upsertRemotePlayer(snapshot);
  }

  upsertRemotePlayer(snapshot) {
    if (snapshot.id === this.localPlayerId) return;
    let remote = this.remotePlayers.get(snapshot.id);
    if (!remote) {
      remote = new RemotePlayer(this.scene, snapshot);
      this.remotePlayers.set(snapshot.id, remote);
    } else {
      remote.updateState(snapshot);
    }
  }

  handleRemoteState(snapshot) {
    if (snapshot.id === this.localPlayerId) return;
    this.upsertRemotePlayer(snapshot);
  }

  removeRemotePlayer(playerId) {
    const remote = this.remotePlayers.get(playerId);
    if (!remote) return;
    remote.destroy();
    this.remotePlayers.delete(playerId);
  }

  updatePlayerCount(count, capacity = this.roomCapacity) {
    this.onlineCount = count;
    this.roomCapacity = capacity;
    const countElement = document.querySelector('#online-count');
    if (countElement) countElement.textContent = `${count}/${capacity}`;
  }

  updateNetworkStatus(status, message) {
    const statusElement = document.querySelector('#network-label');
    const indicator = document.querySelector('#network-indicator');
    if (!statusElement || !indicator) return;
    const labels = {
      connecting: 'ĐANG KẾT NỐI',
      connected: 'TRỰC TUYẾN',
      reconnecting: 'ĐANG KẾT NỐI LẠI',
      error: message || 'PHIÊN ĐẦY',
    };
    statusElement.textContent = labels[status] || labels.connecting;
    indicator.dataset.state = status;
  }

  setState(state) {
    this.state = state;
    this.input.enabled = state === 'playing';
    if (state !== 'playing') this.input.clear();
    this.onStateChange(state);
  }

  play() {
    this.hasStarted = true;
    this.setState('playing');
    this.canvas.requestPointerLock?.();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.setState('paused');
  }

  returnToMenu() {
    this.hasStarted = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.setState('menu');
  }

  animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (this.state === 'playing') {
      this.playerController.update(delta, this.cameraRig.yaw);
      this.doorSystem.update(delta, this.playerController.getPosition(), this.input);
    } else {
      this.playerController.updateIdle(delta);
    }
    const animation = this.playerController.interaction?.animation
      || (this.state === 'playing' ? this.playerController.animation : 'idle');
    this.multiplayer.update(delta, {
      position: this.playerController.getPosition(),
      yaw: this.playerController.yaw,
      animation,
    });
    for (const remote of this.remotePlayers.values()) remote.update(delta);
    if (this.localNameTag) {
      const position = this.playerController.getPosition();
      this.localNameTag.position.set(position.x, position.y + 2.12, position.z);
      this.localNameTag.visible = this.state !== 'menu';
    }
    this.cameraRig.update(this.playerController.getPosition(), delta);
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleEscape);
    window.removeEventListener('keydown', this.handleCursorToggle);
    document.removeEventListener('pointerlockchange', this.handlePointerLock);
    this.canvas.removeEventListener('click', this.handleCanvasClick);
    this.multiplayer.destroy();
    for (const remote of this.remotePlayers.values()) remote.destroy();
    this.remotePlayers.clear();
    if (this.localNameTag) {
      this.localNameTag.material.map?.dispose();
      this.localNameTag.material.dispose();
      this.localNameTag.removeFromParent();
    }
    this.player.destroy();
    this.renderer.dispose();
    this.physics.destroy();
  }
}