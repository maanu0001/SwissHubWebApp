'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runDecayAction } from '@/modules/level/actions';

/**
 * Führt den Inaktivitäts-Abzug sofort aus.
 *
 * Derselbe Durchgang, den auch der Hintergrundjob startet - nur ohne auf den
 * nächsten Zeitpunkt zu warten. Mehrfaches Auslösen zieht nichts doppelt ab:
 * gerechnet wird in vollen Tagen ab dem letzten Abzug.
 */
export function DecayRunner({ csrfToken }: { csrfToken: string }): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const run = async (): Promise<void> => {
    setPending(true);
    const response = await runDecayAction({ csrfToken, limit: 500 });
    setPending(false);

    if (!response.ok) {
      toast.error(response.error.message);
      return;
    }

    const { checked, changed, totalDecayed } = response.data;
    toast.success(
      changed === 0
        ? `${checked} Profile geprüft - es war nichts fällig.`
        : `${changed} von ${checked} Profilen angepasst, insgesamt ${totalDecayed} XP abgezogen.`,
    );
    router.refresh();
  };

  return (
    <Button variant="outline" disabled={pending} onClick={() => void run()}>
      <Play aria-hidden="true" />
      {pending ? 'Läuft…' : 'Jetzt ausführen'}
    </Button>
  );
}
