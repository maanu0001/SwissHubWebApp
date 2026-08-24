import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { STATUS_LABEL } from './tournament-badges';

const AKTIVE_AUSWAHL = [
  'DRAFT',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'CHECKIN_OPEN',
  'CHECKIN_CLOSED',
  'READY',
  'RUNNING',
  'PAUSED',
] as const;

const ARCHIV_AUSWAHL = ['COMPLETED', 'CANCELLED', 'ARCHIVED'] as const;

/**
 * Filterleiste der Turnierlisten.
 *
 * Wie bei den Tickets ein gewöhnliches GET-Formular: die Filter stehen in der
 * Adresse, eine Ansicht lässt sich verlinken, und die Seite kommt ohne
 * JavaScript aus.
 */
export function TournamentFilters({
  action,
  suche,
  status,
  spielId,
  spiele,
  archiv = false,
}: {
  action: string;
  suche?: string;
  status?: string;
  spielId?: string;
  spiele: Array<{ id: string; name: string }>;
  archiv?: boolean;
}): React.JSX.Element {
  const statusWerte = archiv ? ARCHIV_AUSWAHL : AKTIVE_AUSWAHL;

  return (
    <form
      action={action}
      method="get"
      className="flex flex-wrap items-end gap-2 rounded-xl border border-border/60 p-3"
    >
      <div className="min-w-48 flex-1 space-y-1">
        <label htmlFor="turnier-suche" className="text-xs text-muted-foreground">
          Suche
        </label>
        <Input
          id="turnier-suche"
          name="q"
          defaultValue={suche ?? ''}
          placeholder="Name, Spiel oder Kennung"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="turnier-status" className="text-xs text-muted-foreground">
          Status
        </label>
        <select
          id="turnier-status"
          name="status"
          defaultValue={status ?? ''}
          className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
        >
          <option value="">Alle</option>
          {statusWerte.map((wert) => (
            <option key={wert} value={wert}>
              {STATUS_LABEL[wert] ?? wert}
            </option>
          ))}
        </select>
      </div>

      {spiele.length > 0 ? (
        <div className="space-y-1">
          <label htmlFor="turnier-spiel" className="text-xs text-muted-foreground">
            Spiel
          </label>
          <select
            id="turnier-spiel"
            name="spiel"
            defaultValue={spielId ?? ''}
            className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="">Alle</option>
            {spiele.map((spiel) => (
              <option key={spiel.id} value={spiel.id}>
                {spiel.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <Button type="submit" variant="outline">
        <Search aria-hidden="true" />
        Filtern
      </Button>
    </form>
  );
}
