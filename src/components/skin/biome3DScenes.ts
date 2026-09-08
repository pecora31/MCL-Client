import * as THREE from 'three';

export interface Biome3DConfig {
  id: string;
  nameKey: string;
  defaultName: string;
  tagline: string;
  icon: string;
  accentColor: string;
  skyGradient: string;
  skyFogColor: number;
  ambientSpotlight: string;
  ambientColor: number;
  ambientIntensity: number;
  sunColor: number;
  sunIntensity: number;
  sunPosition?: [number, number, number];
  buildScene: () => {
    group: THREE.Group;
    update?: (delta: number) => void;
  };
}

// -------------------------------------------------------------
// Texture Cache with NearestFilter for authentic Minecraft pixel-art
// -------------------------------------------------------------
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();

function getBlockTexture(name: string): THREE.Texture {
  if (textureCache.has(name)) {
    return textureCache.get(name)!;
  }
  const tex = textureLoader.load(`/minecraft_assets/assets/minecraft/textures/block/${name}`);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  textureCache.set(name, tex);
  return tex;
}

// Multi-sided Minecraft block materials with optional biome tinting & standard PBR response
function createBlockMaterial(
  topTex: string,
  sideTex: string = topTex,
  bottomTex: string = sideTex,
  topTintColor?: string
): THREE.Material[] {
  const topMat = new THREE.MeshStandardMaterial({
    map: getBlockTexture(topTex),
    color: topTintColor ? new THREE.Color(topTintColor) : 0xffffff,
    roughness: 0.85,
    metalness: 0.0,
  });
  const sideMat = new THREE.MeshStandardMaterial({
    map: getBlockTexture(sideTex),
    roughness: 0.85,
    metalness: 0.0,
  });
  const botMat = new THREE.MeshStandardMaterial({
    map: getBlockTexture(bottomTex),
    roughness: 0.85,
    metalness: 0.0,
  });
  return [sideMat, sideMat, topMat, botMat, sideMat, sideMat];
}

const BOX_GEO = new THREE.BoxGeometry(16, 16, 16);

function createBlock(
  materials: THREE.Material | THREE.Material[],
  x: number,
  y: number,
  z: number
): THREE.Mesh {
  const mesh = new THREE.Mesh(BOX_GEO, materials);
  mesh.position.set(x, y, z);
  return mesh;
}

// Double-sided crossed planes for Minecraft flowers & tall grass (X shape)
function createCrossPlant(
  textureName: string,
  x: number,
  y: number,
  z: number,
  size: number = 14
): THREE.Group {
  const group = new THREE.Group();
  const tex = getBlockTexture(textureName);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    roughness: 0.8,
    metalness: 0.0,
  });
  const geo = new THREE.PlaneGeometry(size, size);

  const p1 = new THREE.Mesh(geo, mat);
  p1.rotation.y = Math.PI / 4;
  p1.position.y = size / 2;

  const p2 = new THREE.Mesh(geo, mat);
  p2.rotation.y = -Math.PI / 4;
  p2.position.y = size / 2;

  group.add(p1, p2);
  group.position.set(x, y, z);
  return group;
}

// Flat decal lying on top of a block (like pink petals carpets)
function createFlatDecal(
  textureName: string,
  x: number,
  y: number,
  z: number,
  size: number = 14
): THREE.Mesh {
  const tex = getBlockTexture(textureName);
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.5,
    roughness: 0.8,
    metalness: 0.0,
  });
  const geo = new THREE.PlaneGeometry(size, size);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, y + 0.1, z);
  return mesh;
}

// Minecraft hanging 3D lantern with real point light
function createLantern(x: number, y: number, z: number, color: number = 0xffa726): THREE.Group {
  const group = new THREE.Group();
  const tex = getBlockTexture('lantern.png');
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.8,
    roughness: 0.5,
    metalness: 0.1,
  });
  const geo = new THREE.PlaneGeometry(8, 11);

  const p1 = new THREE.Mesh(geo, mat);
  p1.position.y = 5.5;
  const p2 = new THREE.Mesh(geo, mat);
  p2.rotation.y = Math.PI / 2;
  p2.position.y = 5.5;

  group.add(p1, p2);

  const light = new THREE.PointLight(color, 2.5, 45);
  light.position.y = 6;
  group.add(light);

  group.position.set(x, y, z);
  return group;
}

// Ground contact shadow plane right below Steve's boots (at y = -16.85)
function createContactShadow(): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 58);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.65)');
    gradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.35)');
    gradient.addColorStop(0.8, 'rgba(0, 0, 0, 0.1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }

  const tex = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(24, 16);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, -16.85, 0);
  return mesh;
}

