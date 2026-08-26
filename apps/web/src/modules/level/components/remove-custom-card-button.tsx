'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';

/**
 * Entfernt die eigene Levelkarte eines anderen Mitglieds.
 *
 * Fuer den Fall, dass jemand ein Bild hinterlegt, das nicht auf den Server
 * gehoert. Die Berechtigung prueft der Dienst - dieser Knopf erscheint nur,
 * wo die Oberflaeche sie ohnehin schon kennt.
 */
export function RemoveCustomCardButton({
  discordId,
  csrfToken,
}: {
  discordId: string;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);

  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={laeuft} onClick={() => setOffen(true)}>
        <Trash2 className="size-4" aria-hidden="true" />
        Karte entfernen
      </Button>

      <ConfirmationDialog
        open={offen}
        onOpenChange={setOffen}
        title="Level-Card entfernen?"
        description="Für dieses Mitglied gilt danach wieder die normale Level-Card. Der Vorgang steht im Audit Log."
        confirmLabel="Entfernen"
        destructive
        onConfirm={async () => {
          setLaeuft(true);
          const form = new FormData();
          form.set('csrfToken', csrfToken);
          form.set('discordId', discordId);
          const antwort = await fetch('/api/level/custom-card', { method: 'DELETE', body: form });
          const daten = (await antwort.json()) as { ok: boolean; error?: { message: string } };
          if (daten.ok) {
            toast.success('Level-Card entfernt.');
            router.refresh();
          } else {
            toast.error(daten.error?.message ?? 'Das hat nicht geklappt.');
          }
          setLaeuft(false);
          setOffen(false);
        }}
      />
    </>
  );
}
