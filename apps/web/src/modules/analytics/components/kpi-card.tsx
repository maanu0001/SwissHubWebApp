import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface KpiVeraenderung {
  vorher: number | null;
  prozent: number | null;
  richtung: 'auf' | 'ab' | 'gleich' | 'unbekannt';
}

interface KpiCardProps {
  label: string;
  wert: string;
  hinweis?: string;
  veraenderung?: KpiVeraenderung;
  /**
   * Ist ein Anstieg gut?
   *
   * Bei Austritten ist er es nicht - und ein grüner Pfeil nach oben für
   * «mehr Leute sind gegangen» wäre eine irreführende Auskunft.
   */
  anstiegIstGut?: boolean;
}

/**
 * Eine Kennzahl mit ihrem Vergleich.
 *
 * Die Richtung erscheint auch dann, wenn keine Prozentzahl genannt wird: von
 * 1 auf 3 ist ein Anstieg, aber «+200 %» wäre eine Zahl, die mehr verspricht,
 * als sie weiss. Beides zu unterschlagen wäre der andere Fehler.
 */
export function KpiCard({
  label,
  wert,
  hinweis,
  veraenderung,
  anstiegIstGut = true,
}: KpiCardProps): React.JSX.Element {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-5">
      <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold leading-none tabular-nums">{wert}</p>
      {veraenderung ? <Trend veraenderung={veraenderung} anstiegIstGut={anstiegIstGut} /> : null}
      {hinweis ? <p className="mt-1.5 text-xs text-muted-foreground">{hinweis}</p> : null}
    </div>
  );
}

function Trend({
  veraenderung,
  anstiegIstGut,
}: {
  veraenderung: KpiVeraenderung;
  anstiegIstGut: boolean;
}): React.JSX.Element | null {
  if (veraenderung.richtung === 'unbekannt') {
    return (
      <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" aria-hidden="true" />
        Kein Vergleichszeitraum
      </p>
    );
  }

  if (veraenderung.richtung === 'gleich') {
    return (
      <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowRight className="size-3" aria-hidden="true" />
        Unverändert
      </p>
    );
  }

  const gut = veraenderung.richtung === 'auf' ? anstiegIstGut : !anstiegIstGut;
  const Icon = veraenderung.richtung === 'auf' ? ArrowUpRight : ArrowDownRight;

  return (
    <p
      className={cn(
        'mt-1.5 flex items-center gap-1 text-xs font-medium',
        gut ? 'text-success' : 'text-warning',
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {veraenderung.prozent === null ? (
        <>
          {veraenderung.richtung === 'auf' ? 'Mehr' : 'Weniger'} als zuvor
          <span className="font-normal text-muted-foreground">
            ({veraenderung.vorher?.toLocaleString('de-CH')} zuvor)
          </span>
        </>
      ) : (
        <>
          {veraenderung.prozent > 0 ? '+' : ''}
          {veraenderung.prozent.toLocaleString('de-CH', { minimumFractionDigits: 1 })} %
          <span className="font-normal text-muted-foreground">zum vorherigen Zeitraum</span>
        </>
      )}
    </p>
  );
}
