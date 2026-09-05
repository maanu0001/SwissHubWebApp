import { CheckCircle2, CircleSlash, TriangleAlert, XCircle } from 'lucide-react';
import type { IntegrationHealth } from '@swisshub/secrets';
import { Badge } from '@/components/ui/badge';

/**
 * Gemeinsame Anzeigebausteine der Integrationen.
 *
 * Alles hier ist bewusst «dumm»: es nimmt entgegen, was der Server für die
 * Anzeige freigegeben hat, und zeigt es. Es gibt in dieser Datei keine
 * Stelle, an der ein Geheimnis auftauchen könnte - sie kennt nur Zustände,
 * Masken und Zeitpunkte.
 */

const ZUSTAND: Record<IntegrationHealth, { label: string; klasse: string; symbol: React.JSX.Element }> = {
  CONNECTED: {
    label: 'Verbunden',
    klasse: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
    symbol: <CheckCircle2 className="size-3.5" aria-hidden="true" />,
  },
  DEGRADED: {
    label: 'Eingeschränkt',
    klasse: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
    symbol: <TriangleAlert className="size-3.5" aria-hidden="true" />,
  },
  NOT_CONFIGURED: {
    label: 'Nicht eingerichtet',
    klasse: 'border-border bg-muted/40 text-muted-foreground',
    symbol: <CircleSlash className="size-3.5" aria-hidden="true" />,
  },
  ERROR: {
    label: 'Fehler',
    klasse: 'border-destructive/40 bg-destructive/10 text-destructive',
    symbol: <XCircle className="size-3.5" aria-hidden="true" />,
  },
};

export function HealthBadge({ status }: { status: IntegrationHealth }): React.JSX.Element {
  const eintrag = ZUSTAND[status];
  return (
    <Badge variant="outline" className={`gap-1.5 ${eintrag.klasse}`}>
      {eintrag.symbol}
      {eintrag.label}
    </Badge>
  );
}

export function healthLabel(status: IntegrationHealth): string {
  return ZUSTAND[status].label;
}

/**
 * Die Anzeige eines hinterlegten Werts.
 *
 * Bei einem Geheimnis ist das die Maske, die der Server gebildet hat - dieser
 * Baustein bekommt den Wert gar nicht erst. Steht nichts da, sagt er das
 * ausdrücklich, statt eine leere Zeile zu zeigen.
 */
export function Maske({
  display,
  konfiguriert,
}: {
  display: string | null;
  konfiguriert: boolean;
}): React.JSX.Element {
  if (!konfiguriert || !display) {
    return <span className="text-sm text-muted-foreground">Nicht hinterlegt</span>;
  }
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">{display}</code>;
}

/** Woher ein Wert stammt - Grundlage für den Hinweis zur Bereinigung (§43). */
export function HerkunftBadge({
  origin,
  alsoInEnvironment,
}: {
  origin: 'database' | 'environment' | 'default' | 'missing';
  alsoInEnvironment: boolean;
}): React.JSX.Element | null {
  if (origin === 'environment') {
    return (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-500">
        aus .env
      </Badge>
    );
  }
  if (origin === 'database' && alsoInEnvironment) {
    return (
      <Badge variant="outline" className="border-border text-muted-foreground">
        auch in .env
      </Badge>
    );
  }
  return null;
}