// -------------------------------------------------------------
// MINECRAFT SQUARE SUN & VOLUMETRIC 3D CLOUDS
// -------------------------------------------------------------
function createMinecraftSun(color: number = 0xfffbeb, x = 18, y = 34, z = -75): THREE.Group {
  const group = new THREE.Group();
  const sunGeo = new THREE.PlaneGeometry(20, 20);
  const sunMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);

  const haloGeo = new THREE.PlaneGeometry(54, 54);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 60);
    grad.addColorStop(0, 'rgba(255, 255, 230, 0.9)');
    grad.addColorStop(0.35, 'rgba(255, 220, 110, 0.4)');
    grad.addColorStop(0.7, 'rgba(255, 180, 60, 0.15)');
    grad.addColorStop(1, 'rgba(255, 150, 30, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const haloTex = new THREE.CanvasTexture(canvas);
  const haloMat = new THREE.MeshBasicMaterial({
    map: haloTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.position.z = -0.2;
  group.add(haloMesh, sunMesh);

  group.position.set(x, y, z);
  return group;
}

// Minecraft Square Moon for night scenes
function createMinecraftMoon(x = 18, y = 34, z = -75): THREE.Group {
  const group = new THREE.Group();
  const moonGeo = new THREE.PlaneGeometry(18, 18);
  const moonMat = new THREE.MeshBasicMaterial({
    color: 0xf1f5f9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const moonMesh = new THREE.Mesh(moonGeo, moonMat);

  const haloGeo = new THREE.PlaneGeometry(48, 48);
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 56);
    grad.addColorStop(0, 'rgba(224, 242, 254, 0.85)');
    grad.addColorStop(0.4, 'rgba(186, 230, 253, 0.35)');
    grad.addColorStop(0.8, 'rgba(125, 211, 252, 0.1)');
    grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
  }
  const haloTex = new THREE.CanvasTexture(canvas);
  const haloMat = new THREE.MeshBasicMaterial({
    map: haloTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.position.z = -0.2;
  group.add(haloMesh, moonMesh);

  group.position.set(x, y, z);
  return group;
}

// Drifting 3D Minecraft cloud slabs framed in the visible sky
function createMinecraftClouds(y = 33, z = -55): { group: THREE.Group; update: (delta: number) => void } {
  const group = new THREE.Group();
  const cloudMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });

  const slabs = [
    { w: 42, h: 5, d: 24, x: -35, y: 0, z: -10 },
    { w: 52, h: 6, d: 28, x: 12, y: 2, z: 6 },
    { w: 36, h: 5, d: 20, x: -8, y: -1, z: 16 },
    { w: 46, h: 6, d: 26, x: 45, y: 1, z: -8 },
    { w: 34, h: 5, d: 22, x: -62, y: 0, z: 4 },
  ];

  for (const s of slabs) {
    const geo = new THREE.BoxGeometry(s.w, s.h, s.d);
    const mesh = new THREE.Mesh(geo, cloudMat);
    mesh.position.set(s.x, s.y, s.z);
    group.add(mesh);
  }

  group.position.set(0, y, z);

  const update = (delta: number) => {
    for (const child of group.children) {
      child.position.x += delta * 3.8;
      if (child.position.x > 75) {
        child.position.x = -75;
      }
    }
  };

  return { group, update };
}

// -------------------------------------------------------------
// MINECRAFT TREE GENERATOR (Oak, Birch, Cherry, Spruce)
// -------------------------------------------------------------
function createMinecraftTree(
  type: 'oak' | 'birch' | 'cherry' | 'spruce',
  x: number,
  z: number,
  height: number = 4
): THREE.Group {
  const group = new THREE.Group();
  let logMat: THREE.Material[];
  let leafTex: string;
  let leafTint: string;

  if (type === 'birch') {
    logMat = createBlockMaterial('birch_log_top.png', 'birch_log.png', 'birch_log_top.png');
    leafTex = 'birch_leaves.png';
    leafTint = '#82be3a';
  } else if (type === 'cherry') {
    logMat = createBlockMaterial('cherry_log_top.png', 'cherry_log.png', 'cherry_log_top.png');
    leafTex = 'cherry_leaves.png';
    leafTint = '#fca5d5';
  } else if (type === 'spruce') {
    logMat = createBlockMaterial('spruce_log_top.png', 'spruce_log.png', 'spruce_log_top.png');
    leafTex = 'spruce_leaves.png';
    leafTint = '#3b6d2b';
  } else {
    logMat = createBlockMaterial('oak_log_top.png', 'oak_log.png', 'oak_log_top.png');
    leafTex = 'oak_leaves.png';
    leafTint = '#5ebd32';
  }

  const leafMat = new THREE.MeshStandardMaterial({
    map: getBlockTexture(leafTex),
    color: new THREE.Color(leafTint),
    transparent: true,
    alphaTest: 0.45,
    roughness: 0.85,
    metalness: 0.0,
  });

  // Trunk
  for (let i = 0; i < height; i++) {
    group.add(createBlock(logMat, 0, -9 + i * 16, 0));
  }

  // Canopy
  const canopyY = -9 + (height - 1) * 16;
  if (type === 'spruce') {
    // Multi-tiered tapered spruce
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        group.add(createBlock(leafMat, dx * 16, canopyY, dz * 16));
      }
    }
    group.add(createBlock(leafMat, 0, canopyY + 16, 0));
    group.add(createBlock(leafMat, 0, canopyY + 32, 0));
  } else if (type === 'cherry') {
    // Curved branch canopy
    group.add(createBlock(logMat, -8, canopyY + 12, 0));
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        group.add(createBlock(leafMat, -8 + dx * 16, canopyY + 12, dz * 16));
      }
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        group.add(createBlock(leafMat, -8 + dx * 16, canopyY + 28, dz * 16));
      }
    }
  } else {
    // 5x5 Lower canopy with rounded corners
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        group.add(createBlock(leafMat, dx * 16, canopyY, dz * 16));
      }
    }
    // 3x3 Upper canopy with cross top
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        group.add(createBlock(leafMat, dx * 16, canopyY + 16, dz * 16));
      }
    }
    group.add(createBlock(leafMat, 0, canopyY + 32, 0));
  }

  group.position.set(x, 0, z);
  return group;
}

