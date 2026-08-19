'use client';

import { useEffect, useState } from 'react';
import { formatDuration } from '@swisshub/shared';

/**
 * Live-Anzeige der verbleibenden Zeit.
 * Rein kosmetisch - die tatsaechliche Freilassung steuert der Bot anhand der
 * Datenbank.
 */
export function RemainingTime({ endsAt }: { endsAt: string }): React.JSX.Element {
  const target = new Date(endsAt).getTime();
  const [remaining, setRemaining] = useState(() => target - Date.now());

  useEffect(() => {
    const timer = setInterval(() => setRemaining(target - Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [target]);

  if (remaining <= 0) {
    return <span className="text-warning">Faellig</span>;
  }
  return <span className="tabular-nums">{formatDuration(remaining)}</span>;
}
