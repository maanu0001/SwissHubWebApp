'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Lock, Pencil, Play, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/shared/states';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  loescheAutomationAction,
  schalteAutomationAction,
  starteAutomationAction,
} from '@/modules/automation/actions';

export interface AutomationZeile {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  istSystem: boolean;
  triggerLabel: string;
  lastStatus: string | null;
  lastRunAt: string | null;
  laeufe24h: number;
  fehler24h: number;
}

/**
 * Die Übersicht.
 *
 * Der Schalter ist die wichtigste Stelle der ganzen Oberfläche: er macht aus
 * einem Entwurf etwas, das von selbst handelt. Deshalb prüft der Server vor
 * dem Einschalten (§22) - und wenn etwas fehlt, erscheint hier nicht «hat
 * nicht geklappt», sondern *was* fehlt.
 */
export function AutomationListe({
  csrfToken,
  automationen,
  darfSchalten,
  darfLoeschen,
  darfStarten,
  darfBearbeiten,
}: {
  csrfToken: string;
  automationen: AutomationZeile[];
  darfSchalten: boolean;
  darfLoeschen: boolean;
  darfStarten: boolean;
  darfBearbeiten: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [loeschen, setLoeschen] = useState<AutomationZeile | null>(null);

  if (automationen.length === 0) {
    return (
      <EmptyState
        title="Noch keine Automation"
        description="Beginne mit einer Vorlage - sie lässt sich anschliessend frei anpassen."
        className="border-0"
      />
    );
  }

  const schalten = async (zeile: AutomationZeile, an: boolean): Promise<void> => {
    setPending(zeile.id);
    try {
      const antwort = await schalteAutomationAction({ csrfToken, id: zeile.id, enabled: an });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      if (an && !antwort.data.eingeschaltet) {
        const fehler = antwort.data.probleme.filter((problem) => problem.severity === 'error');
        toast.error(fehler[0]?.message ?? 'So lässt sie sich nicht einschalten.', {
          description: fehler.length > 1 ? `und ${fehler.length - 1} weitere` : undefined,
        });
        return;
      }
      toast.success(an ? 'Eingeschaltet.' : 'Ausgeschaltet.');
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  const probelauf = async (zeile: AutomationZeile): Promise<void> => {
    setPending(zeile.id);
    try {
      const antwort = await starteAutomationAction({ csrfToken, id: zeile.id, dryRun: true });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      const schritte = antwort.data.schritte ?? [];
      toast.success('Probelauf fertig', {
        description:
          schritte.length === 0
            ? 'Die Bedingungen trafen nicht zu - es wäre nichts geschehen.'
            : schritte.map((schritt) => schritt.detail ?? schritt.label).join(' · '),
      });
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <ul className="space-y-2">
        {automationen.map((zeile) => (
          <li
            key={zeile.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5"
          >
            <Switch
              checked={zeile.enabled}
              disabled={!darfSchalten || pending === zeile.id}
              onCheckedChange={(an) => void schalten(zeile, an)}
              aria-label={`${zeile.name} ${zeile.enabled ? 'ausschalten' : 'einschalten'}`}
            />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{zeile.name}</span>
                {zeile.istSystem ? (
                  <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Systemautomation" />
                ) : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {zeile.triggerLabel}
                {zeile.description ? ` · ${zeile.description}` : ''}
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="tabular-nums" title="Läufe in 24 Stunden">
                {zeile.laeufe24h} Läufe
              </span>
              {zeile.fehler24h > 0 ? (
                <span className="flex items-center gap-1 text-destructive">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  {zeile.fehler24h}
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-1">
              {darfStarten ? (
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={pending === zeile.id}
                  onClick={() => void probelauf(zeile)}
                  title="Probelauf - prüft Bedingungen, führt nichts aus"
                >
                  <Play aria-hidden="true" />
                  <span className="sr-only">Probelauf</span>
                </Button>
              ) : null}
              {darfBearbeiten && !zeile.istSystem ? (
                <Button variant="ghost" size="icon" asChild>
                  <Link href={`/automationen/${zeile.id}`}>
                    <Pencil aria-hidden="true" />
                    <span className="sr-only">Bearbeiten</span>
                  </Link>
                </Button>
              ) : null}
              {darfLoeschen && !zeile.istSystem ? (
                <Button variant="ghost" size="icon" onClick={() => setLoeschen(zeile)}>
                  <Trash2 aria-hidden="true" />
                  <span className="sr-only">Löschen</span>
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <ConfirmationDialog
        open={loeschen !== null}
        onOpenChange={(offen) => {
          if (!offen) {
            setLoeschen(null);
          }
        }}
        title={`«${loeschen?.name ?? ''}» löschen?`}
        description="Die Automation wird ausgeschaltet und verschwindet aus allen Listen. Der Verlauf bleibt lesbar."
        confirmLabel="Löschen"
        destructive
        onConfirm={async () => {
          if (!loeschen) {
            return;
          }
          const antwort = await loescheAutomationAction({ csrfToken, id: loeschen.id });
          if (!antwort.ok) {
            toast.error(antwort.error.message);
            return;
          }
          toast.success('Gelöscht.');
          setLoeschen(null);
          router.refresh();
        }}
      />
    </>
  );
}
