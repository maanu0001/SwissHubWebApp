'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, Send, TriangleAlert, XCircle } from 'lucide-react';
import type { DiscordLogHealth } from '@swisshub/database';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ChannelSelect } from '@/modules/configuration/components/channel-select';
import type { ChannelOption } from '@/modules/configuration/components/discord-option-types';
import { setzeAlleLogKanaeleAction, setzeLogKanalAction, sendeLogTestAction } from '../actions';

/**
 * Die Einrichtung der Discord-Log-Kanäle.
 *
 * Eine Zeile je Kategorie, und jede zeigt drei Dinge: wohin sie geht, ob das
 * Ziel funktioniert, und ob man es gerade ausprobieren kann. Kategorien ohne
 * Kanal stehen ausdrücklich mit «Nicht eingerichtet» da - eine Liste, die nur
 * das Eingerichtete zeigt, verschweigt genau die Lücke, die man sucht.
 */

export interface LogZielAnsicht {
  category: string;
  label: string;
  beschreibung: string;
  beispiel: string;
  channelId: string | null;
  channelName: string | null;
  enabled: boolean;
  health: DiscordLogHealth;
  healthNote: string | null;
  lastErrorCode: string | null;
}

const ZUSTAND: Record<
  DiscordLogHealth,
  { label: string; klasse: string; symbol: React.ReactNode }
> = {
  HEALTHY: {
    label: 'Aktiv',
    klasse: 'text-success',
    symbol: <CheckCircle2 className="size-4" aria-hidden="true" />,
  },
  DEGRADED: {
    label: 'Zuletzt gescheitert',
    klasse: 'text-warning',
    symbol: <TriangleAlert className="size-4" aria-hidden="true" />,
  },
  INVALID: {
    label: 'Nicht nutzbar',
    klasse: 'text-destructive',
    symbol: <XCircle className="size-4" aria-hidden="true" />,
  },
  DISABLED: {
    label: 'Nicht eingerichtet',
    klasse: 'text-muted-foreground',
    symbol: null,
  },
};

export function LogKanalVerwaltung({
  ziele,
  channels,
  darfVerwalten,
  darfTesten,
}: {
  ziele: LogZielAnsicht[];
  channels: ChannelOption[];
  darfVerwalten: boolean;
  darfTesten: boolean;
}): React.JSX.Element {
  const [meldung, setMeldung] = useState<{ art: 'ok' | 'fehler'; text: string } | null>(null);
  const [laeuft, starte] = useTransition();
  const [sammelKanal, setSammelKanal] = useState<string | undefined>(undefined);

  function speichere(category: string, channelId: string | undefined): void {
    starte(async () => {
      const ergebnis = await setzeLogKanalAction({ category, channelId: channelId ?? null });
      setMeldung(
        ergebnis.ok
          ? { art: 'ok', text: 'Gespeichert.' }
          : { art: 'fehler', text: ergebnis.error.message },
      );
    });
  }

  function alleSetzen(): void {
    if (!sammelKanal) {
      return;
    }
    starte(async () => {
      const ergebnis = await setzeAlleLogKanaeleAction({ channelId: sammelKanal });
      setMeldung(
        ergebnis.ok
          ? { art: 'ok', text: 'Alle Kategorien wurden diesem Kanal zugewiesen.' }
          : { art: 'fehler', text: ergebnis.error.message },
      );
    });
  }

  function teste(category: string): void {
    starte(async () => {
      const ergebnis = await sendeLogTestAction({ category });
      setMeldung(
        ergebnis.ok
          ? { art: 'ok', text: 'Testnachricht gesendet.' }
          : { art: 'fehler', text: ergebnis.error.message },
      );
    });
  }

  return (
    <div className="space-y-4">
      {meldung ? (
        <p
          role="status"
          className={`rounded-md border px-3 py-2 text-sm ${
            meldung.art === 'ok'
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          }`}
        >
          {meldung.text}
        </p>
      ) : null}

      {darfVerwalten ? (
        <Card>
          <CardHeader>
            <CardTitle>Schnelle Einrichtung</CardTitle>
            <CardDescription>
              Weist allen Kategorien denselben Kanal zu. Das setzt lediglich die einzelnen
              Zuweisungen - danach lässt sich jede Kategorie wieder einzeln umhängen.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1 space-y-1.5">
              <Label htmlFor="sammel-kanal">Kanal</Label>
              <ChannelSelect
                id="sammel-kanal"
                value={sammelKanal}
                channels={channels}
                onChange={setSammelKanal}
                disabled={laeuft}
              />
            </div>
            <Button type="button" variant="outline" onClick={alleSetzen} disabled={laeuft || !sammelKanal}>
              Alle Kategorien zuweisen
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <ul className="space-y-3">
        {ziele.map((ziel) => {
          const zustand = ZUSTAND[ziel.health];
          return (
            <li key={ziel.category} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{ziel.label}</p>
                  <p className="text-sm text-muted-foreground">{ziel.beschreibung}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{ziel.beispiel}</p>
                </div>
                <span className={`flex items-center gap-1.5 text-sm ${zustand.klasse}`}>
                  {zustand.symbol}
                  {zustand.label}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1 space-y-1.5">
                  <Label htmlFor={`kanal-${ziel.category}`}>Kanal</Label>
                  <ChannelSelect
                    id={`kanal-${ziel.category}`}
                    value={ziel.channelId ?? undefined}
                    channels={channels}
                    onChange={(wert) => speichere(ziel.category, wert)}
                    disabled={!darfVerwalten || laeuft}
                    placeholder="Keine Discord-Ausgabe"
                  />
                </div>
                {darfTesten && ziel.channelId && ziel.enabled ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => teste(ziel.category)}
                    disabled={laeuft}
                  >
                    <Send aria-hidden="true" />
                    Testnachricht senden
                  </Button>
                ) : null}
              </div>

              {/* Warum ein Ziel nicht funktioniert, gehört an das Ziel - nicht
                  in eine Sammelmeldung am Seitenkopf. */}
              {ziel.healthNote ? (
                <p className="mt-2 text-sm text-destructive">{ziel.healthNote}</p>
              ) : null}
              {!ziel.healthNote && ziel.health === 'DEGRADED' && ziel.lastErrorCode ? (
                <p className="mt-2 text-sm text-warning">
                  Die letzte Zustellung ist gescheitert ({ziel.lastErrorCode}). SwissHub versucht es
                  erneut.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
