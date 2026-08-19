'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { runJailReconciliationAction } from '@/modules/settings/actions';

/**
 * Manueller Abgleich zwischen Datenbank und Discord.
 * Erkennt z.B. "DB sagt gejailt, Jail-Rolle fehlt" und korrigiert es.
 */
export function ReconciliationPanel({ csrfToken }: { csrfToken: string }): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [scanOrphans, setScanOrphans] = useState(false);

  async function handleRun(): Promise<void> {
    if (pending) {
      return;
    }
    setPending(true);
    const response = await runJailReconciliationAction({ csrfToken, scanOrphans });
    setPending(false);

    if (response.ok) {
      toast.success('Abgleich abgeschlossen.', {
        description: `${response.data.checked} geprüft · ${response.data.drift} Abweichungen · ${response.data.repaired} korrigiert`,
      });
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
        <div>
          <Label htmlFor="scan-orphans">Verwaiste Jail-Rollen suchen</Label>
          <p className="text-xs text-muted-foreground">
            Durchsucht bis zu 1000 Mitglieder nach der Jail-Rolle ohne aktiven Jail (langsamer).
          </p>
        </div>
        <Switch id="scan-orphans" checked={scanOrphans} onCheckedChange={setScanOrphans} />
      </div>
      <Button onClick={() => void handleRun()} loading={pending} variant="outline">
        <RefreshCw aria-hidden="true" />
        Abgleich jetzt ausführen
      </Button>
    </div>
  );
}
