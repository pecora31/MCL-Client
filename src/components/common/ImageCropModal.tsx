import React, { useEffect, useRef, useState } from 'react';
import { X, Check, ZoomIn } from 'lucide-react';

interface ImageCropModalProps {
  isOpen: boolean;
  src: string;
  /** Width divided by height of the area the result will fill */
  aspect: number;
  /** Longest edge of the exported image, kept small so it still fits in local storage */
  outputWidth?: number;
  title?: string;
  onCancel: () => void;
  onCropped: (dataUrl: string) => void;
}

const FRAME_WIDTH = 460;

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  src,
  aspect,
  outputWidth = 1600,
  title = 'Adjust image',
  onCancel,
  onCropped,
}) => {
  const frameHeight = Math.round(FRAME_WIDTH / aspect);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const dragState = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setNatural(null);
    const img = new Image();
    img.onload = () => {
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      // Start on the middle of the picture, which is what people usually want to keep
      const fit = Math.max(FRAME_WIDTH / img.naturalWidth, frameHeight / img.naturalHeight);
      setOffset({
        x: Math.min(0, (FRAME_WIDTH - img.naturalWidth * fit) / 2),
        y: Math.min(0, (frameHeight - img.naturalHeight * fit) / 2),
      });
    };
    img.src = src;
  }, [isOpen, src, frameHeight]);

  if (!isOpen) return null;

  // At zoom 1 the picture exactly covers the frame, so there is never an empty edge
  const baseScale = natural
    ? Math.max(FRAME_WIDTH / natural.w, frameHeight / natural.h)
    : 1;
  const scale = baseScale * zoom;
  const displayW = natural ? natural.w * scale : FRAME_WIDTH;
  const displayH = natural ? natural.h * scale : frameHeight;

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const clampOffset = (x: number, y: number) => ({
    x: clamp(x, Math.min(0, FRAME_WIDTH - displayW), 0),
    y: clamp(y, Math.min(0, frameHeight - displayH), 0),
  });

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    setOffset(clampOffset(drag.ox + (e.clientX - drag.x), drag.oy + (e.clientY - drag.y)));
  };

  const handlePointerUp = () => {
    dragState.current = null;
  };

  const handleConfirm = () => {
    if (!natural) return;
    const canvas = document.createElement('canvas');
    const width = Math.min(outputWidth, Math.round(natural.w));
    canvas.width = width;
    canvas.height = Math.round(width / aspect);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Map the visible part of the frame back onto the original image
    const sx = -offset.x / scale;
    const sy = -offset.y / scale;
    const sw = FRAME_WIDTH / scale;
    const sh = frameHeight / scale;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      onCropped(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.src = src;
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-fadeIn">
      <div className="w-full max-w-[520px] bg-[#121212] rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
          <h3 className="text-sm font-bold text-white">{title}</h3>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div
            className="relative mx-auto overflow-hidden rounded-xl border border-white/10 bg-black cursor-move touch-none"
            style={{ width: FRAME_WIDTH, height: frameHeight }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {natural ? (
              <img
                src={src}
                alt="Crop preview"
                draggable={false}
                className="absolute select-none max-w-none"
                style={{
                  width: displayW,
                  height: displayH,
                  left: offset.x,
                  top: offset.y,
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
                Loading image...
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <ZoomIn className="w-4 h-4 text-slate-400 shrink-0" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full cursor-pointer"
            />
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            Drag the image to reposition it and use the slider to zoom. Only the framed area is kept.
          </p>
        </div>

        <div className="px-5 py-4 border-t border-white/5 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-white/5 hover:bg-white/10 text-slate-300 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!natural}
            className="btn-primary px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            Use image
          </button>
        </div>
      </div>
    </div>
  );
};
