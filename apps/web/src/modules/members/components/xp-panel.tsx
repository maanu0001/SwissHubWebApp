'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { adjustMemberXpAction } from '@/modules/members/actions';

/**
 * XP von Hand vergeben oder entziehen.
 *
 * Ruft den bestehenden Level-Dienst auf - dieselbe Buchung, dasselbe Journal,
 * dieselben Meilenstein-Rollen wie im Level-Bereich. Eine eigene Rechnung hier
 * waere eine zweite Wahrheit ueber denselben Punktestand.
 */
export function XpPanel({
  discordId,
  csrfToken,
}: {
  discordId: string;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [betrag, setBetrag] = useState('');
  const [grund, setGrund] = useState('');
  const [laeuft, setLaeuft] = useState(false);

  async function buchen(vorzeichen: 1 | -1): Promise<void> {
    const zahl = Number.parseInt(betrag, 10);
    if (!Number.isFinite(zahl) || zahl <= 0) {
      toast.error('Bitte eine Anzahl XP grösser als null angeben.');
      return;
    }
    setLaeuft(true);
    const antwort = await adjustMemberXpAction({
      csrfToken,
      discordId,
      delta: zahl * vorzeichen,
      reason: grund.trim() === '' ? undefined : grund.trim(),
    });
    if (antwort.ok) {
      toast.success(vorzeichen === 1 ? `${zahl} XP vergeben.` : `${zahl} XP entzogen.`);
      setBetrag('');
      setGrund('');
      router.refresh();
    } else {
      toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
    }
    setLaeuft(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <p className="text-sm font-semibold">XP anpassen</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="xp-betrag">Anzahl</Label>
          <Input
            id="xp-betrag"
            value={betrag}
            onChange={(ereignis) => setBetrag(ereignis.target.value)}
            inputMode="numeric"
            placeholder="100"
            className="h-9 w-28"
          />
        </div>
        <div className="min-w-48 flex-1 space-y-1.5">
          <Label htmlFor="xp-grund">Grund (optional)</Label>
          <Input
            id="xp-grund"
            value={grund}
            onChange={(ereignis) => setGrund(ereignis.target.value)}
            maxLength={200}
            placeholder="Event-Teilnahme"
            className="h-9"
          />
        </div>
        <Button type="button" size="sm" disabled={laeuft} onClick={() => void buchen(1)}>
          Vergeben
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={laeuft}
          onClick={() => void buchen(-1)}
        >
          Entziehen
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Die Buchung steht im XP-Journal und im Audit Log.
      </p>
    </div>
  );
}