// -------------------------------------------------------------
// Atmospheric Micro-Particles
// -------------------------------------------------------------
function createParticleTexture(type: 'petal' | 'glow' | 'snow' | 'pollen' | 'ember'): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    if (type === 'petal') {
      ctx.fillStyle = '#fca5d5';
      ctx.beginPath();
      ctx.ellipse(16, 16, 11, 6, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'glow') {
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 14);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.4, 'rgba(110, 231, 183, 0.85)');
      grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 32);
    } else if (type === 'ember') {
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 14);
      grad.addColorStop(0, 'rgba(255, 240, 150, 1)');
      grad.addColorStop(0.45, 'rgba(249, 115, 22, 0.85)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 32);
    } else if (type === 'pollen') {
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 10);
      grad.addColorStop(0, 'rgba(254, 240, 138, 0.95)');
      grad.addColorStop(0.6, 'rgba(250, 204, 21, 0.6)');
      grad.addColorStop(1, 'rgba(250, 204, 21, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 32);
    } else {
      const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 12);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      grad.addColorStop(0.6, 'rgba(224, 242, 254, 0.7)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 32, 32);
    }
  }
  return new THREE.CanvasTexture(canvas);
}

function createAtmosphericParticles(
  count: number,
  type: 'petal' | 'glow' | 'snow' | 'pollen' | 'ember',
  size: number,
  area: { x: number; y: number; z: number },
  vy: number,
  vxSpeed: number = 0.5
) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * area.x;
    pos[i * 3 + 1] = (Math.random() - 0.5) * area.y + 5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * area.z - 15;
    phases[i] = Math.random() * Math.PI * 2;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const tex = createParticleTexture(type);
  const mat = new THREE.PointsMaterial({
    map: tex,
    size,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    blending: type === 'snow' ? THREE.NormalBlending : THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);

  const update = (delta: number) => {
    const p = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      phases[i] += delta * vxSpeed;
      p[i * 3 + 1] += vy * delta * 15;
      p[i * 3] += Math.sin(phases[i]) * delta * 4;

      if (vy < 0 && p[i * 3 + 1] < -16) {
        p[i * 3 + 1] = area.y / 2 + 10;
        p[i * 3] = (Math.random() - 0.5) * area.x;
      } else if (vy > 0 && p[i * 3 + 1] > area.y / 2 + 15) {
        p[i * 3 + 1] = -14;
        p[i * 3] = (Math.random() - 0.5) * area.x;
      }
    }
    geo.attributes.position.needsUpdate = true;
  };

  return { points, update };
}

