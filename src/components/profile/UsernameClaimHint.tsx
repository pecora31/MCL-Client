import React from 'react';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';
import type { NameAvailability } from '../../hooks/useUsernameClaimCheck';
import { getTranslation, type Language } from '../../locales/i18n';

interface UsernameClaimHintProps {
  status: NameAvailability;
  suggestions: string[];
  onPickSuggestion: (name: string) => void;
  language: Language;
}

// Sits under a name input and warns without blocking: a clash only changes which skin other
// players see, so the player is still free to save the name if they want it anyway.
export const UsernameClaimHint: React.FC<UsernameClaimHintProps> = ({
  status,
  suggestions,
  onPickSuggestion,
  language,
}) => {
  const t = getTranslation(language);

  if (status === 'checking') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t.usernameChecking || 'Checking name…'}
      </p>
    );
  }

  if (status === 'invalid') {
    return (
      <p className="flex items-start gap-1.5 text-[11px] text-slate-400 leading-snug">
        <Info className="w-3.5 h-3.5 shrink-0 mt-px" />
        {t.usernameInvalidForSkin || 'Skin sync only works with 3–16 letters, digits or underscores.'}
      </p>
    );
  }

  if (status !== 'taken') return null;

  return (
    <div className="space-y-1.5 text-[11px] leading-snug">
      <p className="flex items-start gap-1.5 text-amber-300">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
        {t.usernameTakenWarning ||
          'Another MCL player already uses this name for skin sync — other players would see their skin instead of yours.'}
      </p>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-400">{t.usernameSuggestionsLabel || 'Try:'}</span>
          {suggestions.map((name) => (
            <button
              key={name}
              type="button"
              // Keeps focus in the input, which saves on blur in the quick-rename popout
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPickSuggestion(name)}
              className="px-2 py-0.5 rounded-md bg-white/10 hover:bg-[var(--accent-color)]/25 text-white font-semibold transition cursor-pointer"
            >
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
