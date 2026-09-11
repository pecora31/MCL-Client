import React from 'react';
import type { SystemInfo } from '../../types';
import { SmoothRange } from './SmoothRange';

interface RamAllocationFieldProps {
  value: number;
  onChange: (mb: number) => void;
  systemInfo: SystemInfo | null;
  min?: number;
  step?: number;
}

/**
 * The one "Allocated RAM" control — Create and Edit Profile used to each hand-roll their own
 * copy (different title, different recommended-value styling, one of them missing the
 * recommended marker entirely) and drifted apart. Both now render this instead, so a future
 * change to one applies to both automatically.
 */
export const RamAllocationField: React.FC<RamAllocationFieldProps> = ({
  value,
  onChange,
  systemInfo,
  min = 2048,
  step = 1024,
}) => {
  // Draggable all the way to what's actually installed rather than stopping at the
  // recommended ceiling — going past it is allowed, just called out below.
  const sliderMax = systemInfo?.totalRamMb ?? 16384;
  const span = Math.max(sliderMax - min, 1024);
  // Where "recommended" actually falls along that same range, so the marker sits under the
  // point on the track it describes instead of a fixed slot.
  const recommendedPct = systemInfo
    ? Math.min(100, Math.max(0, Math.round(((systemInfo.recommendedRamMb - min) / span) * 100)))
    : 50;
  // Centering the label would let it hang off either end of the track and overlap the
  // "2 GB" / installed labels next to it — anchor by the near edge instead once the tick
  // gets close to one.
  const recommendedAnchor =
    recommendedPct < 15 ? 'translateX(0%)' : recommendedPct > 85 ? 'translateX(-100%)' : 'translateX(-50%)';
  // A plain `${pct}%` puts the tick at that fraction of the TRACK's own width, but the thumb
  // it's meant to line up with never reaches the track's edges — a round 14px thumb (see
  // index.css) travels from its own half-width in from one end to the same half-width from
  // the other, so a plain percentage always sits the tick further out than the thumb, worse
  // the further the value is from the middle. This mirrors the thumb's own offset instead.
  const thumbPx = 14;
  const recommendedLeft = `calc(${thumbPx / 2}px + (100% - ${thumbPx}px) * ${recommendedPct / 100})`;

  return (
    <div className="space-y-2.5 p-4.5 rounded-xl bg-white/[0.02] border border-white/[0.06]">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] font-bold text-slate-200 uppercase tracking-wider">Allocated RAM:</span>
        <span className="text-[var(--accent-color)] text-base font-extrabold">{(value / 1024).toFixed(1)} GB RAM</span>
      </div>

      <SmoothRange min={min} max={sliderMax} step={step} value={value} onChange={onChange} />

      {systemInfo && (
        <div className="relative h-6">
          <span
            className="absolute top-0 w-px h-2.5 bg-[var(--accent-color)]/70"
            style={{ left: recommendedLeft }}
          />
          <span
            className="absolute top-2.5 text-xs font-bold text-[var(--accent-light)] whitespace-nowrap"
            style={{ left: recommendedLeft, transform: recommendedAnchor }}
          >
            {(systemInfo.recommendedRamMb / 1024).toFixed(0)} GB recommended
          </span>
        </div>
      )}

      <div className="relative h-4 text-xs font-medium text-slate-400 mt-1">
        <span className="absolute left-0">{(min / 1024).toFixed(0)} GB</span>
        <span className="absolute right-0">
          {systemInfo ? `${(systemInfo.totalRamMb / 1024).toFixed(0)} GB installed` : '16 GB'}
        </span>
      </div>

      {systemInfo && value > systemInfo.recommendedMaxRamMb && (
        <p className="text-xs text-amber-300 leading-relaxed pt-1.5 font-medium">
          This is more than the computer can comfortably spare — Windows and the game itself may not
          have enough memory left to run.
        </p>
      )}
    </div>
  );
};
