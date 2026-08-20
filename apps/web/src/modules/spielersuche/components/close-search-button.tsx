'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { closeSearchAction } from '@/modules/spielersuche/actions';

/**
 * Beendet eine Suche.
 *
 * Ruft dieselbe Funktion wie der Discord-Knopf "Suechi beende" - die
 * Berechtigung prüft der Server erneut.
 */
export function CloseSearchButton({
  csrfToken,
  matchId,
  label = 'Suche beenden',
  size = 'sm',
}: {
  csrfToken: string;
  matchId: string;
  label?: string;
  size?: 'sm' | 'default';
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleClose(): Promise<void> {
    setPending(true);
    const response = await closeSearchAction({ csrfToken, matchId });
    if (response.ok) {
      toast.success('Die Spielersuche wurde beendet.', {
        description: response.data.voiceDeleted
          ? 'Der Sprachkanal wurde gelöscht.'
          : 'Der Sprachkanal verschwindet, sobald er leer ist.',
      });
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
    setPending(false);
  }

  return (
    <Button variant="outline" size={size} loading={pending} onClick={() => void handleClose()}>
      <X aria-hidden="true" />
      {label}
    </Button>
  );
}