// -------------------------------------------------------------
// EXPANSIVE CONTINUOUS TERRAIN BUILDER
// Builds a seamless 17x17 grid (272x272 units) of genuine Minecraft blocks
// Top surface sits flush at y = -17.0 meeting Steve's boots perfectly
// -------------------------------------------------------------
function buildExpansiveTerrain(
  primaryMat: THREE.Material | THREE.Material[],
  pathMat: THREE.Material | THREE.Material[],
  pathPredicate: (c: number, r: number) => boolean,
  elevatedPredicate?: (c: number, r: number) => boolean,
  foundationMat?: THREE.Material | THREE.Material[]
): THREE.Group {
  const terrainGroup = new THREE.Group();

  for (let c = -8; c <= 8; c++) {
    for (let r = -8; r <= 8; r++) {
      const isPath = pathPredicate(c, r);
      const isElevated = elevatedPredicate ? elevatedPredicate(c, r) : false;

      const x = c * 16;
      const z = r * 16;
      const mat = isPath ? pathMat : primaryMat;

      if (isElevated) {
        const base = foundationMat || primaryMat;
        terrainGroup.add(createBlock(base, x, -25, z));
        terrainGroup.add(createBlock(mat, x, -9, z));
      } else {
        terrainGroup.add(createBlock(mat, x, -25, z));
      }
    }
  }

  return terrainGroup;
}

