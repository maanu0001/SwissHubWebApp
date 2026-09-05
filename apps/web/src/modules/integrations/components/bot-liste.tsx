'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { IntegrationHealth } from '@swisshub/secrets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Panel } from '@/components/shared/panel';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { HealthBadge } from './shared';
import {
  checkBotAction,
  createBotAction,
  deleteBotAction,
  rotateBotTokenAction,
} from '@/modules/integrations/actions';

export interface BotAnzeige {
  id: string;
  kind: 'SYSTEM' | 'MUSIC_CONTROLLER' | 'MUSIC_WORKER';
  label: string;
  slug: string;
  clientId: string | null;
  botUsername: string | null;
  status: IntegrationHealth;
  lastError: string | null;
  lastCheckedAt: string | null;
  lastLoginAt: string | null;
  hasToken: boolean;
}

const ART_LABEL: Record<BotAnzeige['kind'], string> = {
  SYSTEM: 'Systembot · zugleich Musik-Controller',
  // Bleibt fuer den Fall, dass eine alte Zeile noch so gekennzeichnet ist.
  MUSIC_CONTROLLER: 'Musik-Controller (abgelöst)',
  MUSIC_WORKER: 'Musik-Worker',
};

/**
 * Die hinterlegten Discord-Bots.
 *
 * Jeder Bot ist eine Zeile mit Name, Anwendungs-ID, Zustand und letztem
 * erfolgreichen Login. Das Token steht in keiner davon - es geht nur in eine
 * Richtung hinein.
 *
 * **Der Systembot ist der Sonderfall.** Er ist die SwissHub-Anwendung selbst
 * und benutzt deren Token aus Integrationen → Discord; er dient zugleich als
 * Musik-Controller. Deshalb bekommt seine Zeile kein Eingabefeld und keinen
 * Löschknopf - ein zweites Token-Feld wäre derselbe Wert an zwei Stellen, und
 * zwei Stellen laufen auseinander. Prüfen lässt er sich trotzdem.
 *
 * «Token ersetzen» prüft zuerst bei Discord und speichert erst danach: ein
 * Tippfehler nimmt den Bot nicht vom Netz, weil der alte Wert bis zum
 * bestandenen Test unangetastet bleibt.
 */
