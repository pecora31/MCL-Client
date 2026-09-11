import React from 'react';
import { Check } from 'lucide-react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: React.ReactNode;
  title?: string;
  disabled?: boolean;
  /** Top-align the box against multi-line label content instead of centering it on one line. */
  align?: 'center' | 'start';
  className?: string;
}

/**
 * The app's one checkbox design — a custom drawn box (native checkboxes render differently,
 * and more crudely, per platform). First established for "Show equipped first" in the Skin
 * tab; every other checkbox in the app should build on this rather than a bare
 * `<input type="checkbox">` styled with `accent-*`.
 */
export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  children,
  title,
  disabled = false,
  align = 'center',
  className = '',
}) => (
  <label
    className={`flex ${align === 'start' ? 'items-start' : 'items-center'} gap-2.5 select-none group ${
      disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
    } ${className}`}
    title={title}
  >
    <div
      className={`w-5 h-5 rounded-md border-[1.5px] flex items-center justify-center transition-all shrink-0 ${
        align === 'start' ? 'mt-0.5' : ''
      } ${
        checked
          ? 'bg-[var(--accent-color)] border-[var(--accent-color)] text-[#070a12] shadow-sm'
          : 'border-white/35 bg-black/40 group-hover:border-white/70 text-transparent'
      }`}
    >
      <Check className="w-3.5 h-3.5 stroke-[3]" />
    </div>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="hidden"
    />
    {children}
  </label>
);
