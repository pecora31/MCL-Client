import React, { useEffect, useRef, useState } from 'react';

interface SmoothRangeProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  className?: string;
  'aria-label'?: string;
}

const GLIDE_MS = 180;

/**
 * A range slider for coarse steps (whole GB of RAM, a handful of blur levels) that doesn't
 * jump between them. The thumb follows the pointer freely while dragging, `onChange` fires with
 * the nearest step as it's crossed, and on release (or a key press) the thumb glides onto that
 * step instead of teleporting there.
 */
export const SmoothRange: React.FC<SmoothRangeProps> = ({
  min,
  max,
  step,
  value,
  onChange,
  className = 'w-full cursor-pointer',
  ...rest
}) => {
  // Where the thumb is drawn while it's away from a step; null means "sitting on `value`"
  const [position, setPosition] = useState<number | null>(null);
  const positionRef = useRef<number | null>(null);
  const emittedRef = useRef(value);
  const frameRef = useRef(0);

  useEffect(() => {
    emittedRef.current = value;
  }, [value]);
  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  // The top step can sit below `max` when the range isn't a whole number of steps
  // (e.g. 15.8 GB installed), matching what a native stepped slider would allow
  const lastStep = min + Math.floor((max - min) / step) * step;
  const snap = (raw: number) => Math.min(Math.max(min + Math.round((raw - min) / step) * step, min), lastStep);

  const move = (next: number | null) => {
    positionRef.current = next;
    setPosition(next);
  };

  const emit = (next: number) => {
    if (next === emittedRef.current) return;
    emittedRef.current = next;
    onChange(next);
  };

  const glide = (from: number, to: number) => {
    cancelAnimationFrame(frameRef.current);
    if (from === to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      move(null);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / GLIDE_MS);
      if (t >= 1) {
        move(null);
        return;
      }
      move(from + (to - from) * (1 - Math.pow(1 - t, 3)));
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  };

  const release = () => {
    const current = positionRef.current;
    if (current !== null) glide(current, snap(current));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const base = emittedRef.current;
    const targets: Record<string, number> = {
      ArrowRight: base + step,
      ArrowUp: base + step,
      ArrowLeft: base - step,
      ArrowDown: base - step,
      PageUp: base + step * 2,
      PageDown: base - step * 2,
      Home: min,
      End: lastStep,
    };
    if (!(e.key in targets)) return;
    e.preventDefault();
    const from = positionRef.current ?? base;
    const target = snap(targets[e.key]);
    emit(target);
    glide(from, target);
  };

  const shown = position ?? Math.min(Math.max(value, min), max);
  const pct = ((shown - min) / Math.max(max - min, 1)) * 100;

  return (
    <input
      {...rest}
      type="range"
      min={min}
      max={max}
      step="any"
      value={shown}
      aria-valuenow={value}
      style={{
        background: `linear-gradient(to right, var(--accent-color, #10b981) ${pct}%, rgba(255,255,255,0.08) ${pct}%)`,
      }}
      onPointerDown={() => window.addEventListener('pointerup', release, { once: true })}
      onChange={(e) => {
        cancelAnimationFrame(frameRef.current);
        const raw = Number(e.target.value);
        move(raw);
        emit(snap(raw));
      }}
      onKeyDown={handleKeyDown}
      onBlur={release}
      className={className}
    />
  );
};
