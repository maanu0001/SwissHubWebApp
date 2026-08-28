'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  GitBranch,
  Info,
  Play,
  Timer,
  Trash2,
  Zap,
} from 'lucide-react';
import type { ConditionNode, StepNode, ValidationIssue } from '@swisshub/automation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Panel } from '@/components/shared/panel';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AutomationBausteine } from '@/server/automation';
import type { ChannelOption, RoleOption } from '@/modules/configuration/components/discord-option-types';
import {
  aendereAutomationAction,
  erstelleAutomationAction,
  pruefeAutomationAction,
} from '@/modules/automation/actions';
import { BedingungsBaum } from './bedingungs-baum';
import { FeldZeile } from './feld-zeile';

/**
 * Der Builder.
 *
 * Er kennt kein einziges Modul. Was er anbietet, kommt aus den Registries:
 * Trigger, Bedingungen und Aktionen erscheinen hier, sobald ein Modul sie
 * anmeldet - ohne Änderung an dieser Datei (§49).
 *
 * Drei Dinge, die er bewusst **nicht** tut:
 *
 * 1. **Er entscheidet nichts.** Ob eine Automation eingeschaltet werden darf,
 *    beantwortet der Server (§22); der Builder zeigt die Antwort.
 * 2. **Er versteckt nichts als Sicherheitsmassnahme.** Eine Aktion, für die
 *    die Berechtigung fehlt, wird gekennzeichnet - abgewiesen wird sie
 *    serverseitig (§21).
 * 3. **Er speichert nicht eingeschaltet.** Ein neuer Entwurf ist aus. Das
 *    Einschalten ist ein eigener Schritt mit eigener Berechtigung.
 */

export interface AutomationEntwurf {
  id?: string;
  name: string;
  description: string;
  triggerType: string;
  triggerConfig: Record<string, unknown>;
  conditions: ConditionNode | null;
  steps: StepNode[];
  concurrency: 'ALLOW' | 'SKIP_IF_RUNNING' | 'QUEUE';
  concurrencyKey: string;
  maxRunsPerMinute: number;
}

export const LEERER_ENTWURF: AutomationEntwurf = {
  name: '',
  description: '',
  triggerType: 'event',
  triggerConfig: {},
  conditions: null,
  steps: [],
  concurrency: 'ALLOW',
  concurrencyKey: '',
  maxRunsPerMinute: 60,
};

