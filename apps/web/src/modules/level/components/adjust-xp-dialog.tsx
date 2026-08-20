'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { adjustXpAction } from '@/modules/level/actions';

/**
 * XP von Hand vergeben oder entziehen.
 *
 * Ruft dieselbe Aktion auf wie `/give_xp` und `/rem_xp` - es gibt keinen
 * zweiten Weg, XP zu ändern.
 */
export function AdjustXpDialog({
  csrfToken,
  discordId,
  name,
  currentXp,
}: {
  csrfToken: string;
  discordId: string;
  name: string;
  currentXp: number;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('100');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  const submit = async (sign: 1 | -1): Promise<void> => {
    const parsed = Number.parseInt(amount, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      toast.error('Bitte eine positive ganze Zahl angeben.');
      return;
    }

    setPending(true);
    const response = await adjustXpAction({
      csrfToken,
      discordId,
      amount: sign * parsed,
      reason: reason.trim() === '' ? undefined : reason.trim(),
    });
    setPending(false);

    if (!response.ok) {
      toast.error(response.error.message);
      return;
    }

    const { xpAfter, levelAfter, applied, decayed, rolesAdded, rolesRemoved } = response.data;
    const parts = [`${name} hat jetzt ${xpAfter} XP (Level ${levelAfter}).`];
    if (Math.abs(applied) !== parsed) {
      parts.push(`Verbucht wurden ${Math.abs(applied)} XP - mehr war nicht vorhanden.`);
    }
    if (decayed > 0) {
      parts.push(`Vorher wurden ${decayed} XP Inaktivitäts-Abzug verrechnet.`);
    }
    if (rolesAdded.length > 0) {
      parts.push(`${rolesAdded.length} Rolle(n) vergeben.`);
    }
    if (rolesRemoved.length > 0) {
      parts.push(`${rolesRemoved.length} Rolle(n) entzogen.`);
    }

    toast.success(parts.join(' '));
    setOpen(false);
    setReason('');
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          XP ändern
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>XP von {name} ändern</DialogTitle>
          <DialogDescription>
            Aktueller Stand: {currentXp} XP. Jede Änderung landet im Journal und im Audit-Log.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="level-amount">Anzahl XP</Label>
            <Input
              id="level-amount"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="level-reason">Grund (optional)</Label>
            <Input
              id="level-reason"
              value={reason}
              maxLength={200}
              placeholder="z.B. Gewinn beim Community-Event"
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => void submit(-1)}>
            <Minus aria-hidden="true" />
            Entziehen
          </Button>
          <Button disabled={pending} onClick={() => void submit(1)}>
            <Plus aria-hidden="true" />
            Vergeben
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