// -------------------------------------------------------------
// 7 AAA AUTHENTIC MINECRAFT BIOMES WITH SHADERS PIPELINE
// -------------------------------------------------------------
export const BIOMES_3D_CONFIG: Biome3DConfig[] = [
  // 1. Rừng nguyên sinh (Lush Forest Shaders)
  {
    id: 'real_forest',
    nameKey: 'biomeRealForest',
    defaultName: 'Rừng Game Khám Phá (Shaders)',
    tagline: 'Quang cảnh rừng sồi & bạch dương Minecraft rực rỡ, đường mòn quanh co, đèn lồng ấm và mây 3D trôi',
    icon: '🌳',
    accentColor: '#4ade80',
    skyGradient: 'linear-gradient(180deg, #3b82f6 0%, #60a5fa 35%, #93c5fd 65%, #dbeafe 88%, #eff6ff 100%)',
    skyFogColor: 0x60a5fa,
    ambientSpotlight: 'rgba(74, 222, 128, 0.3)',
    ambientColor: 0xffffff,
    ambientIntensity: 1.5,
    sunColor: 0xfff7ed,
    sunIntensity: 1.8,
    sunPosition: [18, 34, -75],
    buildScene: () => {
      const group = new THREE.Group();
      group.name = 'biome_diorama';

      // Authentic Forest Grass & Winding Dirt Path (Vanilla Plains colormap green #5c9e32)
      const grassMat = createBlockMaterial('grass_block_top.png', 'grass_block_side.png', 'dirt.png', '#5c9e32');
      const pathMat = createBlockMaterial('dirt_path_top.png', 'dirt_path_side.png', 'dirt.png');
      const stoneMat = createBlockMaterial('stone.png');

      // Continuous 17x17 terrain with gentle background knoll
      const terrain = buildExpansiveTerrain(
        grassMat,
        pathMat,
        (c, r) => (c === 0 && r >= -4 && r <= 6) || (c === 1 && (r === -1 || r === 2)) || (c === -1 && (r === 0 || r === 4)),
        (c, r) => r <= -5,
        stoneMat
      );
      group.add(terrain);

      group.add(createContactShadow());

      // Authentic Trees framing the scene perfectly:
      // Birch on left, Oak on right, distant Oak on back hill
      group.add(createMinecraftTree('birch', -19, -30, 4));
      group.add(createMinecraftTree('oak', 20, -32, 4));
      group.add(createMinecraftTree('oak', 2, -58, 3));

      // Oak fence post with hanging glowing Minecraft 3D lantern right beside Steve
      const fenceTex = getBlockTexture('oak_log.png');
      const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, roughness: 0.85 });
      const fencePost = new THREE.Mesh(new THREE.BoxGeometry(4, 16, 4), fenceMat);
      fencePost.position.set(-10, -9, -2);
      group.add(fencePost);
      group.add(createLantern(-10, -5, -2, 0xffa326));

      // Flowers & Flora dotted on the grass around Steve
      group.add(createCrossPlant('poppy.png', 7, -17, 2));
      group.add(createCrossPlant('dandelion.png', -7, -17, 3));
      group.add(createCrossPlant('cornflower.png', 8, -17, -4));
      group.add(createCrossPlant('short_grass.png', -5, -17, -3));
      group.add(createCrossPlant('short_grass.png', 6, -17, 5));

      // Minecraft 3D Clouds & Square Sun
      const { group: cloudsGroup, update: updateClouds } = createMinecraftClouds(33, -55);
      group.add(cloudsGroup);
      group.add(createMinecraftSun(0xfffbeb, 18, 34, -75));

      // Shaders Lighting: Sky light + Ground vegetation bounce + Warm sun
      const hemi = new THREE.HemisphereLight(0xdbeafe, 0x4d7c0f, 1.6);
      group.add(hemi);

      const sun = new THREE.DirectionalLight(0xfff7ed, 1.8);
      sun.position.set(-25, 45, 35);
      group.add(sun);

      // Gentle pollen / dandelion fluff micro-particles
      const { points: pollen, update: updatePollen } = createAtmosphericParticles(
        35,
        'pollen',
        2.2,
        { x: 50, y: 35, z: 50 },
        -0.3,
        0.5
      );
      group.add(pollen);

      return {
        group,
        update: (delta) => {
          updateClouds(delta);
          updatePollen(delta);
        },
      };
    },
  },

  // 2. Xưởng Kỹ Thuật Create Mod (Create Mod Workshop)
  {
    id: 'create_workshop',
    nameKey: 'biomeCreateWorkshop',
    defaultName: 'Xưởng Kỹ Thuật Create Mod',
    tagline: 'Sàn xưởng đá mài bóng, cột đồng Chiseled Copper, vạc dung nham phát sáng rực rỡ và đèn lồng ấm',
    icon: '⚙️',
    accentColor: '#f59e0b',
    skyGradient: 'linear-gradient(180deg, #181411 0%, #292019 40%, #443427 75%, #634b35 100%)',
    skyFogColor: 0x292019,
    ambientSpotlight: 'rgba(245, 158, 11, 0.3)',
    ambientColor: 0xffedd5,
    ambientIntensity: 1.4,
    sunColor: 0xfbbf24,
    sunIntensity: 1.5,
    sunPosition: [35, 55, 40],
    buildScene: () => {
      const group = new THREE.Group();
      group.name = 'biome_diorama';

      const andesiteMat = createBlockMaterial('polished_andesite.png');
      const stoneBrickMat = createBlockMaterial('stone_bricks.png');
      const copperMat = createBlockMaterial('chiseled_copper.png');
      const smoothStoneMat = createBlockMaterial('smooth_stone.png');

      const terrain = buildExpansiveTerrain(
        andesiteMat,
        smoothStoneMat,
        (c, r) => Math.abs(c) <= 1,
        (c, r) => r <= -5,
        stoneBrickMat
      );
      group.add(terrain);

      group.add(createContactShadow());

      // Industrial Pillars with Lit Copper Bulbs
      const bulbMat = createBlockMaterial('copper_bulb_lit.png');
      group.add(createBlock(copperMat, -18, -9, -28));
      group.add(createBlock(bulbMat, -18, 7, -28));
      const amberLight1 = new THREE.PointLight(0xfb923c, 2.2, 50);
      amberLight1.position.set(-18, 10, -28);
      group.add(amberLight1);

      group.add(createBlock(copperMat, 18, -9, -28));
      group.add(createBlock(bulbMat, 18, 7, -28));
      const amberLight2 = new THREE.PointLight(0xfb923c, 2.2, 50);
      amberLight2.position.set(18, 10, -28);
      group.add(amberLight2);

      // Lava Cauldron with Real Glow
      const lavaMat = createBlockMaterial('lava_still.png');
      group.add(createBlock(stoneBrickMat, 13, -9, -10));
      group.add(createBlock(lavaMat, 13, 7, -10));
      const lavaLight = new THREE.PointLight(0xff4500, 2.5, 45);
      lavaLight.position.set(13, 14, -10);
      group.add(lavaLight);

      // Hanging lantern
      group.add(createLantern(-10, -5, -2, 0xf59e0b));

      // Shaders Lighting: Warm workshop illumination
      const hemi = new THREE.HemisphereLight(0xffedd5, 0x451a03, 1.4);
      group.add(hemi);

      const sun = new THREE.DirectionalLight(0xfbbf24, 1.5);
      sun.position.set(35, 55, 40);
      group.add(sun);

      // Rising steam / spark particles
      const { points: sparks, update: updateSparks } = createAtmosphericParticles(
        35,
        'ember',
        2.4,
        { x: 50, y: 35, z: 50 },
        0.7,
        0.4
      );
      group.add(sparks);

      return {
        group,
        update: (delta) => updateSparks(delta),
      };
    },
  },

  // 3. Rừng Hoa Anh Đào (Cherry Blossom Grove)
  {
    id: 'cherry',
    nameKey: 'biomeCherry',
    defaultName: 'Rừng Hoa Anh Đào',
    tagline: 'Cây hoa anh đào nở rộ rực rỡ, thảm cánh hoa rơi trên đồi cỏ tươi và mây 3D bay bồng bềnh',
    icon: '🌸',
    accentColor: '#f472b6',
    skyGradient: 'linear-gradient(180deg, #831843 0%, #be185d 30%, #ec4899 65%, #fbcfe8 88%, #fff1f2 100%)',
    skyFogColor: 0xbe185d,
    ambientSpotlight: 'rgba(244, 114, 182, 0.25)',
    ambientColor: 0xfff1f2,
    ambientIntensity: 1.5,
    sunColor: 0xffedd5,
    sunIntensity: 1.7,
    sunPosition: [18, 34, -75],
    buildScene: () => {
      const group = new THREE.Group();
      group.name = 'biome_diorama';

      // Cherry colormap grass (#9be87a)
      const grassMat = createBlockMaterial('grass_block_top.png', 'grass_block_side.png', 'dirt.png', '#9be87a');
      const pathMat = createBlockMaterial('dirt_path_top.png', 'dirt_path_side.png', 'dirt.png');

      const terrain = buildExpansiveTerrain(
        grassMat,
        pathMat,
        (c, r) => (c === 0 && r >= -4 && r <= 6) || (c === 1 && (r === -1 || r === 2)),
        (c, r) => r <= -5
      );
      group.add(terrain);

      group.add(createContactShadow());

      // Authentic Cherry Tree with curved branch
      group.add(createMinecraftTree('cherry', 19, -30, 4));

      // Falling petal decals on ground around Steve
      group.add(createFlatDecal('pink_petals.png', 7, -17, 2));
      group.add(createFlatDecal('pink_petals.png', -6, -17, 3));
      group.add(createFlatDecal('pink_petals.png', 4, -17, -4));

      // Lantern on cherry fence post
      const fenceTex = getBlockTexture('cherry_log.png');
      const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, roughness: 0.85 });
      const fencePost = new THREE.Mesh(new THREE.BoxGeometry(4, 16, 4), fenceMat);
      fencePost.position.set(-10, -9, -2);
      group.add(fencePost);
      group.add(createLantern(-10, -5, -2, 0xffb74d));

      group.add(createCrossPlant('poppy.png', 7, -17, 2));

      // Clouds & Sun
      const { group: cloudsGroup, update: updateClouds } = createMinecraftClouds(33, -55);
      group.add(cloudsGroup);
      group.add(createMinecraftSun(0xffedd5, 18, 34, -75));

      const hemi = new THREE.HemisphereLight(0xfce7f3, 0x4d7c0f, 1.6);
      group.add(hemi);

      const sun = new THREE.DirectionalLight(0xffedd5, 1.7);
      sun.position.set(-25, 45, 35);
      group.add(sun);

      const { points: petals, update: updatePetals } = createAtmosphericParticles(
        45,
        'petal',
        2.4,
        { x: 50, y: 35, z: 50 },
        -1.1,
        0.7
      );
      group.add(petals);

      return {
        group,
        update: (delta) => {
          updateClouds(delta);
          updatePetals(delta);
        },
      };
    },
  },

  // 4. Đêm Rừng Thông Taiga (Starry Night Taiga)
  {
    id: 'taiga',
    nameKey: 'biomeTaiga',
    defaultName: 'Đêm Rừng Thông Taiga',
    tagline: 'Đêm ngàn sao trên rừng thông kim, vầng trăng vuông phát sáng, đom đóm 3D và ánh lửa ấm áp',
    icon: '🌲',
    accentColor: '#10b981',
    skyGradient: 'linear-gradient(180deg, #020617 0%, #0b1329 40%, #172554 75%, #1e3a8a 100%)',
    skyFogColor: 0x0b1329,
    ambientSpotlight: 'rgba(16, 185, 129, 0.25)',
    ambientColor: 0xc7d2fe,
    ambientIntensity: 1.35,
    sunColor: 0x93c5fd,
    sunIntensity: 1.4,
    sunPosition: [18, 34, -75],
    buildScene: () => {
      const group = new THREE.Group();
      group.name = 'biome_diorama';

      const podzolMat = createBlockMaterial('podzol_top.png', 'podzol_side.png', 'dirt.png');
      const cobbleMat = createBlockMaterial('cobblestone.png');

      const terrain = buildExpansiveTerrain(
        podzolMat,
        cobbleMat,
        (c, r) => (c === 0 && r >= -4 && r <= 6) || (c === 1 && r === 1),
        (c, r) => r <= -5
      );
      group.add(terrain);

      group.add(createContactShadow());

      // Tall Spruce Trees framing the scene
      group.add(createMinecraftTree('spruce', -19, -30, 5));
      group.add(createMinecraftTree('spruce', 20, -32, 5));
      group.add(createMinecraftTree('spruce', 2, -58, 4));

      // Cozy hanging lantern on post
      const fenceTex = getBlockTexture('spruce_log.png');
      const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, roughness: 0.85 });
      const fencePost = new THREE.Mesh(new THREE.BoxGeometry(4, 16, 4), fenceMat);
      fencePost.position.set(-10, -9, -2);
      group.add(fencePost);
      group.add(createLantern(-10, -5, -2, 0xffa726));

      group.add(createCrossPlant('fern.png', 7, -17, 2));
      group.add(createCrossPlant('fern.png', -7, -17, 3));

      // Minecraft Moon
      group.add(createMinecraftMoon(18, 34, -75));

      const hemi = new THREE.HemisphereLight(0x38bdf8, 0x14532d, 1.35);
      group.add(hemi);

      const moon = new THREE.DirectionalLight(0x93c5fd, 1.4);
      moon.position.set(-25, 45, 35);
      group.add(moon);

      const { points: fireflies, update: updateFireflies } = createAtmosphericParticles(
        35,
        'glow',
        2.6,
        { x: 50, y: 35, z: 50 },
        0.3,
        0.8
      );
      group.add(fireflies);

      return {
        group,
        update: (delta) => updateFireflies(delta),
      };
    },
  },

  // 5. Núi Tuyết Băng Giá (Snowy Peaks)
  {
    id: 'snowy',
    nameKey: 'biomeSnowy',
    defaultName: 'Núi Tuyết Băng Giá',
    tagline: 'Cực quang phương bắc lung linh, đồi tuyết trắng mịn, tháp băng nhọn và hoa tuyết 3D rơi lất phất',
    icon: '❄️',
    accentColor: '#38bdf8',
    skyGradient: 'linear-gradient(180deg, #0c4a6e 0%, #0284c7 40%, #38bdf8 70%, #e0f2fe 100%)',
    skyFogColor: 0x0284c7,
    ambientSpotlight: 'rgba(56, 189, 248, 0.25)',
    ambientColor: 0xe0f2fe,
    ambientIntensity: 1.45,
    sunColor: 0xbae6fd,
    sunIntensity: 1.6,
    sunPosition: [18, 34, -75],
    buildScene: () => {
      const group = new THREE.Group();
      group.name = 'biome_diorama';

      const snowMat = createBlockMaterial('snow.png');
      const iceMat = createBlockMaterial('packed_ice.png');

      const terrain = buildExpansiveTerrain(
        snowMat,
        iceMat,
        (c, r) => Math.abs(c) <= 1,
        (c, r) => r <= -5
      );
      group.add(terrain);

      group.add(createContactShadow());

      group.add(createMinecraftTree('spruce', 19, -30, 4));
      group.add(createMinecraftTree('spruce', -2, -58, 4));

      // Soul Lantern on spruce fence post
      const fenceTex = getBlockTexture('spruce_log.png');
      const fenceMat = new THREE.MeshStandardMaterial({ map: fenceTex, roughness: 0.85 });
      const fencePost = new THREE.Mesh(new THREE.BoxGeometry(4, 16, 4), fenceMat);
      fencePost.position.set(-10, -9, -2);
      group.add(fencePost);
      group.add(createLantern(-10, -5, -2, 0x38bdf8));

      const { group: cloudsGroup, update: updateClouds } = createMinecraftClouds(33, -55);
      group.add(cloudsGroup);
      group.add(createMinecraftSun(0xbae6fd, 18, 34, -75));

      const hemi = new THREE.HemisphereLight(0xe0f2fe, 0x1e3a8a, 1.45);
      group.add(hemi);

      const sun = new THREE.DirectionalLight(0xbae6fd, 1.6);
      sun.position.set(-25, 45, 35);
      group.add(sun);

      const { points: snow, update: updateSnow } = createAtmosphericParticles(
        60,
        'snow',
        2.5,
        { x: 50, y: 40, z: 50 },
        -1.3,
        0.5
      );
      group.add(snow);

      return {
        group,
        update: (delta) => {
          updateClouds(delta);
          updateSnow(delta);
        },
      };
    },
  },

  // 6. Sảnh Thử Thách 1.21 (Trial Chambers)
  {
    id: 'mojang_121',
    nameKey: 'biomeTrialChambers',
    defaultName: 'Sảnh Thử Thách 1.21',
    tagline: 'Kiến trúc khối đồng Chiseled Copper và gạch Tuff Bricks đặc trưng Mojang 1.21 với bóng đèn đồng phát sáng',
    icon: '🗝️',
    accentColor: '#f97316',
    skyGradient: 'linear-gradient(180deg, #181412 0%, #29201b 45%, #382c24 80%, #4a382c 100%)',
    skyFogColor: 0x1f1712,
    ambientSpotlight: 'rgba(249, 115, 22, 0.25)',
    ambientColor: 0xffedd5,
    ambientIntensity: 1.35,
    sunColor: 0xfb923c,
    sunIntensity: 1.5,
    sunPosition: [25, 45, 35],
    buildScene: () => {
      const group = new THREE.Group();
      group.name = 'biome_diorama';

      const tuffMat = createBlockMaterial('tuff_bricks.png');
      const copperMat = createBlockMaterial('chiseled_copper.png');

      const terrain = buildExpansiveTerrain(
        tuffMat,
        copperMat,
        (c, r) => Math.abs(c) <= 2 && Math.abs(r) <= 2,
        (c, r) => r <= -5
      );
      group.add(terrain);

      group.add(createContactShadow());

      const bulbMat = createBlockMaterial('copper_bulb_lit.png');
      group.add(createBlock(copperMat, -18, -9, -28));
      group.add(createBlock(bulbMat, -18, 7, -28));
      const amberLight1 = new THREE.PointLight(0xf97316, 2.2, 50);
      amberLight1.position.set(-18, 10, -28);
      group.add(amberLight1);

      group.add(createBlock(copperMat, 18, -9, -28));
      group.add(createBlock(bulbMat, 18, 7, -28));
      const amberLight2 = new THREE.PointLight(0xf97316, 2.2, 50);
      amberLight2.position.set(18, 10, -28);
      group.add(amberLight2);

      group.add(createLantern(-10, -5, -2, 0xf97316));

      const hemi = new THREE.HemisphereLight(0xffedd5, 0x431407, 1.4);
      group.add(hemi);

      const sun = new THREE.DirectionalLight(0xfb923c, 1.5);
      sun.position.set(25, 45, 35);
      group.add(sun);

      const { points: embers, update: updateEmbers } = createAtmosphericParticles(
        35,
        'ember',
        2.4,
        { x: 50, y: 35, z: 50 },
        0.5,
        0.4
      );
      group.add(embers);

      return {
        group,
        update: (delta) => updateEmbers(delta),
      };
    },
  },

  // 7. Studio Tối Giản (Minimal Studio)
  {
    id: 'studio',
    nameKey: 'biomeStudio',
    defaultName: 'Studio Tối Giản',
    tagline: 'Bệ đỡ đá Obsidian sang trọng, tinh thể hổ phách bay lơ lửng tự xoay và ánh sáng studio chuyên nghiệp',
    icon: '✨',
    accentColor: '#f59e0b',
    skyGradient: 'linear-gradient(180deg, #18191d 0%, #121316 60%, #0d0e11 100%)',
    skyFogColor: 0x141518,
    ambientSpotlight: 'rgba(245, 158, 11, 0.1)',
    ambientColor: 0xffffff,
    ambientIntensity: 1.35,
    sunColor: 0xfbbf24,
    sunIntensity: 1.4,
    sunPosition: [25, 45, 35],
    buildScene: () => {
      const group = new THREE.Group();
      group.name = 'biome_diorama';

      const obsidianMat = createBlockMaterial('obsidian.png');
      const platform = buildExpansiveTerrain(
        obsidianMat,
        obsidianMat,
        () => false
      );
      group.add(platform);

      group.add(createContactShadow());

      const prismGeo = new THREE.OctahedronGeometry(4, 0);
      const prismMat = new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: new THREE.Color(0xf59e0b),
        emissiveIntensity: 0.85,
        roughness: 0.2,
        metalness: 0.8,
      });
      const prism = new THREE.Mesh(prismGeo, prismMat);
      prism.position.set(16, 6, -16);
      group.add(prism);

      const amberLight = new THREE.PointLight(0xfbbf24, 2.0, 50);
      amberLight.position.set(16, 10, -16);
      group.add(amberLight);

      const hemi = new THREE.HemisphereLight(0xffffff, 0x1f2937, 1.35);
      group.add(hemi);

      const sun = new THREE.DirectionalLight(0xfbbf24, 1.4);
      sun.position.set(25, 45, 35);
      group.add(sun);

      const update = (delta: number) => {
        prism.rotation.y += delta * 1.2;
        prism.rotation.x += delta * 0.6;
        prism.position.y = 6 + Math.sin(Date.now() * 0.003) * 1.5;
      };

      return { group, update };
    },
  },
];
