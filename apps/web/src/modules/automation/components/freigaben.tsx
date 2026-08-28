'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, ShieldQuestion, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/states';
import { entscheideFreigabeAction } from '@/modules/automation/actions';

export interface FreigabeZeile {
  id: string;
  automationName: string;
  title: string;
  summary: string;
  angefragtAm: string;
}

/**
 * Offene Freigaben (§32).
 *
 * Hier steht ein Lauf still und wartet auf einen Menschen. Was er tun würde,
 * steht als Text daneben - dieselbe Beschreibung, die auch der Probelauf
 * zeigt. Wer freigibt, weiss damit, was geschieht, und muss es sich nicht aus
 * einer Konfiguration zusammenreimen.
 */
export function Freigaben({
  csrfToken,
  freigaben,
  darfEntscheiden,
}: {
  csrfToken: string;
  freigaben: FreigabeZeile[];
  darfEntscheiden: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  if (freigaben.length === 0) {
    return (
      <EmptyState
        title="Keine offene Freigabe"
        description="Kein Lauf wartet auf eine Entscheidung."
        className="border-0"
      />
    );
  }

  const entscheiden = async (zeile: FreigabeZeile, genehmigt: boolean): Promise<void> => {
    setPending(zeile.id);
    try {
      const antwort = await entscheideFreigabeAction({
        csrfToken,
        approvalId: zeile.id,
        genehmigt,
      });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      if (!antwort.data.ok) {
        toast.error(antwort.data.grund ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success(genehmigt ? 'Freigegeben - der Lauf macht weiter.' : 'Abgelehnt.');
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  return (
    <ul className="space-y-2">
      {freigaben.map((zeile) => (
        <li key={zeile.id} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="flex flex-wrap items-start gap-2">
            <ShieldQuestion className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{zeile.title}</p>
              <p className="text-xs text-muted-foreground">
                {zeile.automationName} · {zeile.angefragtAm}
              </p>
              <p className="mt-1 text-sm">{zeile.summary}</p>
            </div>
            {darfEntscheiden ? (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  disabled={pending === zeile.id}
                  onClick={() => void entscheiden(zeile, true)}
                >
                  <Check aria-hidden="true" />
                  Freigeben
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending === zeile.id}
                  onClick={() => void entscheiden(zeile, false)}
                >
                  <X aria-hidden="true" />
                  Ablehnen
                </Button>
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