export function BotListe({
  bots,
  csrfToken,
  darfAendern,
}: {
  bots: BotAnzeige[];
  csrfToken: string;
  darfAendern: boolean;
}): React.JSX.Element {
  const [pending, setPending] = useState<string | null>(null);
  const [tokenFeld, setTokenFeld] = useState<Record<string, string>>({});
  const [loeschen, setLoeschen] = useState<BotAnzeige | null>(null);
  const [neu, setNeu] = useState(false);
  const [entwurf, setEntwurf] = useState({ label: '', slug: '', clientId: '' });

  const rotieren = async (bot: BotAnzeige): Promise<void> => {
    const token = tokenFeld[bot.id] ?? '';
    if (token.trim() === '') {
      toast.info('Bitte zuerst ein Token eingeben.');
      return;
    }
    setPending(bot.id);
    try {
      const antwort = await rotateBotTokenAction({ csrfToken, id: bot.id, token });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      const daten = antwort.data as { ok: boolean; fehler?: string; username?: string };
      if (!daten.ok) {
        toast.error(daten.fehler ?? 'Token ungültig - der bisherige bleibt bestehen.');
        return;
      }
      setTokenFeld((bisher) => ({ ...bisher, [bot.id]: '' }));
      toast.success(`Token übernommen${daten.username ? ` (${daten.username})` : ''}.`);
    } finally {
      setPending(null);
    }
  };

  const pruefen = async (bot: BotAnzeige): Promise<void> => {
    setPending(bot.id);
    try {
      const antwort = await checkBotAction({ csrfToken, id: bot.id });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Die Prüfung hat nicht geklappt.');
        return;
      }
      const daten = antwort.data as { ok: boolean; fehler?: string; username?: string };
      toast[daten.ok ? 'success' : 'error'](
        daten.ok ? `Verbunden${daten.username ? ` als ${daten.username}` : ''}.` : (daten.fehler ?? 'Fehler'),
      );
    } finally {
      setPending(null);
    }
  };

  const anlegen = async (): Promise<void> => {
    setPending('neu');
    try {
      const antwort = await createBotAction({
        csrfToken,
        kind: 'MUSIC_WORKER',
        ...entwurf,
        position: 0,
      });
      if (!antwort.ok) {
        toast.error(antwort.error?.message ?? 'Anlegen hat nicht geklappt.');
        return;
      }
      setNeu(false);
      setEntwurf({ label: '', slug: '', clientId: '' });
      toast.success('Bot angelegt. Jetzt noch das Token hinterlegen.');
    } finally {
      setPending(null);
    }
  };

  return (
    <Panel
      title="Discord-Bots"
      description="Der Systembot ist zugleich der Musik-Controller. Jeder Worker braucht eine eigene Discord-Anwendung."
      action={
        darfAendern && !neu ? (
          <Button size="sm" variant="outline" onClick={() => setNeu(true)}>
            <Plus aria-hidden="true" />
            Worker hinzufügen
          </Button>
        ) : undefined
      }
    >
      {neu ? (
        <div className="mb-4 space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bot-label">Anzeigename</Label>
              <Input
                id="bot-label"
                value={entwurf.label}
                placeholder="Music Worker 1"
                onChange={(event) => setEntwurf({ ...entwurf, label: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bot-slug">Kurzname</Label>
              <Input
                id="bot-slug"
                value={entwurf.slug}
                placeholder="WORKER_1"
                className="font-mono"
                onChange={(event) => setEntwurf({ ...entwurf, slug: event.target.value.toUpperCase() })}
              />
              <p className="text-xs text-muted-foreground">
                Stabile Kennung für die Laufzeit. Grossbuchstaben, Ziffern, Unterstriche.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bot-clientid">Client ID (optional)</Label>
              <Input
                id="bot-clientid"
                value={entwurf.clientId}
                className="font-mono"
                onChange={(event) => setEntwurf({ ...entwurf, clientId: event.target.value })}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={pending === 'neu' || entwurf.label === '' || entwurf.slug === ''}
              onClick={() => void anlegen()}
            >
              <Plus aria-hidden="true" />
              Anlegen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNeu(false)}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="space-y-3">
        {bots.map((bot) => (
          <li key={bot.id} className="space-y-3 rounded-lg border border-border/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {bot.label}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{bot.slug}</code>
                </p>
                <p className="text-xs text-muted-foreground">
                  {ART_LABEL[bot.kind]}
                  {bot.botUsername ? ` · ${bot.botUsername}` : ''}
                  {bot.lastLoginAt
                    ? ` · zuletzt verbunden ${new Date(bot.lastLoginAt).toLocaleString('de-CH')}`
                    : ''}
                </p>
                {bot.lastError ? <p className="mt-1 text-xs text-destructive">{bot.lastError}</p> : null}
              </div>
              <HealthBadge status={bot.status} />
            </div>

            {bot.kind === 'SYSTEM' ? (
              <div className="flex flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  Benutzt das Bot-Token der Anwendung aus{' '}
                  <Link href="/system/integrationen/discord" className="text-primary hover:underline">
                    Integrationen → Discord
                  </Link>{' '}
                  und dient zugleich als Musik-Controller. Ein eigenes Token braucht er nicht.
                </p>
                {darfAendern ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending === bot.id || !bot.hasToken}
                    onClick={() => void pruefen(bot)}
                  >
                    <RefreshCw aria-hidden="true" />
                    Prüfen
                  </Button>
                ) : null}
              </div>
            ) : darfAendern ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={bot.hasToken ? 'Neues Token (leer = unverändert)' : 'Token eingeben'}
                  value={tokenFeld[bot.id] ?? ''}
                  onChange={(event) =>
                    setTokenFeld((bisher) => ({ ...bisher, [bot.id]: event.target.value }))
                  }
                  className="min-w-0 flex-1 font-mono"
                  disabled={pending === bot.id}
                  aria-label={`Token für ${bot.label}`}
                />
                <Button
                  size="sm"
                  disabled={pending === bot.id || (tokenFeld[bot.id] ?? '') === ''}
                  onClick={() => void rotieren(bot)}
                >
                  Token ersetzen
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending === bot.id || !bot.hasToken}
                  onClick={() => void pruefen(bot)}
                >
                  <RefreshCw aria-hidden="true" />
                  Prüfen
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending === bot.id}
                  aria-label={`${bot.label} entfernen`}
                  onClick={() => setLoeschen(bot)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <ConfirmationDialog
        open={loeschen !== null}
        onOpenChange={(zustand) => !zustand && setLoeschen(null)}
        title={loeschen ? `${loeschen.label} entfernen?` : ''}
        description="Der Bot und sein Token werden entfernt. Diese Integration funktioniert danach nicht mehr."
        confirmLabel="Entfernen"
        destructive
        onConfirm={async () => {
          if (!loeschen) {
            return;
          }
          const antwort = await deleteBotAction({ csrfToken, id: loeschen.id });
          if (!antwort.ok) {
            toast.error(antwort.error?.message ?? 'Entfernen hat nicht geklappt.');
            return;
          }
          toast.success('Bot entfernt.');
          setLoeschen(null);
        }}
      />
    </Panel>
  );
}
