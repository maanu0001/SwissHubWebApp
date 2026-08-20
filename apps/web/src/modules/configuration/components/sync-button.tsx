'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { syncDiscordAction } from '@/modules/configuration/actions';

/** Startet den Discord-Abgleich und meldet das Ergebnis konkret zurück. */
export function SyncButton({
  csrfToken,
  disabled,
  label = 'Jetzt synchronisieren',
}: {
  csrfToken: string;
  disabled?: boolean;
  label?: string;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function run(): Promise<void> {
    setPending(true);
    const response = await syncDiscordAction({ csrfToken });
    setPending(false);

    if (response.ok) {
      const { roles, channels, removedRoles, removedChannels } = response.data;
      const removed =
        removedRoles + removedChannels > 0 ? `, ${removedRoles + removedChannels} entfernt` : '';
      toast.success(`Abgleich fertig: ${roles} Rollen, ${channels} Channels${removed}.`);
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  return (
    <Button type="button" onClick={() => void run()} loading={pending} disabled={disabled}>
      <RefreshCw className="size-4" aria-hidden="true" />
      {label}
    </Button>
  );
}
