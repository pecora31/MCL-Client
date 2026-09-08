import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  Shirt,
  UploadCloud,
  Check,
  RotateCcw,
  Trash2,
  Users,
  Rotate3d,
  Info,
  Search,
  X,
  Plus,
  ArrowDownAZ,
  ArrowUpZA,
  Clock,
  ChevronDown,
} from 'lucide-react';
import type { Account, GameInstance } from '../../types';
import { getTranslation, type Language } from '../../locales/i18n';
import { ToggleSwitch } from '../common/ToggleSwitch';
import { STEVE_SKIN_BASE64, ALEX_SKIN_BASE64 } from './presetSkins';
import * as THREE from 'three';

const applyShaderMaterial = (viewer: any) => {
  if (!viewer?.playerObject?.skin) return;
  const skin = viewer.playerObject.skin;
  const roughness = 0.72;
  const metalness = 0.03;

  if (skin.layer1Material) {
    skin.layer1Material.roughness = roughness;
    skin.layer1Material.metalness = metalness;
  }
  if (skin.layer2Material) {
    skin.layer2Material.roughness = roughness;
    skin.layer2Material.metalness = metalness;
  }
  if (skin.layer1MaterialBiased) {
    skin.layer1MaterialBiased.roughness = roughness;
    skin.layer1MaterialBiased.metalness = metalness;
  }
  if (skin.layer2MaterialBiased) {
    skin.layer2MaterialBiased.roughness = roughness;
    skin.layer2MaterialBiased.metalness = metalness;
  }
};

interface SkinStudioProps {
  account: Account;
  onUpdateSkin: (skinUrl: string, model: 'classic' | 'slim') => void;
  instances: GameInstance[];
  language?: Language;
}

export interface SkinLibraryItem {
  id: string;
  name: string;
  skinUrl: string;
  model: 'classic' | 'slim';
  isDefault?: boolean;
  createdAt?: number;
}

const DEFAULT_SKIN_PRESETS: SkinLibraryItem[] = [
  {
    id: 'preset_steve',
    name: 'Classic Steve',
    skinUrl: STEVE_SKIN_BASE64,
    model: 'classic',
    isDefault: true,
  },
  {
    id: 'preset_alex',
    name: 'Modern Alex',
    skinUrl: ALEX_SKIN_BASE64,
    model: 'slim',
    isDefault: true,
  },
];

// Sharp geometric flat star for favorite marking (Pure flat solid vector, immune to theme propagation)
const SharpStarIcon: React.FC<{
  isFavorite: boolean;
  size?: number;
  className?: string;
}> = ({ isFavorite, size = 20, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <polygon
        points="12,1.5 15.2,8.3 22.5,9.2 17.2,14.3 18.5,21.5 12,18 5.5,21.5 6.8,14.3 1.5,9.2 8.8,8.3"
        style={{
          fill: isFavorite ? '#f59e0b' : 'none',
          stroke: isFavorite ? 'none' : '#64748b',
          strokeWidth: isFavorite ? 0 : 1.75,
          strokeLinejoin: 'miter',
          strokeMiterlimit: 4,
          transition: 'fill 0.15s ease, stroke 0.15s ease',
        }}
      />
    </svg>
  );
};

// Helper component to render pixelated Minecraft 2D Full-Body character
interface SkinFullBodyProps {
  skinUrl: string;
  model?: 'classic' | 'slim';
  width?: number;
  height?: number;
}

const SkinFullBody: React.FC<SkinFullBodyProps> = ({
  skinUrl,
  model = 'classic',
  width = 38,
  height = 76,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isSlim = model === 'slim';
    const armW = isSlim ? 3 : 4;
    const rightArmX = isSlim ? 1 : 0;
    const leftArmX = 12;

    const renderImage = (img: HTMLImageElement) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;

      // Virtual 16x32 Minecraft body grid mapped to canvas dimensions
      const sx = canvas.width / 16;
      const sy = canvas.height / 32;

      const drawPart = (
        sxSrc: number,
        sySrc: number,
        sWidth: number,
        sHeight: number,
        dx: number,
        dy: number,
        dWidth: number,
        dHeight: number,
        flipH = false
      ) => {
        ctx.save();
        if (flipH) {
          ctx.translate((dx + dWidth) * sx, dy * sy);
          ctx.scale(-1, 1);
          ctx.drawImage(img, sxSrc, sySrc, sWidth, sHeight, 0, 0, dWidth * sx, dHeight * sy);
        } else {
          ctx.drawImage(img, sxSrc, sySrc, sWidth, sHeight, dx * sx, dy * sy, dWidth * sx, dHeight * sy);
        }
        ctx.restore();
      };

      const isModern = (img.naturalHeight || img.height) >= 64;

      // 1. Head Base: (8, 8, 8, 8) -> dest: (4, 0, 8, 8)
      drawPart(8, 8, 8, 8, 4, 0, 8, 8);
      // 2. Head Hat/Overlay: (40, 8, 8, 8) -> dest: (4, 0, 8, 8)
      drawPart(40, 8, 8, 8, 4, 0, 8, 8);

      // 3. Torso Base: (20, 20, 8, 12) -> dest: (4, 8, 8, 12)
      drawPart(20, 20, 8, 12, 4, 8, 8, 12);
      // 4. Torso Overlay (if modern): (20, 36, 8, 12) -> dest: (4, 8, 8, 12)
      if (isModern) {
        drawPart(20, 36, 8, 12, 4, 8, 8, 12);
      }

      // 5. Right Arm Base (Viewer's left): (44, 20, armW, 12) -> dest: (rightArmX, 8, armW, 12)
      drawPart(44, 20, armW, 12, rightArmX, 8, armW, 12);
      // 6. Right Arm Overlay (if modern): (44, 36, armW, 12) -> dest: (rightArmX, 8, armW, 12)
      if (isModern) {
        drawPart(44, 36, armW, 12, rightArmX, 8, armW, 12);
      }

      // 7. Left Arm (Viewer's right):
      if (isModern) {
        // Base: (36, 52, armW, 12) -> dest: (leftArmX, 8, armW, 12)
        drawPart(36, 52, armW, 12, leftArmX, 8, armW, 12);
        // Overlay: (52, 52, armW, 12) -> dest: (leftArmX, 8, armW, 12)
        drawPart(52, 52, armW, 12, leftArmX, 8, armW, 12);
      } else {
        // Legacy 64x32: flip right arm horizontally
        drawPart(44, 20, armW, 12, leftArmX, 8, armW, 12, true);
      }

      // 8. Right Leg Base (Viewer's left): (4, 20, 4, 12) -> dest: (4, 20, 4, 12)
      drawPart(4, 20, 4, 12, 4, 20, 4, 12);
      // 9. Right Leg Overlay (if modern): (4, 36, 4, 12) -> dest: (4, 20, 4, 12)
      if (isModern) {
        drawPart(4, 36, 4, 12, 4, 20, 4, 12);
      }

      // 10. Left Leg (Viewer's right):
      if (isModern) {
        // Base: (20, 52, 4, 12) -> dest: (8, 20, 4, 12)
        drawPart(20, 52, 4, 12, 8, 20, 4, 12);
        // Overlay: (4, 52, 4, 12) -> dest: (8, 20, 4, 12)
        drawPart(4, 52, 4, 12, 8, 20, 4, 12);
      } else {
        // Legacy 64x32: flip right leg horizontally
        drawPart(4, 20, 4, 12, 8, 20, 4, 12, true);
      }
    };

    const targetSrc = skinUrl || STEVE_SKIN_BASE64;
    const img = new Image();
    if (targetSrc.startsWith('http://') || targetSrc.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => renderImage(img);
    img.onerror = () => {
      const fallbackImg = new Image();
      fallbackImg.onload = () => renderImage(fallbackImg);
      fallbackImg.src = STEVE_SKIN_BASE64;
    };
    img.src = targetSrc;

    if (img.complete && img.naturalWidth > 0) {
      renderImage(img);
    }
  }, [skinUrl, model, width, height]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="shrink-0 drop-shadow-md"
      style={{
        imageRendering: 'pixelated',
        width: `${width}px`,
        height: `${height}px`,
      }}
    />
  );
};

