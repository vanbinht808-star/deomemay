import * as THREE from 'three';
import { buildCell } from './Cell.js';
import { buildCorridor, CELL_CENTERS } from './Corridor.js';
import { buildYard } from './Yard.js';

function makeConcreteTexture(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < 1100; index += 1) {
    const shade = Math.random() > 0.5 ? 255 : 0;
    context.globalAlpha = Math.random() * 0.11;
    context.fillStyle = `rgb(${shade},${shade},${shade})`;
    context.fillRect(Math.random() * 128, Math.random() * 128, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

export function buildPrison(scene, physics) {
  const concreteTexture = makeConcreteTexture('#7b807b');
  const floorTexture = makeConcreteTexture('#565c59');
  const materials = {
    concrete: new THREE.MeshStandardMaterial({ map: concreteTexture, color: '#c4c0b5', roughness: 0.96 }),
    concretePanel: new THREE.MeshStandardMaterial({ color: '#918c80', roughness: 0.92 }),
    floor: new THREE.MeshStandardMaterial({ map: floorTexture, color: '#a4a198', roughness: 0.96 }),
    yardFloor: new THREE.MeshStandardMaterial({ map: floorTexture, color: '#858a82', roughness: 0.97 }),
    metal: new THREE.MeshStandardMaterial({ color: '#626b67', metalness: 0.72, roughness: 0.42 }),
    gate: new THREE.MeshStandardMaterial({ color: '#3e4844', metalness: 0.72, roughness: 0.48 }),
    bedding: new THREE.MeshStandardMaterial({ color: '#737c77', roughness: 0.9 }),
    sheet: new THREE.MeshStandardMaterial({ color: '#b3ad9c', roughness: 1 }),
    porcelain: new THREE.MeshStandardMaterial({ color: '#bab9ad', roughness: 0.4 }),
    toiletWater: new THREE.MeshStandardMaterial({ color: '#71817a', roughness: 0.24, metalness: 0.04 }),
    wood: new THREE.MeshStandardMaterial({ color: '#6f5842', roughness: 0.9 }),
    light: new THREE.MeshStandardMaterial({ color: '#cbbd91', metalness: 0.25, roughness: 0.45 }),
    glow: new THREE.MeshStandardMaterial({ color: '#ffe2a5', emissive: '#e2a958', emissiveIntensity: 1.6, roughness: 0.55 }),
    windowGlass: new THREE.MeshStandardMaterial({ color: '#52636a', emissive: '#27363a', emissiveIntensity: 0.35, roughness: 0.3 }),
  };
  const occluders = [];
  const doors = [];
  const interactables = [];

  const addBox = (size, position, material, options = {}) => {
    const [width, height, depth] = size;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (options.visible !== false) scene.add(mesh);
    if (options.collide !== false) {
      mesh.userData.physicsCollider = physics.addFixedBox(
        { x: position[0], y: position[1], z: position[2] },
        { x: width, y: height, z: depth },
      );
    }
    if (options.visible !== false && options.blocker !== false && material !== materials.glow) occluders.push(mesh);
    return mesh;
  };

  const addMesh = (geometry, position, material, options = {}) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (options.blocker !== false) occluders.push(mesh);
    return mesh;
  };

  const addDoor = ({ side, centerZ, width, number }) => {
    const group = new THREE.Group();
    group.name = `CellDoor${number}`;
    group.position.set(side * 3.5, 0, centerZ - width / 2);
    const doorMaterial = new THREE.MeshStandardMaterial({ color: '#414c48', metalness: 0.72, roughness: 0.46 });
    const addDoorBar = (size, position, name) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(...size), doorMaterial);
      bar.name = name;
      bar.position.set(...position);
      bar.castShadow = true;
      bar.receiveShadow = true;
      group.add(bar);
      occluders.push(bar);
    };

    addDoorBar([0.12, 2.55, 0.1], [0, 1.28, 0.04], 'HingeStile');
    addDoorBar([0.12, 2.55, 0.1], [0, 1.28, width - 0.04], 'LatchStile');
    addDoorBar([0.12, 0.12, width], [0, 2.53, width / 2], 'DoorTopRail');
    addDoorBar([0.12, 0.12, width], [0, 0.08, width / 2], 'DoorBottomRail');
    addDoorBar([0.13, 0.08, width], [0, 1.22, width / 2], 'DoorCrossbar');
    for (let index = 1; index <= 5; index += 1) {
      addDoorBar([0.055, 2.42, 0.055], [0, 1.28, (width / 6) * index], `DoorBar${index}`);
    }
    addDoorBar([0.18, 0.08, 0.04], [-side * 0.11, 1.25, width - 0.18], 'DoorHandle');
    scene.add(group);
    const collider = physics.addFixedBox(
      { x: side * 3.5, y: 1.32, z: centerZ },
      { x: 0.2, y: 2.64, z: width },
    );
    const door = {
      group,
      center: new THREE.Vector3(side * 3.5, 1.2, centerZ),
      side,
      number,
      width,
      open: false,
      progress: 0,
      collider,
      material: doorMaterial,
    };
    doors.push(door);
    return door;
  };

  const builder = { addBox, addMesh, addDoor, materials };
  buildCorridor(builder);
  buildYard(builder);
  let number = 1;
  for (const centerZ of CELL_CENTERS) {
    for (const side of [-1, 1]) {
      interactables.push(...buildCell(builder, side, centerZ, number).interactables);
      number += 1;
    }
  }
  return { cameraOccluders: occluders, doors, interactables };
}