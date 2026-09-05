'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, Check, Play, Undo2, Zap } from 'lucide-react';
import type { migration } from '@swisshub/modules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import {
  nimmZurueckAction,
  probelaufAction,
  speichereZuordnungAction,
  wendeAnAction,
} from '@/modules/migration/actions';

interface Objekt {
  id: string;
  name: string;
}

interface AssistentProps {
  csrfToken: string;
  runId: string;
  status: string;
  phase: string | null;
  zuordnung: migration.Mappings;
  zielRollen: Objekt[];
  zielKanaele: Objekt[];
  plan: migration.MigrationsPlan | null;
  bericht: migration.AnwendungsErgebnis | null;
  hatSnapshot: boolean;
  darfZuordnen: boolean;
  darfAnwenden: boolean;
  darfZurueck: boolean;
}

/** Ein Wert für «nicht zuordnen» - `SelectItem` verträgt keinen leeren Wert. */
const OHNE = '__ohne__';

/**
 * Der Assistent.
 *
 * Vier Abschnitte in der Reihenfolge, in der sie gebraucht werden: zuordnen,
 * rechnen lassen, ansehen, anwenden. Sie stehen untereinander statt hinter
 * Weiter-Knöpfen, weil man beim Zuordnen zurückblättern will, ohne den
 * Probelauf zu verlieren.
 *
 * Der Zustand liegt im Lauf. Was hier steht, ist eine Ansicht darauf - beim
 * Neuladen ist alles wieder da.
 */
