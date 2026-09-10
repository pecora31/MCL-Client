import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  badge?: string;
  description?: string;
  disabled?: boolean;
}

export interface CustomSelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  menuClassName?: string;
  maxMenuHeight?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  id?: string;
}

export function CustomSelect<T extends string = string>({
  value,
  onChange,
  options,
  placeholder = 'Select an option',
  disabled = false,
  className = '',
  menuClassName = '',
  maxMenuHeight = 'max-h-60',
  searchable,
  searchPlaceholder = 'Search...',
  id,
}: CustomSelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-enable search if there are 8 or more options unless explicitly set to false
  const shouldEnableSearch = searchable ?? (options.length >= 8);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value]
  );

  const filteredOptions = useMemo(() => {
    if (!shouldEnableSearch || !searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase().trim();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) ||
        (opt.badge && opt.badge.toLowerCase().includes(query)) ||
        (opt.description && opt.description.toLowerCase().includes(query))
    );
  }, [options, searchQuery, shouldEnableSearch]);

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;

    if (!isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      // If less than 240px below and more space above, open upward
      if (spaceBelow < 240 && spaceAbove > spaceBelow) {
        setOpenUpward(true);
      } else {
        setOpenUpward(false);
      }
      setSearchQuery('');
    }
    setIsOpen(!isOpen);
  };

  const handleSelect = (option: SelectOption<T>, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (option.disabled) return;
    onChange(option.value);
    setIsOpen(false);
    setSearchQuery('');
  };

  useEffect(() => {
    if (!isOpen) return;

    // Focus search input when menu opens
    if (shouldEnableSearch && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    }

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, shouldEnableSearch]);

  return (
    <div ref={containerRef} className="relative w-full text-left" id={id}>
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-[#141416] border transition-all duration-150 text-xs font-medium cursor-pointer ${
          isOpen
            ? 'border-[var(--accent-color)] ring-1 ring-[var(--accent-color)]/30 bg-[#19191d] text-white shadow-lg'
            : 'border-white/[0.08] hover:border-white/20 text-slate-200 hover:bg-[#18181b]'
        } ${disabled ? 'opacity-40 cursor-not-allowed hover:border-white/[0.08] hover:bg-[#141416]' : ''} ${className}`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className={`truncate ${selectedOption ? 'text-white' : 'text-slate-500'}`}>
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.badge && (
            <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold bg-white/5 border border-white/10 text-slate-400 shrink-0">
              {selectedOption.badge}
            </span>
          )}
        </div>

        <ChevronDown
          className={`w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0 ${
            isOpen ? 'rotate-180 text-[var(--accent-light)]' : ''
          }`}
        />
      </button>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div
          role="listbox"
          className={`absolute left-0 w-full rounded-2xl bg-[#141416]/98 border border-white/[0.12] shadow-2xl p-1.5 z-[60] space-y-0.5 animate-dropdown backdrop-blur-xl ${
            openUpward ? 'bottom-[calc(100%+6px)] origin-bottom' : 'top-[calc(100%+6px)] origin-top'
          } ${menuClassName}`}
        >
          {/* Optional Search Filter Header */}
          {shouldEnableSearch && (
            <div className="px-1.5 pb-1.5 pt-1 border-b border-white/[0.06] mb-1">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[var(--accent-color)] font-medium"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          )}

          {/* Options List */}
          <div className={`${maxMenuHeight} overflow-y-auto space-y-0.5 custom-scrollbar pr-0.5`}>
            {filteredOptions.length === 0 ? (
              <div className="py-3 px-3 text-center text-xs text-slate-500 font-medium">
                No matching options found
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={opt.disabled}
                    onClick={(e) => handleSelect(opt, e)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--accent-color)]/15 text-[var(--accent-light)] font-bold border border-[var(--accent-color)]/30 shadow-sm'
                        : opt.disabled
                        ? 'text-slate-600 cursor-not-allowed opacity-50 border border-transparent'
                        : 'text-slate-300 hover:bg-white/[0.06] hover:text-white border border-transparent'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="truncate font-medium flex items-center gap-1.5">
                        <span className="truncate">{opt.label}</span>
                      </div>
                      {opt.description && (
                        <div className="text-[10px] text-slate-400 font-normal truncate mt-0.5 leading-snug">
                          {opt.description}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {opt.badge && (
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border ${
                            isSelected
                              ? 'bg-[var(--accent-color)]/20 border-[var(--accent-color)]/40 text-[var(--accent-light)]'
                              : 'bg-white/5 border-white/10 text-slate-400'
                          }`}
                        >
                          {opt.badge}
                        </span>
                      )}
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-[var(--accent-color)] shrink-0" strokeWidth={2.5} />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CustomSelect;
