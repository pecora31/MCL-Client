import React from 'react';

interface RadioProps {
  checked: boolean;
  onChange: () => void;
  name: string;
  className?: string;
}

/**
 * A custom-drawn radio dot, matching Checkbox's material: dark even when unchecked. A native
 * `<input type="radio">` styled with `accent-*` still paints its own unchecked state as a
 * plain white circle in every browser, which stands out against the app's dark surfaces.
 */
export const Radio: React.FC<RadioProps> = ({ checked, onChange, name, className = '' }) => (
  <span className={`relative inline-flex shrink-0 ${className}`}>
    <input
      type="radio"
      name={name}
      checked={checked}
      onChange={onChange}
      className="absolute inset-0 opacity-0 cursor-pointer"
    />
    <span
      aria-hidden="true"
      className={`w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center transition-all ${
        checked ? 'border-[var(--accent-color)] bg-black/40' : 'border-white/35 bg-black/40'
      }`}
    >
      {checked && <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent-color)]" />}
    </span>
  </span>
);
