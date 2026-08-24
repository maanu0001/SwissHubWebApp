'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { duplicateTournamentAction } from '@/modules/tournaments/admin-actions';

/**
 * Ein Turnier als Vorlage verwenden.
 *
 * Übernommen werden Einstellungen, Regeln, Preise und Zusatzfragen - nicht
 * Anmeldungen, Teams, Matches oder Zeitpunkte. Eine Kopie mit den alten
 * Fristen wäre am ersten Tag schon abgelaufen.
 */
export function DuplicateButton({
  tournamentId,
  csrfToken,
  vorlage,
}: {
  tournamentId: string;
  csrfToken: string;
  vorlage: string;
}): React.JSX.Element {
  const router = useRouter();
  const [offen, setOffen] = useState(false);
  const [name, setName] = useState(`${vorlage} (Kopie)`);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOffen(true)}>
        <Copy aria-hidden="true" />
        Als Vorlage
      </Button>

      <ConfirmationDialog
        open={offen}
        onOpenChange={setOffen}
        title="Turnier als Vorlage verwenden"
        description="Einstellungen, Regeln, Preise und Zusatzfragen werden übernommen. Anmeldungen, Matches und Zeitpunkte nicht."
        confirmLabel="Kopie anlegen"
        onConfirm={async () => {
          const antwort = await duplicateTournamentAction({
            csrfToken,
            tournamentId,
            name: name.trim(),
          });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            throw new Error(antwort.error.message);
          }
          toast.success('Kopie angelegt.');
          router.push(`/turniere/verwalten/${antwort.data.tournamentId}`);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="kopie-name">Name des neuen Turniers</Label>
          <Input
            id="kopie-name"
            minLength={3}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
      </ConfirmationDialog>
    </>
  );
}
