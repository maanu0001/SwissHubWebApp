'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { VorlageAnsicht } from '@/server/automation';
import { uebernimmVorlageAction } from '@/modules/automation/actions';

/**
 * Vorlagen (§11).
 *
 * Eine übernommene Vorlage ist ein gewöhnlicher Entwurf - ausgeschaltet, mit
 * denselben Prüfungen wie jede andere Automation. Was noch fehlt, steht
 * daneben: eine Vorlage kann keine Kanal-ID mitbringen, die kennt nur der
 * Server.
 */
export function Vorlagen({
  csrfToken,
  vorlagen,
  darfUebernehmen,
}: {
  csrfToken: string;
  vorlagen: VorlageAnsicht[];
  darfUebernehmen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  const uebernehmen = async (vorlage: VorlageAnsicht): Promise<void> => {
    setPending(vorlage.id);
    try {
      const antwort = await uebernimmVorlageAction({ csrfToken, vorlageId: vorlage.id });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      const offen = antwort.data.auszufuellen;
      toast.success('Vorlage übernommen - noch ausgeschaltet.', {
        description:
          offen.length > 0
            ? `Bitte noch ausfüllen: ${offen.map((eintrag) => eintrag.label).join(', ')}`
            : undefined,
      });
      router.push(`/automationen/${antwort.data.id}`);
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {vorlagen.map((vorlage) => (
        <div key={vorlage.id} className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-medium">{vorlage.name}</p>
              <p className="text-xs text-muted-foreground">{vorlage.gruppe}</p>
            </div>
          </div>
          <p className="flex-1 text-xs text-muted-foreground">{vorlage.description}</p>
          {vorlage.auszufuellen.length > 0 ? (
            <p className="text-xs text-amber-500">
              Noch auszufüllen: {vorlage.auszufuellen.map((eintrag) => eintrag.label).join(', ')}
            </p>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={!darfUebernehmen || pending === vorlage.id}
            onClick={() => void uebernehmen(vorlage)}
          >
            Übernehmen
          </Button>
        </div>
      ))}
    </div>
  );
}
