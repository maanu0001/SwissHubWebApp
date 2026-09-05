import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PRIORITAET_LABEL, STATUS_LABEL } from './ticket-badges';

const STATUS_AUSWAHL = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'WAITING_FOR_STAFF', 'RESOLVED'] as const;

const ARCHIV_STATUS = ['CLOSED', 'ARCHIVED'] as const;

/**
 * Filterleiste der Ticketlisten.
 *
 * Bewusst ein gewoehnliches GET-Formular. Die Filter stehen damit in der
 * Adresse: eine Ansicht laesst sich verlinken, der Zurueck-Knopf tut das
 * Erwartete, und die Seite kommt ohne JavaScript aus.
 */
export function TicketFilters({
  action,
  suche,
  status,
  prioritaet,
  kategorieId,
  kategorien,
  archiv = false,
}: {
  action: string;
  suche?: string;
  status?: string;
  prioritaet?: string;
  kategorieId?: string;
  kategorien: Array<{ id: string; name: string }>;
  archiv?: boolean;
}): React.JSX.Element {
  const statusWerte = archiv ? ARCHIV_STATUS : STATUS_AUSWAHL;

  return (
    <form
      action={action}
      method="get"
      className="flex flex-wrap items-end gap-2 rounded-xl border border-border/60 p-3"
    >
      <div className="min-w-48 flex-1 space-y-1">
        <label htmlFor="ticket-suche" className="text-xs text-muted-foreground">
          Suche
        </label>
        <Input
          id="ticket-suche"
          name="q"
          defaultValue={suche ?? ''}
          placeholder="Betreff, Mitglied oder #Nummer"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="ticket-status-filter" className="text-xs text-muted-foreground">
          Status
        </label>
        <select
          id="ticket-status-filter"
          name="status"
          defaultValue={status ?? ''}
          className="h-9 rounded-md border border-input bg-background/60 px-3 text-sm"
        >
          <option value="">Alle</option>
          {statusWerte.map((wert) => (
            <option key={wert} value={wert}>
              {STATUS_LABEL[wert] ?? wert}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="ticket-prio-filter" className="text-xs text-muted-foreground">
          Priorität
        </label>
        <select
          id="ticket-prio-filter"
          name="prio"
          defaultValue={prioritaet ?? ''}
          className="h-9 rounded-md border border-input bg-background/60 px-3 text-sm"
        >
          <option value="">Alle</option>
          {Object.entries(PRIORITAET_LABEL).map(([wert, label]) => (
            <option key={wert} value={wert}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {kategorien.length > 0 ? (
        <div className="space-y-1">
          <label htmlFor="ticket-kategorie-filter" className="text-xs text-muted-foreground">
            Kategorie
          </label>
          <select
            id="ticket-kategorie-filter"
            name="kategorie"
            defaultValue={kategorieId ?? ''}
            className="h-9 max-w-48 rounded-md border border-input bg-background/60 px-3 text-sm"
          >
            <option value="">Alle</option>
            {kategorien.map((kategorie) => (
              <option key={kategorie.id} value={kategorie.id}>
                {kategorie.name}
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
