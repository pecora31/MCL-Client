import { useEffect, useState } from 'react';
import { invokeCommand } from '../services/api';

export type NameAvailability = 'idle' | 'checking' | 'invalid' | 'yours' | 'available' | 'taken';

interface UsernameClaimCheck {
  status: Exclude<NameAvailability, 'idle' | 'checking'>;
  suggestions: string[];
}

/**
 * Asks the skin service whether another MCL player already publishes a skin under the name
 * being typed. Waits for typing to pause, and stays silent when the check itself fails — an
 * unreachable service is no reason to nag someone who is only renaming themselves.
 */
export function useUsernameClaimCheck(candidate: string, currentName: string) {
  const [status, setStatus] = useState<NameAvailability>('idle');
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    const name = candidate.trim();
    setSuggestions([]);
    if (!name || name === currentName) {
      setStatus('idle');
      return;
    }

    setStatus('checking');
    let cancelled = false;
    const timer = setTimeout(() => {
      invokeCommand<UsernameClaimCheck>('check_username_claim', { username: name })
        .then((result) => {
          if (cancelled) return;
          setStatus(result.status);
          setSuggestions(result.suggestions);
        })
        .catch(() => {
          if (!cancelled) setStatus('idle');
        });
    }, 600);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [candidate, currentName]);

  return { status, suggestions };
}