export function Builder({
  csrfToken,
  bausteine,
  roles,
  channels,
  entwurf: start,
  eigeneRechte,
  darfSpeichern,
}: {
  csrfToken: string;
  bausteine: AutomationBausteine;
  roles: RoleOption[];
  channels: ChannelOption[];
  entwurf: AutomationEntwurf;
  /** Berechtigungen des Anwenders - für den Hinweis an gesperrten Aktionen. */
  eigeneRechte: string[];
  darfSpeichern: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [entwurf, setEntwurf] = useState<AutomationEntwurf>(start);
  const [pending, setPending] = useState(false);
  const [probleme, setProbleme] = useState<ValidationIssue[] | null>(null);

  const trigger = bausteine.trigger.find((eintrag) => eintrag.id === entwurf.triggerType);

  /**
   * Die Variablen, die in Platzhaltern zur Verfügung stehen.
   *
   * Sie hängen am gewählten Ereignis: eine Automation auf «Mitglied
   * beigetreten» kennt keinen Ticketstand. Eine feste Liste anzuzeigen wäre
   * die freundlichere Lüge.
   */
  const variablen = useMemo(() => {
    if (entwurf.triggerType !== 'event') {
      return [];
    }
    const typ = entwurf.triggerConfig.eventType;
    const ereignis = bausteine.ereignisse.find((eintrag) => eintrag.type === typ);
    return ereignis?.variablen ?? [];
  }, [bausteine.ereignisse, entwurf.triggerConfig, entwurf.triggerType]);

  const setzeTriggerFeld = (key: string, wert: unknown): void => {
    setEntwurf((aktuell) => ({
      ...aktuell,
      triggerConfig: { ...aktuell.triggerConfig, [key]: wert },
    }));
  };

  const setzeSchritt = (index: number, naechster: StepNode): void => {
    setEntwurf((aktuell) => ({
      ...aktuell,
      steps: aktuell.steps.map((schritt, i) => (i === index ? naechster : schritt)),
    }));
  };

  const verschiebe = (index: number, richtung: -1 | 1): void => {
    setEntwurf((aktuell) => {
      const ziel = index + richtung;
      if (ziel < 0 || ziel >= aktuell.steps.length) {
        return aktuell;
      }
      const kopie = [...aktuell.steps];
      const [heraus] = kopie.splice(index, 1);
      kopie.splice(ziel, 0, heraus!);
      return { ...aktuell, steps: kopie };
    });
  };

  const entferne = (index: number): void => {
    setEntwurf((aktuell) => ({
      ...aktuell,
      steps: aktuell.steps.filter((_, i) => i !== index),
    }));
  };

  const fuegeAktionHinzu = (typ: string): void => {
    const definition = bausteine.aktionen.find((eintrag) => eintrag.id === typ);
    if (!definition) {
      return;
    }
    setEntwurf((aktuell) => ({
      ...aktuell,
      steps: [
        ...aktuell.steps,
        {
          art: 'aktion',
          typ,
          config: vorgaben(definition.fields),
          beiFehler: 'ABBRECHEN',
          retry: { versuche: 1, basisSekunden: 30 },
        },
      ],
    }));
  };

  const nutzlast = (): Parameters<typeof erstelleAutomationAction>[0] => ({
    csrfToken,
    name: entwurf.name,
    description: entwurf.description || undefined,
    triggerType: entwurf.triggerType,
    triggerConfig: entwurf.triggerConfig,
    conditions: entwurf.conditions,
    steps: entwurf.steps,
    concurrency: entwurf.concurrency,
    concurrencyKey: entwurf.concurrencyKey || null,
    maxRunsPerMinute: entwurf.maxRunsPerMinute,
  });

  const pruefen = async (): Promise<void> => {
    setPending(true);
    try {
      const antwort = await pruefeAutomationAction({
        csrfToken,
        triggerType: entwurf.triggerType,
        triggerConfig: entwurf.triggerConfig,
        conditions: entwurf.conditions,
        steps: entwurf.steps,
      });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      setProbleme(antwort.data.probleme);
      toast[antwort.data.einschaltbar ? 'success' : 'error'](
        antwort.data.einschaltbar
          ? 'Diese Automation lässt sich einschalten.'
          : 'So lässt sie sich nicht einschalten - siehe Liste.',
      );
    } finally {
      setPending(false);
    }
  };

  const speichern = async (): Promise<void> => {
    if (entwurf.name.trim().length < 2) {
      toast.error('Die Automation braucht einen Namen.');
      return;
    }
    if (entwurf.steps.length === 0) {
      toast.error('Ohne Schritt tut die Automation nichts.');
      return;
    }

    setPending(true);
    try {
      const antwort = entwurf.id
        ? await aendereAutomationAction({ ...nutzlast(), id: entwurf.id })
        : await erstelleAutomationAction(nutzlast());

      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      toast.success(entwurf.id ? 'Gespeichert.' : 'Angelegt - noch ausgeschaltet.');
      router.push(`/automationen/${antwort.data.id}`);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Name" description="Wofür ist diese Automation da?">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="automation-name">Name *</Label>
            <Input
              id="automation-name"
              value={entwurf.name}
              placeholder="Willkommensnachricht"
              onChange={(event) => setEntwurf((a) => ({ ...a, name: event.target.value }))}
              disabled={!darfSpeichern}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="automation-beschreibung">Beschreibung</Label>
            <Input
              id="automation-beschreibung"
              value={entwurf.description}
              placeholder="Begrüsst neue Mitglieder im Willkommenskanal"
              onChange={(event) => setEntwurf((a) => ({ ...a, description: event.target.value }))}
              disabled={!darfSpeichern}
            />
          </div>
        </div>
      </Panel>

      <Panel
        title="Wann"
        description="Was diese Automation auslöst."
        icon={<Zap className="size-4" aria-hidden="true" />}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="automation-trigger">Auslöser *</Label>
            <Select
              value={entwurf.triggerType}
              onValueChange={(naechster) =>
                setEntwurf((a) => ({ ...a, triggerType: naechster, triggerConfig: {} }))
              }
              disabled={!darfSpeichern}
            >
              <SelectTrigger id="automation-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {bausteine.trigger.map((eintrag) => (
                  <SelectItem key={eintrag.id} value={eintrag.id}>
                    {eintrag.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {trigger ? (
              <p className="text-xs text-muted-foreground">{trigger.description}</p>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {(trigger?.fields ?? []).map((feld) => (
              <FeldZeile
                key={feld.key}
                feld={feld}
                wert={entwurf.triggerConfig[feld.key]}
                onChange={(naechster) => setzeTriggerFeld(feld.key, naechster)}
                roles={roles}
                channels={channels}
                disabled={!darfSpeichern}
              />
            ))}
          </div>

          {variablen.length > 0 ? (
            <div className="rounded-md border border-border/60 bg-muted/30 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                <Info className="size-3.5" aria-hidden="true" />
                Verfügbare Platzhalter
              </p>
              <div className="flex flex-wrap gap-1.5">
                {variablen.map((variable) => (
                  <code
                    key={variable.path}
                    title={variable.label}
                    className="rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground"
                  >
                    {`{{${variable.path}}}`}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="Nur wenn"
        description="Bedingungen. Ohne Bedingung läuft die Automation bei jedem Auslöser."
      >
        <BedingungsBaum
          knoten={entwurf.conditions}
          bedingungen={bausteine.bedingungen}
          roles={roles}
          channels={channels}
          disabled={!darfSpeichern}
          onChange={(naechster) => setEntwurf((a) => ({ ...a, conditions: naechster }))}
        />
      </Panel>

      <Panel title="Dann" description="Was geschieht - der Reihe nach.">
        <div className="space-y-3">
          {entwurf.steps.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              Noch kein Schritt. Wähle unten eine Aktion.
            </p>
          ) : null}

          {entwurf.steps.map((schritt, index) => (
            <SchrittKarte
              key={index}
              index={index}
              schritt={schritt}
              bausteine={bausteine}
              roles={roles}
              channels={channels}
              eigeneRechte={eigeneRechte}
              disabled={!darfSpeichern}
              istErster={index === 0}
              istLetzter={index === entwurf.steps.length - 1}
              onChange={(naechster) => setzeSchritt(index, naechster)}
              onHoch={() => verschiebe(index, -1)}
              onRunter={() => verschiebe(index, 1)}
              onEntfernen={() => entferne(index)}
            />
          ))}

          {darfSpeichern ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Select value="" onValueChange={fuegeAktionHinzu}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Aktion hinzufügen …" />
                </SelectTrigger>
                <SelectContent>
                  {bausteine.aktionen.map((aktion) => (
                    <SelectItem key={aktion.id} value={aktion.id}>
                      {aktion.group} · {aktion.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setEntwurf((a) => ({
                    ...a,
                    steps: [...a.steps, { art: 'warten', sekunden: 3600 }],
                  }))
                }
              >
                <Timer aria-hidden="true" />
                Warten
              </Button>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel
        title="Grenzen"
        description="Was geschieht, wenn dieselbe Automation mehrfach gleichzeitig ausgelöst wird."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="automation-concurrency">Gleichzeitigkeit</Label>
            <Select
              value={entwurf.concurrency}
              onValueChange={(naechster) =>
                setEntwurf((a) => ({ ...a, concurrency: naechster as AutomationEntwurf['concurrency'] }))
              }
              disabled={!darfSpeichern}
            >
              <SelectTrigger id="automation-concurrency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALLOW">Immer starten</SelectItem>
                <SelectItem value="SKIP_IF_RUNNING">Überspringen, wenn schon einer läuft</SelectItem>
                <SelectItem value="QUEUE">Einreihen und später nachholen</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="automation-key">Getrennt zählen nach</Label>
            <Input
              id="automation-key"
              value={entwurf.concurrencyKey}
              placeholder="{{event.subjectId}}"
              onChange={(event) => setEntwurf((a) => ({ ...a, concurrencyKey: event.target.value }))}
              disabled={!darfSpeichern || entwurf.concurrency === 'ALLOW'}
            />
            <p className="text-xs text-muted-foreground">
              Leer = für die ganze Automation. Mit Platzhalter = je Mitglied.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="automation-rate">Höchstens Läufe je Minute</Label>
            <Input
              id="automation-rate"
              type="number"
              min={0}
              max={600}
              value={entwurf.maxRunsPerMinute}
              onChange={(event) =>
                setEntwurf((a) => ({ ...a, maxRunsPerMinute: Number(event.target.value) }))
              }
              disabled={!darfSpeichern}
            />
            <p className="text-xs text-muted-foreground">0 = keine Grenze.</p>
          </div>
        </div>
      </Panel>

      {probleme ? (
        <Panel title="Prüfergebnis">
          {probleme.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-500">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              Alles in Ordnung.
            </p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {probleme.map((problem, index) => (
                <li key={index} className="flex items-start gap-2">
                  <AlertTriangle
                    className={`mt-0.5 size-4 shrink-0 ${
                      problem.severity === 'error' ? 'text-destructive' : 'text-amber-500'
                    }`}
                    aria-hidden="true"
                  />
                  <span>
                    {problem.message}
                    {problem.path ? (
                      <span className="ml-1 text-xs text-muted-foreground">({problem.path})</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void speichern()} loading={pending} disabled={!darfSpeichern}>
          {entwurf.id ? 'Speichern' : 'Anlegen'}
        </Button>
        <Button variant="outline" onClick={() => void pruefen()} disabled={pending}>
          <Play aria-hidden="true" />
          Prüfen
        </Button>
        {!darfSpeichern ? (
          <span className="text-xs text-muted-foreground">
            Zum Ändern fehlt dir die nötige Berechtigung.
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Vorgabewerte einer Feldliste - damit ein neuer Schritt nicht leer beginnt. */
function vorgaben(felder: AutomationBausteine['aktionen'][number]['fields']): Record<string, unknown> {
  const werte: Record<string, unknown> = {};
  for (const feld of felder) {
    if (feld.default !== undefined) {
      werte[feld.key] = feld.default;
    }
  }
  return werte;
}

function SchrittKarte({
  index,
  schritt,
  bausteine,
  roles,
  channels,
  eigeneRechte,
  disabled,
  istErster,
  istLetzter,
  onChange,
  onHoch,
  onRunter,
  onEntfernen,
}: {
  index: number;
  schritt: StepNode;
  bausteine: AutomationBausteine;
  roles: RoleOption[];
  channels: ChannelOption[];
  eigeneRechte: string[];
  disabled?: boolean;
  istErster: boolean;
  istLetzter: boolean;
  onChange: (naechster: StepNode) => void;
  onHoch: () => void;
  onRunter: () => void;
  onEntfernen: () => void;
}): React.JSX.Element {
  const definition =
    schritt.art === 'aktion'
      ? bausteine.aktionen.find((eintrag) => eintrag.id === schritt.typ)
      : undefined;

  const rechtFehlt =
    definition?.requiredPermission !== undefined &&
    !eigeneRechte.includes('admin.full') &&
    !eigeneRechte.includes(definition.requiredPermission);

  const titel =
    schritt.art === 'warten'
      ? 'Warten'
      : schritt.art === 'wenn'
        ? 'Verzweigung'
        : (definition?.label ?? schritt.typ);

  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs tabular-nums">
          {index + 1}
        </span>
        {schritt.art === 'warten' ? <Timer className="size-4" aria-hidden="true" /> : null}
        {schritt.art === 'wenn' ? <GitBranch className="size-4" aria-hidden="true" /> : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{titel}</span>

        {definition?.requiresApproval ? (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-500">
            Braucht eine Freigabe
          </span>
        ) : null}
        {rechtFehlt ? (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
            Berechtigung fehlt
          </span>
        ) : null}

        {disabled ? null : (
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" disabled={istErster} onClick={onHoch}>
              <ArrowUp aria-hidden="true" />
              <span className="sr-only">Nach oben</span>
            </Button>
            <Button type="button" variant="ghost" size="icon" disabled={istLetzter} onClick={onRunter}>
              <ArrowDown aria-hidden="true" />
              <span className="sr-only">Nach unten</span>
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onEntfernen}>
              <Trash2 aria-hidden="true" />
              <span className="sr-only">Entfernen</span>
            </Button>
          </div>
        )}
      </div>

      {schritt.art === 'warten' ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`warten-${index}`}>Wartezeit in Sekunden</Label>
            <Input
              id={`warten-${index}`}
              type="number"
              min={1}
              value={schritt.sekunden}
              onChange={(event) =>
                onChange({ ...schritt, sekunden: Math.max(1, Number(event.target.value)) })
              }
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">
              Die Wartezeit steht in der Datenbank - sie übersteht einen Neustart.
            </p>
          </div>
        </div>
      ) : null}

      {schritt.art === 'aktion' && definition ? (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{definition.description}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            {definition.fields.map((feld) => (
              <FeldZeile
                key={feld.key}
                feld={feld}
                wert={schritt.config[feld.key]}
                onChange={(naechster: unknown) =>
                  onChange({ ...schritt, config: { ...schritt.config, [feld.key]: naechster } })
                }
                roles={roles}
                channels={channels}
                disabled={disabled}
              />
            ))}
          </div>

          <div className="grid gap-4 border-t border-border/60 pt-3 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`fehler-${index}`}>Bei einem Fehler</Label>
              <Select
                value={schritt.beiFehler ?? 'ABBRECHEN'}
                onValueChange={(naechster) =>
                  onChange({ ...schritt, beiFehler: naechster as 'ABBRECHEN' | 'WEITER' })
                }
                disabled={disabled}
              >
                <SelectTrigger id={`fehler-${index}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ABBRECHEN">Lauf abbrechen</SelectItem>
                  <SelectItem value="WEITER">Weitermachen</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`versuche-${index}`}>Versuche</Label>
              <Input
                id={`versuche-${index}`}
                type="number"
                min={1}
                max={5}
                value={schritt.retry?.versuche ?? 1}
                onChange={(event) =>
                  onChange({
                    ...schritt,
                    retry: {
                      versuche: Math.min(5, Math.max(1, Number(event.target.value))),
                      basisSekunden: schritt.retry?.basisSekunden ?? 30,
                    },
                  })
                }
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      ) : null}

      {schritt.art === 'aktion' && !definition ? (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          Die Aktion «{schritt.typ}» gibt es nicht mehr. Entferne den Schritt oder schalte das
          zugehörige Modul wieder ein.
        </p>
      ) : null}
    </div>
  );
}