export const SkinStudio: React.FC<SkinStudioProps> = ({
  account,
  onUpdateSkin,
  instances,
  language = 'en',
}) => {
  const t = getTranslation(language);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewerRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Active saved skin on the account (fallback to STEVE_SKIN_BASE64)
  const activeSkinUrl = useMemo(() => {
    if (
      account.skinUrl &&
      !account.skinUrl.includes('textures.minecraft.net') &&
      account.skinUrl !== '/skins/steve.png'
    ) {
      return account.skinUrl;
    }
    return STEVE_SKIN_BASE64;
  }, [account.skinUrl]);

  // Canvas container ref for full height & width tracking
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Skin currently being previewed on the 3D model (persisted across sessions)
  const [previewSkinUrl, setPreviewSkinUrl] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('mcl_skin_preview_url');
      if (stored) return stored;
    } catch {}
    return activeSkinUrl;
  });

  const [modelType, setModelType] = useState<'classic' | 'slim'>(() => {
    try {
      const stored = localStorage.getItem('mcl_skin_model_type');
      if (stored === 'classic' || stored === 'slim') return stored;
    } catch {}
    return account.skinModel || 'classic';
  });

  const [animationType, setAnimationType] = useState<'idle' | 'walk' | 'run'>(() => {
    try {
      const stored = localStorage.getItem('mcl_skin_animation');
      if (stored === 'idle' || stored === 'walk' || stored === 'run') return stored;
    } catch {}
    return 'walk';
  });

  // Default auto-rotate 360 to TRUE unless user has previously interacted and chosen otherwise
  const [isAutoRotating, setIsAutoRotating] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('mcl_skin_autorotate');
      if (stored !== null) {
        return stored === 'true';
      }
    } catch {}
    return true; // Default ON per user request
  });

  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Skin library stored in localStorage
  const [customSkins, setCustomSkins] = useState<SkinLibraryItem[]>(() => {
    try {
      const stored = localStorage.getItem('mcl_skin_library');
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      console.warn('Failed to load custom skins from localStorage:', e);
    }
    return [];
  });

  // Multiplayer Skin Synchronization Toggle
  const [skinSyncEnabled, setSkinSyncEnabled] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('mcl_skin_sync_enabled');
      return stored !== 'false';
    } catch {
      return true;
    }
  });

  // Track deleted preset IDs so users can remove any default skins they don't want
  const [deletedPresetIds, setDeletedPresetIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('mcl_deleted_preset_ids');
      if (stored) return JSON.parse(stored);
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem('mcl_deleted_preset_ids', JSON.stringify(deletedPresetIds));
    } catch {}
  }, [deletedPresetIds]);

  // Track custom renamed skin names (persisted across sessions)
  const [skinNameOverrides, setSkinNameOverrides] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem('mcl_skin_name_overrides');
      if (stored) return JSON.parse(stored);
    } catch {}
    return {};
  });

  useEffect(() => {
    try {
      localStorage.setItem('mcl_skin_name_overrides', JSON.stringify(skinNameOverrides));
    } catch {}
  }, [skinNameOverrides]);

  // Inline Hot Rename state
  const [editingSkinId, setEditingSkinId] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState<string>('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingSkinId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingSkinId]);

  // Combined full skin library excluding deleted presets, applying renamed names, and ensuring active account skin is present
  const fullSkinLibrary = useMemo(() => {
    const activePresets = DEFAULT_SKIN_PRESETS
      .filter((p) => !deletedPresetIds.includes(p.id))
      .map((p) => ({
        ...p,
        name: skinNameOverrides[p.id] || p.name,
      }));
    const userCustomSkins = customSkins.map((c) => ({
      ...c,
      name: skinNameOverrides[c.id] || c.name,
    }));

    const allSkins = [...activePresets, ...userCustomSkins];

    // If account has an active skin that is neither in presets nor custom skins,
    // inject it as an equipped custom skin card so it always appears at the top
    const hasActiveSkin = allSkins.some((s) => s.skinUrl === activeSkinUrl);
    if (!hasActiveSkin && activeSkinUrl && activeSkinUrl !== STEVE_SKIN_BASE64) {
      allSkins.unshift({
        id: 'account_active_skin',
        name: skinNameOverrides['account_active_skin'] || (account.username ? `${account.username}` : 'Equipped Skin'),
        skinUrl: activeSkinUrl,
        model: account.skinModel || 'classic',
        createdAt: Date.now() + 100000,
      });
    }

    return allSkins;
  }, [customSkins, deletedPresetIds, skinNameOverrides, activeSkinUrl, account.username, account.skinModel]);

  // Track favorite skin IDs (persisted across sessions)
  const [favoriteSkinIds, setFavoriteSkinIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('mcl_favorite_skin_ids');
      if (stored) return JSON.parse(stored);
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem('mcl_favorite_skin_ids', JSON.stringify(favoriteSkinIds));
    } catch {}
  }, [favoriteSkinIds]);

  const handleToggleFavoriteSkin = (id: string) => {
    setFavoriteSkinIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Search & Dropdown Sort state for Skin Library
  type SkinSortOption = 'recent' | 'oldest' | 'az' | 'za' | 'favorite';
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SkinSortOption>('recent');
  const [isSortOpen, setIsSortOpen] = useState<boolean>(false);
  const sortDropdownRef = useRef<HTMLDivElement | null>(null);

  // Option: show equipped skin first toggle (persisted across sessions)
  const [showEquippedFirst, setShowEquippedFirst] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('mcl_skin_show_equipped_first');
      if (stored !== null) return stored === 'true';
    } catch {}
    return false;
  });

  useEffect(() => {
    try {
      localStorage.setItem('mcl_skin_show_equipped_first', String(showEquippedFirst));
    } catch {}
  }, [showEquippedFirst]);

  // Close sort dropdown when clicking outside
  useEffect(() => {
    if (!isSortOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setIsSortOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSortOpen]);

  // 3D Preview Guide popup state (Click to open, click outside to close)
  const [isGuideOpen, setIsGuideOpen] = useState<boolean>(false);
  const guideRef = useRef<HTMLDivElement | null>(null);

  // Close 3D preview guide when clicking outside
  useEffect(() => {
    if (!isGuideOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (guideRef.current && !guideRef.current.contains(e.target as Node)) {
        setIsGuideOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isGuideOpen]);

  // Inline Add Skin Dropzone state
  const [isAddSkinOpen, setIsAddSkinOpen] = useState<boolean>(false);

  // Ref for floating Add Skin overlay box
  const addSkinBoxRef = useRef<HTMLDivElement | null>(null);

  // Close floating add skin box on click outside
  useEffect(() => {
    if (!isAddSkinOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        addSkinBoxRef.current &&
        !addSkinBoxRef.current.contains(e.target as Node) &&
        !(e.target as HTMLElement)?.closest('button[data-add-skin-btn="true"]')
      ) {
        setIsAddSkinOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isAddSkinOpen]);

  const filteredSkins = useMemo(() => {
    const list = fullSkinLibrary.filter((item) => {
      // Search name filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        if (!item.name.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    // Bulletproof timestamp extractor that handles any ID format or undefined values
    const getTime = (item: SkinLibraryItem): number => {
      if (typeof item.createdAt === 'number' && !isNaN(item.createdAt) && item.createdAt > 0) {
        return item.createdAt;
      }
      if (typeof item.id === 'string' && item.id.startsWith('custom_')) {
        const num = Number(item.id.replace('custom_', ''));
        if (!isNaN(num) && num > 0) return num;
      }
      if (typeof item.id === 'number' && !isNaN(item.id) && item.id > 0) {
        return item.id;
      }
      // Default presets catalog order: Steve (idx 0) -> 1, Alex -> 2 ... Steampunk -> 12
      const presetIdx = DEFAULT_SKIN_PRESETS.findIndex((p) => p.id === item.id);
      if (presetIdx !== -1) {
        return presetIdx + 1;
      }
      return 0;
    };

    return [...list].sort((a, b) => {
      // Rule 1: Skin đang kích hoạt (activeSkinUrl) chỉ ghim ở đầu danh sách khi bật tuỳ chọn showEquippedFirst
      if (showEquippedFirst) {
        const aIsActive = a.skinUrl === activeSkinUrl;
        const bIsActive = b.skinUrl === activeSkinUrl;
        if (aIsActive && !bIsActive) return -1;
        if (!aIsActive && bIsActive) return 1;
      }

      // Rule 2: Yêu thích (Favorites lên trước)
      if (sortBy === 'favorite') {
        const aFav = favoriteSkinIds.includes(a.id);
        const bFav = favoriteSkinIds.includes(b.id);
        if (aFav && !bFav) return -1;
        if (!aFav && bFav) return 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      // Rule 3: Bảng chữ cái A -> Z
      if (sortBy === 'az') {
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      // Rule 4: Bảng chữ cái Z -> A
      if (sortBy === 'za') {
        return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      const aTime = getTime(a);
      const bTime = getTime(b);

      // Rule 5: Oldest (Cũ nhất lên trước: Presets gốc từ Steve -> Steampunk, tiếp đến custom skins cũ -> mới)
      if (sortBy === 'oldest') {
        if (aTime !== bTime) {
          return aTime - bTime;
        }
        const aIndex = fullSkinLibrary.findIndex((s) => s.id === a.id);
        const bIndex = fullSkinLibrary.findIndex((s) => s.id === b.id);
        return aIndex - bIndex;
      }

      // Rule 6: Recent (Mới nhất lên trước: Custom skins mới nhất lên đầu, tiếp đến presets mới -> cũ)
      if (aTime !== bTime) {
        return bTime - aTime;
      }
      const aIndex = fullSkinLibrary.findIndex((s) => s.id === a.id);
      const bIndex = fullSkinLibrary.findIndex((s) => s.id === b.id);
      return bIndex - aIndex;
    });
  }, [fullSkinLibrary, searchQuery, sortBy, showEquippedFirst, activeSkinUrl, favoriteSkinIds]);

  // Save custom skins to localStorage whenever updated
  useEffect(() => {
    try {
      localStorage.setItem('mcl_skin_library', JSON.stringify(customSkins));
    } catch (e) {
      console.warn('Failed to save skin library:', e);
    }
  }, [customSkins]);

  // Save skin sync toggle
  const handleToggleSkinSync = (checked: boolean) => {
    setSkinSyncEnabled(checked);
    try {
      localStorage.setItem('mcl_skin_sync_enabled', String(checked));
    } catch (e) {
      console.warn('Failed to persist skin sync setting:', e);
    }
  };

  // Helper to apply 3D animation
  const applyAnimation = async (
    viewer: any,
    anim: 'idle' | 'walk' | 'run',
    skinview3dModule?: any
  ) => {
    if (!viewer) return;
    try {
      const skinview3d = skinview3dModule || (await import('skinview3d'));

      if (anim === 'walk') {
        viewer.animation = new skinview3d.WalkingAnimation();
        viewer.animation.speed = 0.85;
      } else if (anim === 'run') {
        viewer.animation = new skinview3d.RunningAnimation();
        viewer.animation.speed = 1.25;
      } else {
        viewer.animation = new skinview3d.IdleAnimation();
        viewer.animation.speed = 0.6;
      }
    } catch (err) {
      console.warn('Failed to apply skin animation:', err);
    }
  };

  // Initialize skinview3d 3D Character Studio Viewer
  useEffect(() => {
    let viewer: any = null;
    let isCancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    const initViewer = async () => {
      if (!canvasRef.current) return;
      try {
        const skinview3d = await import('skinview3d');
        if (isCancelled) return;

        // Container client dimensions (full stretched height and width)
        const container = canvasContainerRef.current || canvasRef.current.parentElement;
        const width = container && container.clientWidth > 50 ? container.clientWidth : 380;
        const height = container && container.clientHeight > 50 ? container.clientHeight : 480;

        const initialSkin = previewSkinUrl || STEVE_SKIN_BASE64;

        viewer = new skinview3d.SkinViewer({
          canvas: canvasRef.current,
          width,
          height,
          skin: initialSkin,
          model: modelType === 'slim' ? 'slim' : 'auto-detect',
        });

        viewer.controls.enableRotate = true;
        viewer.controls.enableZoom = true;
        viewer.controls.enablePan = true;

        // Clean studio camera framing centered on character with comfortable breathing room
        viewer.playerObject.position.set(0, 0, 0);
        if (viewer.controls) {
          viewer.controls.target.set(0, 0, 0);
        }
        viewer.zoom = 0.65;
        if (typeof viewer.resetCameraPose === 'function') {
          viewer.resetCameraPose();
        } else if (viewer.camera) {
          viewer.camera.position.set(0, 0, 56);
        }
        if (viewer.controls) {
          viewer.controls.update();
        }

        // Clean transparent canvas with cinematic shader studio lighting (BSL / Complementary style)
        viewer.scene.background = null;
        if (viewer.renderer) {
          viewer.renderer.toneMapping = THREE.ACESFilmicToneMapping;
          viewer.renderer.toneMappingExposure = 1.15;
        }

        // Base ambient fill
        if (viewer.globalLight) {
          viewer.globalLight.color.set(0xffffff);
          viewer.globalLight.intensity = 1.4;
        }
        if (viewer.cameraLight) {
          viewer.cameraLight.intensity = 0.6;
        }

        // 1. Key Light: Warm golden sunlight illuminating facial features & front planes
        const keySunLight = new THREE.DirectionalLight(0xfffaed, 2.2);
        keySunLight.position.set(22, 35, 26);
        viewer.scene.add(keySunLight);

        // 2. Fill Light: Soft daylight filling the shadow side for crisp color retention
        const fillSkyLight = new THREE.DirectionalLight(0xdbeafe, 1.2);
        fillSkyLight.position.set(-24, 18, 18);
        viewer.scene.add(fillSkyLight);

        // 3. Rim Light: Cinematic backlight catching shoulders, hair & silhouette (Shader edge glow)
        const rimLight = new THREE.DirectionalLight(0xffedd5, 1.8);
        rimLight.position.set(-18, 28, -30);
        viewer.scene.add(rimLight);

        // 4. Ground Bounce: Soft upward reflection preventing dark crevices
        const groundBounce = new THREE.DirectionalLight(0x94a3b8, 0.5);
        groundBounce.position.set(0, -25, 10);
        viewer.scene.add(groundBounce);

        // 5. Subtle Soft Ambient Occlusion Contact Shadow directly beneath boots
        const shadowCanvas = document.createElement('canvas');
        shadowCanvas.width = 128;
        shadowCanvas.height = 128;
        const sCtx = shadowCanvas.getContext('2d');
        if (sCtx) {
          const grad = sCtx.createRadialGradient(64, 64, 0, 64, 64, 56);
          grad.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
          grad.addColorStop(0.35, 'rgba(0, 0, 0, 0.28)');
          grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.08)');
          grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          sCtx.fillStyle = grad;
          sCtx.fillRect(0, 0, 128, 128);
        }
        const shadowTex = new THREE.CanvasTexture(shadowCanvas);
        const shadowMesh = new THREE.Mesh(
          new THREE.PlaneGeometry(22, 14),
          new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
        );
        shadowMesh.rotation.x = -Math.PI / 2;
        shadowMesh.position.set(0, -16.02, 0);
        viewer.scene.add(shadowMesh);

        applyShaderMaterial(viewer);

        viewerRef.current = viewer;

        // Apply saved / default auto-rotate state (default ON per user requirement)
        viewer.autoRotate = isAutoRotating;
        viewer.autoRotateSpeed = 1.2;

        // Default animation
        applyAnimation(viewer, animationType, skinview3d);

        // Auto-resize on container changes using ResizeObserver
        if (container && window.ResizeObserver) {
          resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
              const { width: w, height: h } = entry.contentRect;
              if (w > 50 && h > 50 && viewer) {
                viewer.setSize(Math.floor(w), Math.floor(h));
              }
            }
          });
          resizeObserver.observe(container);
        }
      } catch (err) {
        console.warn('Failed to initialize skinview3d:', err);
      }
    };

    initViewer();

    return () => {
      isCancelled = true;
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (viewer) {
        viewer.dispose();
      }
    };
  }, []);

  // Update skin texture when previewSkinUrl changes
  useEffect(() => {
    if (viewerRef.current && previewSkinUrl) {
      viewerRef.current
        .loadSkin(previewSkinUrl, {
          model: modelType === 'slim' ? 'slim' : 'auto-detect',
        })
        .then(() => {
          applyShaderMaterial(viewerRef.current);
        })
        .catch(() => {
          viewerRef.current.loadSkin(STEVE_SKIN_BASE64, { model: 'default' }).then(() => {
            applyShaderMaterial(viewerRef.current);
          });
        });
    }
  }, [previewSkinUrl, modelType]);

  // Save preview skin selection
  useEffect(() => {
    if (previewSkinUrl) {
      try {
        localStorage.setItem('mcl_skin_preview_url', previewSkinUrl);
      } catch {}
    }
  }, [previewSkinUrl]);

  // Save model type selection
  useEffect(() => {
    if (modelType) {
      try {
        localStorage.setItem('mcl_skin_model_type', modelType);
      } catch {}
    }
  }, [modelType]);

  // Handle animation change
  const handleAnimationChange = (anim: 'idle' | 'walk' | 'run') => {
    setAnimationType(anim);
    try {
      localStorage.setItem('mcl_skin_animation', anim);
    } catch {}
    applyAnimation(viewerRef.current, anim);
  };

  // Toggle auto rotate
  const handleToggleAutoRotate = () => {
    const next = !isAutoRotating;
    setIsAutoRotating(next);
    try {
      localStorage.setItem('mcl_skin_autorotate', String(next));
    } catch {}
    if (viewerRef.current) {
      viewerRef.current.autoRotate = next;
      viewerRef.current.autoRotateSpeed = 1.2;
    }
  };

  // Unconditionally pierce through all states to reset player model and camera to 100% front-facing view
  const handleResetCamera = () => {
    if (viewerRef.current) {
      const viewer = viewerRef.current;

      // 1. Force stop auto-rotation
      setIsAutoRotating(false);
      try {
        localStorage.setItem('mcl_skin_autorotate', 'false');
      } catch {}
      viewer.autoRotate = false;

      // 2. Unconditionally snap playerWrapper and playerObject rotations and positions to zero
      if (viewer.playerWrapper) {
        viewer.playerWrapper.position.set(0, 0, 0);
        viewer.playerWrapper.rotation.set(0, 0, 0);
      }
      if (viewer.playerObject) {
        viewer.playerObject.position.set(0, 0, 0);
        viewer.playerObject.rotation.set(0, 0, 0);
      }

      // 3. Reset OrbitControls target to center (clears any right-click pan offset)
      if (viewer.controls) {
        viewer.controls.target.set(0, 0, 0);
      }

      // 4. Reset zoom and camera pose
      viewer.zoom = 0.65;
      if (typeof viewer.resetCameraPose === 'function') {
        viewer.resetCameraPose();
      } else if (viewer.camera) {
        viewer.camera.position.set(0, 0, 56);
        viewer.camera.rotation.set(0, 0, 0);
      }

      // 5. Update OrbitControls to align with front-facing camera
      if (viewer.controls) {
        viewer.controls.update();
      }
    }
  };

  // Process skin file (from drag & drop or file dialog)
  const processSkinFile = (file: File) => {
    if (!file || !file.type.includes('png')) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const dataUrl = reader.result;
        setPreviewSkinUrl(dataUrl);

        // Auto-detect model (classic 4px vs slim 3px) by checking standard Minecraft skin transparency
        const img = new Image();
        img.onload = () => {
          let detectedModel: 'classic' | 'slim' = 'classic';
          if (img.width === 64 && img.height === 64) {
            try {
              const canvas = document.createElement('canvas');
              canvas.width = 64;
              canvas.height = 64;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0);
                // Standard Minecraft check: in 64x64 format, slim skins have transparent pixel at (54, 20)
                const p = ctx.getImageData(54, 20, 1, 1).data;
                if (p[3] === 0) {
                  detectedModel = 'slim';
                }
              }
            } catch {}
          }
          setModelType(detectedModel);

          // Add to custom skins library if not already existing
          const skinName = file.name.replace(/\.png$/i, '').slice(0, 24);
          setCustomSkins((prev) => {
            if (prev.some((s) => s.skinUrl === dataUrl)) return prev;
            const newSkin: SkinLibraryItem = {
              id: `custom_${Date.now()}`,
              name: skinName || 'Custom Skin',
              skinUrl: dataUrl,
              model: detectedModel,
              createdAt: Date.now(),
            };
            return [newSkin, ...prev];
          });
        };
        img.src = dataUrl;
      }
    };
    reader.readAsDataURL(file);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processSkinFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processSkinFile(file);
    }
  };

  // Multi-select for skin deletion
  const [selectedSkinIdsForDelete, setSelectedSkinIdsForDelete] = useState<string[]>([]);

  const handleToggleSelectSkin = (id: string) => {
    setSelectedSkinIdsForDelete((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleClearSelectedSkins = () => {
    setSelectedSkinIdsForDelete([]);
  };

  const handleDeleteSelectedSkins = () => {
    if (selectedSkinIdsForDelete.length === 0) return;
    const isPreviewDeleted = selectedSkinIdsForDelete.some(
      (id) => fullSkinLibrary.find((s) => s.id === id)?.skinUrl === previewSkinUrl
    );

    const presetsToDelete = selectedSkinIdsForDelete.filter((id) =>
      DEFAULT_SKIN_PRESETS.some((p) => p.id === id)
    );
    const customToDelete = selectedSkinIdsForDelete.filter((id) =>
      customSkins.some((c) => c.id === id)
    );

    if (presetsToDelete.length > 0) {
      setDeletedPresetIds((prev) => [...new Set([...prev, ...presetsToDelete])]);
    }
    if (customToDelete.length > 0) {
      setCustomSkins((prev) => prev.filter((s) => !customToDelete.includes(s.id)));
    }
    setFavoriteSkinIds((prev) => prev.filter((id) => !selectedSkinIdsForDelete.includes(id)));

    if (isPreviewDeleted) {
      setPreviewSkinUrl(STEVE_SKIN_BASE64);
    }
    setSelectedSkinIdsForDelete([]);
  };

  const handleRestoreDefaults = () => {
    setDeletedPresetIds([]);
    setSelectedSkinIdsForDelete([]);
  };

  // Delete single skin from library
  const handleDeleteCustomSkin = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (DEFAULT_SKIN_PRESETS.some((p) => p.id === id)) {
      setDeletedPresetIds((prev) => [...new Set([...prev, id])]);
    } else {
      setCustomSkins((prev) => prev.filter((s) => s.id !== id));
    }
    setSelectedSkinIdsForDelete((prev) => prev.filter((item) => item !== id));
    setFavoriteSkinIds((prev) => prev.filter((favId) => favId !== id));
    if (previewSkinUrl === fullSkinLibrary.find((s) => s.id === id)?.skinUrl) {
      setPreviewSkinUrl(STEVE_SKIN_BASE64);
    }
  };

  // Rename skin handlers (Hot inline rename)
  const handleStartRename = (id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSkinId(id);
    setEditingNameValue(currentName);
  };

  const handleSaveRename = (id: string) => {
    const trimmed = editingNameValue.trim();
    if (trimmed) {
      setSkinNameOverrides((prev) => ({ ...prev, [id]: trimmed }));
      setCustomSkins((prev) =>
        prev.map((item) => (item.id === id ? { ...item, name: trimmed } : item))
      );
    }
    setEditingSkinId(null);
  };

  const handleCancelRename = () => {
    setEditingSkinId(null);
  };

  // Save / Apply Skin to Game
  const handleApplySkin = () => {
    onUpdateSkin(previewSkinUrl, modelType);
  };

  // Quick equip skin on double click
  const handleQuickEquip = (item: SkinLibraryItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const targetModel = item.model || modelType;
    setPreviewSkinUrl(item.skinUrl);
    if (item.model) {
      setModelType(item.model);
    }
    onUpdateSkin(item.skinUrl, targetModel);
  };

  return (
    <div className="flex-1 flex flex-col overflow-y-auto p-10 space-y-7 custom-scrollbar animate-fadeIn">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Top Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pr-12">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[var(--accent-color)]/10 border border-[var(--accent-color)]/20 text-[var(--accent-color)] text-xs font-semibold mb-2 tracking-wide">
            <Shirt className="w-4 h-4" />
            <span>{t.badgeSkin || '3D Skin Studio'}</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-normal">
            {t.skinTitle || '3D Skin Studio'}
          </h1>
          <p className="text-base text-slate-300 mt-1 tracking-wide">
            {t.skinSub || 'Interactive 3D preview and custom skin manager.'}
          </p>
        </div>

        {/* Action Controls Group: Multiplayer Skin Sync & Save Skin Button */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Compact Multiplayer Skin Sync Option */}
          <div
            className="h-11 flex items-center gap-2.5 px-3.5 rounded-2xl bg-[#161719]/90 border border-white/10 hover:border-white/20 transition-all select-none shadow-none"
            title={t.skinSyncDesc || 'Sync custom skin in server'}
          >
            <div className="w-7 h-7 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-xs font-bold text-white whitespace-nowrap font-sans leading-tight">
                {t.skinSyncTitle || 'Multiplayer Skin Sync'}
              </span>
              <span className="text-[10px] text-slate-400 leading-tight">
                {skinSyncEnabled ? (t.enabled || 'Enabled') : (t.disabled || 'Disabled')}
              </span>
            </div>
            <ToggleSwitch
              checked={skinSyncEnabled}
              onChange={handleToggleSkinSync}
              size="sm"
              title={t.skinSyncTitle || 'Multiplayer Skin Sync'}
            />
          </div>

          {/* Primary Action Button */}
          <button
            onClick={handleApplySkin}
            className="btn-primary h-11 px-6 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 shadow-none hover:shadow-none shrink-0 cursor-pointer tracking-wide active:scale-95 transition-all"
          >
            <Check className="w-4 h-4" />
            <span>{t.btnApplySkin || 'Save Skin'}</span>
          </button>
        </div>
      </div>


      {/* Main Grid: Clean 3D Studio Showcase (Left) & Controls/Library (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-stretch">
        {/* LEFT COLUMN: Full-Bleed Edge-to-Edge 3D Character Studio Preview */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`lg:col-span-5 relative rounded-3xl h-[570px] border shadow-2xl overflow-hidden transition-all duration-300 select-none glass-panel bg-[#161719]/90 flex flex-col justify-between ${
            isDragging
              ? 'border-[var(--accent-color)] ring-2 ring-[var(--accent-color)]/40 bg-[var(--accent-color)]/[0.04]'
              : 'border-white/10'
          }`}
        >
          {/* 1. Full-Bleed 3D Canvas (Fills 100% of the entire card with zero inner boundaries) */}
          <div
            ref={canvasContainerRef}
            className="absolute inset-0 w-full h-full z-0 select-none overflow-hidden"
          >
            <canvas
              ref={canvasRef}
              className="w-full h-full block cursor-grab active:cursor-grabbing outline-none"
              onContextMenu={(e) => e.preventDefault()}
            />
          </div>

          {/* 2. Top Bar: Interactive Preview Badge (Click to open guide) & Informative Model Badge */}
          <div className="relative z-30 flex items-center justify-between w-full p-4 pointer-events-none">
            {/* Integrated Interactive 3D Preview Badge with Click-to-Open Guide */}
            <div className="relative pointer-events-auto" ref={guideRef}>
              <button
                type="button"
                onClick={() => setIsGuideOpen((prev) => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold backdrop-blur-md font-sans shadow-md cursor-pointer transition-all active:scale-95 ${
                  isGuideOpen
                    ? 'bg-black/80 border-white/25 text-white'
                    : 'bg-black/50 hover:bg-black/70 border-white/10 hover:border-white/20 text-slate-200 hover:text-white'
                }`}
                title={t.controlsGuideTitle || 'Camera Controls'}
              >
                <span>{t.preview3d || '3D Preview'}</span>
                <Info className={`w-3.5 h-3.5 transition-colors ${isGuideOpen ? 'text-[var(--accent-color)]' : 'text-slate-400 opacity-60'}`} />
              </button>

              {/* Natural Dropdown Tooltip Card - drops down directly below 3D Preview in top-left empty space */}
              {isGuideOpen && (
                <div className="absolute top-full left-0 mt-2 w-64 p-3.5 rounded-2xl bg-[#141518]/95 border border-white/15 shadow-2xl backdrop-blur-xl animate-dropdown z-50">
                  <div className="text-xs font-bold text-white mb-2 pb-1.5 border-b border-white/10 flex items-center justify-between">
                    <span>{t.controlsGuideTitle || 'Camera Controls'}</span>
                    <span className="text-[10px] text-slate-400 font-normal">3D Studio</span>
                  </div>
                  <div className="space-y-1.5 text-[11px] font-sans">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400 whitespace-nowrap">{t.controlLeftClick || 'Left-click + Drag'}</span>
                      <span className="font-semibold text-slate-200 whitespace-nowrap">{t.controlRotate || 'Rotate 360°'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400 whitespace-nowrap">{t.controlRightClick || 'Right-click + Drag'}</span>
                      <span className="font-semibold text-slate-200 whitespace-nowrap">{t.controlPan || 'Pan Camera'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-slate-400 whitespace-nowrap">{t.controlScroll || 'Mouse Scroll'}</span>
                      <span className="font-semibold text-slate-200 whitespace-nowrap">{t.controlZoom || 'Zoom In / Out'}</span>
                    </div>
                  </div>
                  {/* Tooltip triangle tail pointing up to 3D Preview badge */}
                  <div className="absolute -top-1.5 left-6 w-3 h-3 bg-[#141518] border-l border-t border-white/15 rotate-45" />
                </div>
              )}
            </div>

            {/* Right: Pure Informative Model Type Badge (Read-only, non-clickable) */}
            <div className="pointer-events-auto select-none">
              <div
                className="flex items-center px-3 h-8 rounded-xl bg-black/50 border border-white/10 text-xs font-semibold text-slate-300 backdrop-blur-md font-sans shadow-md"
                title={modelType === 'slim' ? 'Model: Slim (3px arms)' : 'Model: Classic (4px arms)'}
              >
                <span>{modelType === 'slim' ? (t.filterSlim || 'Slim (3px)') : (t.filterClassic || 'Classic (4px)')}</span>
              </div>
            </div>
          </div>

          {/* 3. Drag Overlay Indicator */}
          {isDragging && (
            <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center rounded-3xl border-2 border-dashed border-[var(--accent-color)] text-white animate-fadeIn pointer-events-none">
              <UploadCloud className="w-12 h-12 text-[var(--accent-color)] animate-bounce mb-2" />
              <span className="font-bold text-sm font-sans">
                {t.dragOrBrowseActive || 'Drop skin .PNG here to equip'}
              </span>
            </div>
          )}

          {/* 4. Bottom Floating Animation & Camera Controls Dock */}
          <div className="relative z-30 w-full flex flex-col items-center p-4 pointer-events-none">
            <div className="bg-black/85 backdrop-blur-xl border-2 border-white/15 p-1.5 rounded-2xl shadow-2xl shadow-black/80 flex items-center gap-1.5 pointer-events-auto">
              {/* Animations: Idle, Walk, Run with smooth sliding selection box */}
              <div className="relative flex items-center gap-1">
                {/* Smooth sliding active background box */}
                <div
                  aria-hidden="true"
                  className="absolute top-0 bottom-0 rounded-xl bg-[var(--accent-color)] shadow-md transition-all duration-250 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-none"
                  style={{
                    width: '56px',
                    left:
                      animationType === 'idle'
                        ? '0px'
                        : animationType === 'walk'
                        ? '60px'
                        : '120px',
                  }}
                />

                {(['idle', 'walk', 'run'] as const).map((anim) => {
                  const isActive = animationType === anim;
                  return (
                    <button
                      key={anim}
                      type="button"
                      onClick={() => handleAnimationChange(anim)}
                      className={`relative z-10 w-14 h-8 rounded-xl text-xs font-bold font-sans tracking-normal select-none cursor-pointer flex items-center justify-center transition-colors duration-200 ${
                        isActive
                          ? 'text-[#070a12]'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {anim === 'idle'
                        ? t.animIdle || 'Idle'
                        : anim === 'walk'
                        ? t.animWalk || 'Walk'
                        : t.animRun || 'Run'}
                    </button>
                  );
                })}
              </div>

              <div className="w-[1px] h-4 bg-white/10 mx-0.5" />

              {/* Auto Rotate 360° Toggle - Static icon with theme highlight */}
              <button
                type="button"
                onClick={handleToggleAutoRotate}
                title={t.btnAutoRotate || 'Auto Rotate 360°'}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                  isAutoRotating
                    ? 'bg-[var(--accent-color)] text-[#070a12] shadow-md'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Rotate3d className="w-4 h-4" />
              </button>

              {/* Reset Camera to Front-Facing View Button */}
              <button
                type="button"
                onClick={handleResetCamera}
                title={t.btnResetCamera || 'Reset Front Camera View'}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer active:scale-95"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Streamlined Unified Skin Management Panel */}
        <div className="lg:col-span-7 flex flex-col h-[570px]">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="glass-panel rounded-3xl p-5 sm:p-6 border border-white/10 bg-[#161719]/90 shadow-sm flex flex-col h-full overflow-hidden space-y-4 relative"
          >
            {/* Top Toolbar: Search Input & Filter Pills Stack */}
            <div className="flex flex-col gap-2.5 shrink-0">
              {/* Row 1: Search Input (Identical 1:1 geometry & typography to ModStore) */}
              <div className="relative w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t.skinSearchPlaceholder || 'Search skins...'}
                  className="w-full glass-input pl-11 pr-10 py-3 rounded-2xl text-sm text-white focus:outline-none focus:border-[var(--accent-color)] shadow-inner transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 hover:bg-white/10 rounded-lg transition text-slate-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Row 2: Sort Dropdown & Count / Batch Delete Action Bar (No separator line) */}
              <div className="flex items-center justify-between gap-3 relative z-30">
                {/* Left Controls Group: Sort Dropdown + Show Equipped First Tick Box */}
                <div className="flex items-center gap-2 sm:gap-2.5">
                  {/* Sort Dropdown Menu (Exact width matching root box) */}
                  <div className="relative w-36 sm:w-40" ref={sortDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setIsSortOpen((prev) => !prev)}
                      className={`w-full h-[34px] px-2.5 rounded-xl border-2 text-xs font-semibold flex items-center justify-between gap-1.5 transition cursor-pointer shrink-0 shadow-sm active:scale-95 select-none ${
                        sortBy !== 'recent'
                          ? 'bg-theme-selected border-[var(--accent-color)] text-white font-bold'
                          : isSortOpen
                          ? 'bg-black/70 border-white/20 text-white'
                          : 'bg-black/40 hover:bg-black/60 border-white/10 text-slate-300 hover:text-white'
                      }`}
                      title={t.sortSkins || 'Sort skin library'}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 truncate">
                        {sortBy === 'az' ? (
                          <ArrowDownAZ className="w-3.5 h-3.5 text-[var(--accent-color)] shrink-0" />
                        ) : sortBy === 'za' ? (
                          <ArrowUpZA className="w-3.5 h-3.5 text-[var(--accent-color)] shrink-0" />
                        ) : sortBy === 'favorite' ? (
                          <SharpStarIcon isFavorite={true} size={14} className="shrink-0" />
                        ) : sortBy === 'oldest' ? (
                          <RotateCcw className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        ) : (
                          <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className="font-sans font-bold truncate">
                          {sortBy === 'az'
                            ? 'A → Z'
                            : sortBy === 'za'
                            ? 'Z → A'
                            : sortBy === 'favorite'
                            ? (t.sortFavorites || 'Favorites')
                            : sortBy === 'oldest'
                            ? (t.sortOldest || 'Oldest')
                            : (t.sortRecent || 'Recent')}
                        </span>
                      </div>
                      <ChevronDown
                        className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 shrink-0 ${
                          isSortOpen ? 'rotate-180 text-white' : ''
                        }`}
                      />
                    </button>

                    {/* Dropdown Options List - Matches root box width (left-0 right-0 w-full) */}
                    {isSortOpen && (
                      <div className="absolute left-0 right-0 top-full mt-1.5 w-full rounded-xl bg-[#141518]/95 border border-white/15 shadow-2xl p-1 z-50 space-y-0.5 animate-dropdown backdrop-blur-md overflow-hidden">
                        {[
                          {
                            key: 'recent' as SkinSortOption,
                            label: t.sortRecent || 'Recent',
                            icon: Clock,
                          },
                          {
                            key: 'oldest' as SkinSortOption,
                            label: t.sortOldest || 'Oldest',
                            icon: RotateCcw,
                          },
                          {
                            key: 'az' as SkinSortOption,
                            label: 'A → Z',
                            icon: ArrowDownAZ,
                          },
                          {
                            key: 'za' as SkinSortOption,
                            label: 'Z → A',
                            icon: ArrowUpZA,
                          },
                          {
                            key: 'favorite' as SkinSortOption,
                            label: t.sortFavorites || 'Favorites',
                            icon: (props: any) => <SharpStarIcon isFavorite={true} size={14} {...props} />,
                          },
                        ].map((opt) => {
                          const isSelected = sortBy === opt.key;
                          const Icon = opt.icon;
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSortBy(opt.key);
                                setIsSortOpen(false);
                              }}
                              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-sans transition cursor-pointer text-left border-2 ${
                                isSelected
                                  ? 'bg-theme-selected border-[var(--accent-color)] text-white font-bold shadow-sm'
                                  : 'border-transparent text-slate-300 hover:text-white hover:bg-white/[0.08]'
                              }`}
                            >
                              <div className="flex items-center gap-2 min-w-0 truncate">
                                <Icon
                                  className={`w-3.5 h-3.5 shrink-0 ${
                                    isSelected ? 'text-[var(--accent-color)]' : 'text-slate-400'
                                  }`}
                                />
                                <span className="truncate">{opt.label}</span>
                              </div>
                              {isSelected && (
                                <Check className="w-3.5 h-3.5 text-[var(--accent-color)] shrink-0 ml-1.5 stroke-[2.5]" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Tick Box: Show Equipped Skin First (Clean checkbox without outer container border) */}
                  <label
                    className="flex items-center gap-2.5 cursor-pointer select-none shrink-0 group py-1.5 px-0.5"
                    title={t.pinEquippedTooltip || 'Show currently equipped skin first in library'}
                  >
                    <div
                      className={`w-5 h-5 rounded-md border-[1.5px] flex items-center justify-center transition-all shrink-0 ${
                        showEquippedFirst
                          ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-[#070a12] shadow-sm'
                          : 'border-white/35 bg-black/40 group-hover:border-white/70 text-transparent'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                    <input
                      type="checkbox"
                      checked={showEquippedFirst}
                      onChange={(e) => setShowEquippedFirst(e.target.checked)}
                      className="hidden"
                    />
                    <span
                      className={`font-sans whitespace-nowrap text-sm transition-colors ${
                        showEquippedFirst
                          ? 'text-white font-semibold'
                          : 'text-slate-300 group-hover:text-white'
                      }`}
                    >
                      {t.showEquippedFirst || 'Show equipped first'}
                    </span>
                  </label>
                </div>

                {/* Total Filtered Skin Count OR Batch Delete Action Bar */}
                {selectedSkinIdsForDelete.length > 0 ? (
                  <div className="flex items-center gap-2 animate-fadeIn select-none">
                    <button
                      type="button"
                      onClick={handleDeleteSelectedSkins}
                      className="px-3 py-1.5 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-400 hover:text-red-300 border border-red-500/40 text-xs font-bold font-sans flex items-center gap-1.5 transition cursor-pointer shadow-md active:scale-95"
                      title={t.deleteSelectedSkins || 'Delete selected skins'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{(t.deleteAction || 'Delete')} ({selectedSkinIdsForDelete.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleClearSelectedSkins}
                      className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs font-sans transition cursor-pointer"
                    >
                      {t.cancel || 'Cancel'}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5 select-none">
                    {deletedPresetIds.length > 0 && (
                      <button
                        type="button"
                        onClick={handleRestoreDefaults}
                        className="text-xs text-[var(--accent-color)] hover:underline cursor-pointer font-sans font-semibold transition-colors"
                        title={t.restorePresetsTooltip || 'Restore deleted default presets'}
                      >
                        {t.restorePresetsBtn || 'Restore presets'}
                      </button>
                    )}
                    <div className="text-xs font-sans text-slate-300 px-3 py-1.5 rounded-xl bg-black/40 border border-white/10 shrink-0 select-none flex items-center gap-1">
                      <span className="text-white font-bold">{filteredSkins.length}</span>
                      <span className="text-slate-400 font-medium">{t.skinsCountUnit || 'skins'}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Skin Cards Grid (With 3 Columns for Prominent, Rounded, High-Impact Cards) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 sm:gap-4 overflow-y-auto p-2 sm:p-2.5 pr-2 custom-scrollbar flex-1 min-h-0">
              {/* Card #1: Permanent Add Skin Action Slot (Minecraft Bedrock / Roblox Game Style) */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`rounded-3xl p-3 border-[2.5px] border-dashed transition-all duration-200 cursor-pointer flex flex-col items-center justify-between h-[195px] relative group select-none shrink-0 ${
                  isDragging
                    ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/[0.06] ring-2 ring-[var(--accent-color)]/30 scale-[1.01]'
                    : 'border-white/15 hover:border-[var(--accent-color)]/80 bg-white/[0.02] hover:bg-[var(--accent-color)]/[0.04] hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/30'
                }`}
                title={t.browseSkinTooltip || 'Click to browse .PNG or drop skin file here'}
              >
                {/* Top spacer */}
                <div className="h-4 w-full shrink-0" />

                {/* Center Plus Icon */}
                <div className="h-[92px] w-full flex items-center justify-center shrink-0">
                  <Plus className="w-11 h-11 sm:w-12 sm:h-12 stroke-[2.25] text-[var(--accent-color)] group-hover:scale-110 group-hover:text-white transition-all duration-200 ease-out" />
                </div>

                {/* Bottom Labels with Title & Drag/Drop PNG Subtext */}
                <div className="w-full flex flex-col items-center justify-center text-center mt-auto shrink-0 pb-1">
                  <div className="text-sm sm:text-base font-black text-white truncate font-sans group-hover:text-[var(--accent-light)] transition-colors tracking-wide uppercase leading-tight">
                    {t.addSkinBtn || 'Add Skin'}
                  </div>
                  <div className="text-[11px] font-medium text-slate-400 group-hover:text-slate-300 transition-colors font-sans mt-1 tracking-normal">
                    {t.dropPngSubtext || 'Drag & drop .PNG here'}
                  </div>
                </div>
              </div>

              {filteredSkins.map((item) => {
                const isSelected = previewSkinUrl === item.skinUrl;
                const isCurrentActive = activeSkinUrl === item.skinUrl;
                const isSelectedForDelete = selectedSkinIdsForDelete.includes(item.id);

                return (
                  <div
                    key={item.id}
                    onClick={() => {
                      setPreviewSkinUrl(item.skinUrl);
                      if (item.model) setModelType(item.model);
                    }}
                    onDoubleClick={(e) => handleQuickEquip(item, e)}
                    title={
                      isCurrentActive
                        ? (t.equippedSkinTooltip || 'Currently equipped skin')
                        : (t.skinPreviewEquipTooltip || 'Click to preview • Double-click to equip')
                    }
                    className={`rounded-3xl p-3 border-[2.5px] transition-all duration-200 cursor-pointer flex flex-col items-center justify-between h-[195px] relative group select-none shrink-0 ${
                      isSelectedForDelete
                        ? 'border-red-500/70 bg-red-500/[0.06] ring-2 ring-red-500/20 -translate-y-0.5'
                        : isSelected
                        ? 'bg-theme-selected border-[var(--accent-color)] shadow-lg shadow-black/40 -translate-y-0.5'
                        : 'bg-black/35 border-white/10 hover:border-white/25 hover:bg-white/[0.04] hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/30'
                    }`}
                  >
                    {/* Top-Left: Translucent Checkbox for Selecting/Deleting Skins (SWAPPED TO TOP-LEFT!) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSelectSkin(item.id);
                      }}
                      title={isSelectedForDelete ? (t.deselect || 'Deselect') : (t.selectToDelete || 'Select to delete')}
                      className={`absolute top-2.5 left-2.5 w-6 h-6 rounded-lg border flex items-center justify-center transition-all duration-150 z-20 cursor-pointer ${
                        isSelectedForDelete
                          ? 'bg-red-500 border-red-400 text-white shadow-md'
                          : 'bg-black/50 border-white/20 hover:border-white/50 text-transparent hover:bg-black/70'
                      }`}
                    >
                      <Check className={`w-3.5 h-3.5 stroke-[3] transition-opacity ${isSelectedForDelete ? 'opacity-100' : 'opacity-0'}`} />
                    </button>

                    {/* Top-Right: Pure Gold Star Favorite (Aligned 1:1 with left checkbox) */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavoriteSkin(item.id);
                      }}
                      title={
                        favoriteSkinIds.includes(item.id)
                          ? (t.removeFromFavorites || 'Remove from favorites')
                          : (t.addToFavorites || 'Add to favorites')
                      }
                      className="absolute top-2.5 right-2.5 w-6 h-6 z-20 cursor-pointer transition-transform duration-150 active:scale-90 hover:scale-115 flex items-center justify-center select-none bg-transparent border-none outline-none group/star"
                    >
                      {favoriteSkinIds.includes(item.id) ? (
                        <SharpStarIcon isFavorite={true} size={20} />
                      ) : (
                        <div className="opacity-0 group-hover:opacity-100 group-hover/star:opacity-100 transition-opacity flex items-center justify-center w-full h-full">
                          <SharpStarIcon isFavorite={false} size={20} />
                        </div>
                      )}
                    </button>

                    {/* Center EQUIPPED Badge: Translucent backdrop box with border (prominent, readable) */}
                    {isCurrentActive && (
                      <div
                        title={t.currentlyEquipped || 'Currently Equipped'}
                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-3.5 py-1 rounded-full bg-[#121212]/85 border border-emerald-400/60 text-emerald-400 text-xs font-black font-sans tracking-wider uppercase shadow-xl shadow-black/80 backdrop-blur-md z-20 pointer-events-none select-none animate-fadeIn flex items-center justify-center whitespace-nowrap"
                      >
                        {t.equipped || 'EQUIPPED'}
                      </div>
                    )}

                    {/* Top Spacer matching badge height */}
                    <div className="h-6 w-full shrink-0" />

                    {/* 2D Full-Body Skin Canvas with FIXED 104px height (Position is 100% stable and NEVER shifts!) */}
                    <div className="h-[104px] w-full flex items-center justify-center shrink-0">
                      <SkinFullBody
                        skinUrl={item.skinUrl}
                        model={item.model || 'classic'}
                        width={48}
                        height={96}
                      />
                    </div>

                    {/* Bottom Name & Hot Inline Rename with FIXED 36px height (mt-auto) */}
                    <div
                      className="h-9 w-full flex items-center justify-center shrink-0 mt-auto px-1"
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      {editingSkinId === item.id ? (
                        <div className="w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={editingNameValue}
                            onChange={(e) => setEditingNameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSaveRename(item.id);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                handleCancelRename();
                              }
                            }}
                            onBlur={() => handleSaveRename(item.id)}
                            autoFocus
                            maxLength={24}
                            className="w-full text-center text-sm font-bold text-white bg-black/60 border border-[var(--accent-color)]/80 rounded-xl px-2.5 py-1 outline-none font-sans shadow-sm transition-all selection:bg-[var(--accent-color)] selection:text-white"
                          />
                        </div>
                      ) : (
                        <div
                          onClick={(e) => handleStartRename(item.id, item.name, e)}
                          title={t.clickToRename || 'Click to rename'}
                          className="px-2.5 py-1 rounded-xl border border-transparent hover:border-white/15 hover:bg-white/[0.08] cursor-text transition-all duration-150 max-w-full flex items-center justify-center select-none group/name"
                        >
                          <span className="text-sm font-bold text-white font-sans tracking-normal leading-tight group-hover/name:text-[var(--accent-light)] transition-colors truncate max-w-[130px]">
                            {item.name}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

                {filteredSkins.length === 0 && (
                  <div className="col-span-full py-12 flex flex-col items-center justify-center text-center">
                    <Shirt className="w-10 h-10 text-slate-600 mb-2" />
                    <div className="text-sm font-bold text-white font-sans">
                      {t.noSkinsFound || 'No skins matching your filter'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      {t.noSkinsFoundDesc || 'Try searching another skin name or reset filters'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
  );
};
