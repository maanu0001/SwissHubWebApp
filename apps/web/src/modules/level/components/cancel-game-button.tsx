'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cancelGameAction } from '@/modules/level/actions';

/**
 * Bricht eine laufende Partie ab.
 *
 * Bereits eingezogene Einsätze fliessen dabei an beide Seiten zurück - das
 * erledigt der Dienst, nicht diese Schaltfläche.
 */
export function CancelGameButton({
  csrfToken,
  matchId,
}: {
  csrfToken: string;
  matchId: string;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const cancel = async (): Promise<void> => {
    setPending(true);
    const response = await cancelGameAction({ csrfToken, matchId });
    setPending(false);

    if (!response.ok) {
      toast.error(response.error.message);
      return;
    }
    toast.success('Partie abgebrochen, die Einsätze sind zurück.');
    router.refresh();
  };

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => void cancel()}>
      Abbrechen
    </Button>
  );
}