export function MigrationsAssistent(props: AssistentProps): React.JSX.Element {
  const [rollen, setRollen] = useState(props.zuordnung.roles);
  const [kanaele, setKanaele] = useState(props.zuordnung.channels);
  const [pending, setPending] = useState<string | null>(null);
  const [anwenden, setAnwenden] = useState(false);
  const [bestaetigt, setBestaetigt] = useState(false);
  const router = useRouter();

  const abgeschlossen = ['RUNNING', 'PARTIAL', 'COMPLETED', 'FAILED', 'ROLLED_BACK'].includes(props.status);
  const offeneRollen = rollen.filter((eintrag) => eintrag.art !== 'MAP').length;
  const offeneKanaele = kanaele.filter((eintrag) => eintrag.art !== 'MAP').length;

  const speichern = async (): Promise<void> => {
    setPending('map');
    try {
      const antwort = await speichereZuordnungAction({
        csrfToken: props.csrfToken,
        runId: props.runId,
        roles: rollen,
        channels: kanaele,
      });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      toast.success('Zuordnung gespeichert', {
        description: 'Der Probelauf muss danach neu gerechnet werden.',
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  const probelauf = async (): Promise<void> => {
    setPending('dry');
    try {
      const antwort = await probelaufAction({ csrfToken: props.csrfToken, runId: props.runId });
      if (!antwort.ok) {
        toast.error(antwort.error.message);
        return;
      }
      toast.success('Probelauf fertig', { description: 'Es wurde nichts geschrieben.' });
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  const setzeZiel = (
    liste: migration.Zuordnung[],
    setter: (neu: migration.Zuordnung[]) => void,
    quelle: string,
    zielId: string,
    objekte: Objekt[],
  ): void => {
    const ziel = objekte.find((objekt) => objekt.id === zielId) ?? null;
    setter(
      liste.map((eintrag) =>
        eintrag.quelle === quelle
          ? {
              ...eintrag,
              art: ziel ? ('MAP' as const) : ('SKIP' as const),
              ziel: ziel?.id ?? null,
              zielName: ziel?.name ?? null,
              vorschlag: false,
            }
          : eintrag,
      ),
    );
  };

  const tabelle = (
    titel: string,
    beschreibung: string,
    liste: migration.Zuordnung[],
    setter: (neu: migration.Zuordnung[]) => void,
    objekte: Objekt[],
  ): React.JSX.Element => (
    <Card>
      <CardHeader>
        <CardTitle>{titel}</CardTitle>
        <CardDescription>{beschreibung}</CardDescription>
      </CardHeader>
      <CardContent>
        {liste.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nichts zuzuordnen.</p>
        ) : (
          <ul className="space-y-2">
            {liste.map((eintrag) => (
              <li key={eintrag.quelle} className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{eintrag.quellName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{eintrag.quelle}</span>
                </span>
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
                <Select
                  value={eintrag.ziel ?? OHNE}
                  disabled={!props.darfZuordnen || abgeschlossen}
                  onValueChange={(wert) =>
                    setzeZiel(liste, setter, eintrag.quelle, wert === OHNE ? '' : wert, objekte)
                  }
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Nicht zuordnen" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={OHNE}>Nicht zuordnen</SelectItem>
                    {objekte.map((objekt) => (
                      <SelectItem key={objekt.id} value={objekt.id}>
                        {objekt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {eintrag.vorschlag && eintrag.art === 'MAP' ? (
                  <Badge variant="outline">Vorschlag</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      {tabelle(
        'Rollen',
        'Nach Namen vorgeschlagen, exakt und nicht ungefähr. Was nicht eindeutig passt, bleibt offen.',
        rollen,
        setRollen,
        props.zielRollen,
      )}

      {tabelle(
        'Kanäle',
        'Dieselbe Regel. Ein Kanal ohne Zuordnung führt dazu, dass die Einstellung, die auf ihn zeigt, leer bleibt.',
        kanaele,
        setKanaele,
        props.zielKanaele,
      )}

      {!abgeschlossen && props.darfZuordnen ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void speichern()} loading={pending === 'map'}>
            Zuordnung speichern
          </Button>
          <Button onClick={() => void probelauf()} loading={pending === 'dry'}>
            <Play aria-hidden="true" />
            Probelauf
          </Button>
          {offeneRollen + offeneKanaele > 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              {offeneRollen} Rolle(n), {offeneKanaele} Kanal/Kanäle ohne Zuordnung
            </span>
          ) : null}
        </div>
      ) : null}

      {props.plan ? <PlanAnsicht plan={props.plan} /> : null}

      {props.plan && !abgeschlossen && props.darfAnwenden ? (
        <Card>
          <CardHeader>
            <CardTitle>Übertragung durchführen</CardTitle>
            <CardDescription>
              Danach stehen die Berechtigungen und Moduleinstellungen der Ziel-Guild so, wie oben beschrieben.
              Der Zustand davor wird vorher gesichert.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-start gap-2 text-sm">
              <Switch
                checked={bestaetigt}
                onCheckedChange={setBestaetigt}
                aria-label="Übertragung bestätigen"
              />
              <span className="text-muted-foreground">
                Ich bestätige, dass die Konfiguration auf den ausgewählten Zielserver übertragen wird.
              </span>
            </label>
            <Button disabled={!bestaetigt} onClick={() => setAnwenden(true)}>
              <Zap aria-hidden="true" />
              Übertragung durchführen
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {props.bericht ? <BerichtAnsicht bericht={props.bericht} phase={props.phase} /> : null}

      {props.hatSnapshot && props.darfZurueck && abgeschlossen && props.status !== 'ROLLED_BACK' ? (
        <Card>
          <CardHeader>
            <CardTitle>Zurücknehmen</CardTitle>
            <CardDescription>
              Dreht Moduleinstellungen und Berechtigungen auf den gesicherten Stand zurück. Rollen und Kanäle
              auf Discord bleiben, wie sie sind - was dort entstanden ist, könnte inzwischen benutzt werden.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              loading={pending === 'back'}
              onClick={() => {
                setPending('back');
                void nimmZurueckAction({ csrfToken: props.csrfToken, runId: props.runId })
                  .then((antwort) => {
                    if (!antwort.ok) {
                      toast.error(antwort.error.message);
                      return;
                    }
                    toast.success('Zurückgenommen', {
                      description: `${antwort.data.zurueckgedreht} Einträge wiederhergestellt.`,
                    });
                    router.refresh();
                  })
                  .finally(() => setPending(null));
              }}
            >
              <Undo2 aria-hidden="true" />
              Konfiguration zurückdrehen
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <ConfirmationDialog
        open={anwenden}
        onOpenChange={setAnwenden}
        title="Übertragung jetzt durchführen?"
        description="Berechtigungen und Moduleinstellungen der Ziel-Guild werden überschrieben. Automationen kommen ausgeschaltet an. Der Zustand davor wird gesichert und lässt sich zurückdrehen."
        confirmLabel="Übertragen"
        onConfirm={async () => {
          setAnwenden(false);
          setPending('apply');
          try {
            const antwort = await wendeAnAction({
              csrfToken: props.csrfToken,
              runId: props.runId,
              bestaetigt: true,
            });
            if (!antwort.ok) {
              toast.error(antwort.error.message);
              return;
            }
            toast.success(`Übertragung ${antwort.data.status}`);
            router.refresh();
          } finally {
            setPending(null);
          }
        }}
      />
    </div>
  );
}

/** Was der Probelauf ergeben hat. */
function PlanAnsicht({ plan }: { plan: migration.MigrationsPlan }): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Probelauf</CardTitle>
        <CardDescription>Berechnet, nicht angewendet. Es wurde nichts geschrieben.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {plan.warnungen.length > 0 ? (
          <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
            {plan.warnungen.map((warnung) => (
              <li key={warnung}>{warnung}</li>
            ))}
          </ul>
        ) : null}

        <div>
          <Label>Module</Label>
          <ul className="mt-1 space-y-1">
            {plan.module.map((modul) => (
              <li key={modul.moduleId} className="flex flex-wrap items-center gap-2">
                <Badge variant={modul.art === 'NO_CHANGE' ? 'outline' : 'warning'}>{modul.art}</Badge>
                <span className="font-medium">{modul.label}</span>
                {modul.felder.length > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {modul.felder.map((feld) => feld.label).join(', ')}
                  </span>
                ) : null}
                {modul.fehlend.length > 0 ? (
                  <span className="text-xs text-destructive">
                    {modul.fehlend.length} Verweis(e) ohne Zuordnung - bleiben leer
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <Label>Automationen</Label>
          <p className="mb-1 text-xs text-muted-foreground">
            Alle kommen ausgeschaltet an und müssen einzeln eingeschaltet werden.
          </p>
          <ul className="space-y-1">
            {plan.automationen.map((automation) => (
              <li key={automation.name} className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    automation.befund === 'VALID'
                      ? 'success'
                      : automation.befund === 'WARNING'
                        ? 'warning'
                        : 'destructive'
                  }
                >
                  {automation.befund}
                </Badge>
                <span>{automation.name}</span>
                {automation.hinweise.length > 0 ? (
                  <span className="text-xs text-muted-foreground">{automation.hinweise.join(' · ')}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        {plan.integrationen.length > 0 ? (
          <div>
            <Label>Integrationen</Label>
            <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
              {plan.integrationen.map((eintrag) => (
                <li key={eintrag.id}>
                  <span className="font-medium text-foreground">{eintrag.label}</span> - {eintrag.hinweis}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Was tatsächlich geschehen ist, Phase für Phase. */
function BerichtAnsicht({
  bericht,
  phase,
}: {
  bericht: migration.AnwendungsErgebnis;
  phase: string | null;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ergebnis</CardTitle>
        <CardDescription>
          {bericht.status}
          {phase ? ` · zuletzt: ${phase}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2 text-sm">
          {bericht.phasen.map((eintrag) => (
            <li key={eintrag.phase}>
              <span className="flex items-center gap-2">
                {eintrag.ok ? (
                  <Check className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="size-4 text-destructive" aria-hidden="true" />
                )}
                <span className="font-medium">{eintrag.phase}</span>
                <span className="text-muted-foreground">{eintrag.detail}</span>
              </span>
              {eintrag.eintraege.length > 0 ? (
                <ul className="ml-6 mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {eintrag.eintraege.map((zeile) => (
                    <li key={zeile}>{zeile}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
