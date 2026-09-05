'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Filter, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ACTION_LABEL, ACTION_TYPES, SOURCE_LABEL, SOURCES } from '@/modules/moderation/sections';
import { cn } from '@/lib/utils';

interface HistoryFiltersProps {
  type: string;
  quelle: string;
  member: string;
  actor: string;
  von: string;
  bis: string;
}

const ALLE = 'alle';

/**
 * Filter des Moderationsverlaufs.
 *
 * Die Werte landen in der Adresszeile, nicht im Zustand der Komponente: eine
 * gefilterte Ansicht bleibt dadurch teilbar und übersteht das Neuladen. Der
 * Cursor wird beim Filtern bewusst nicht mitgenommen - er gehörte zur alten
 * Auswahl.
 */
export function HistoryFilters(props: HistoryFiltersProps): React.JSX.Element {
  const router = useRouter();
  const [type, setType] = useState(props.type || ALLE);
  const [quelle, setQuelle] = useState(props.quelle || ALLE);
  const [member, setMember] = useState(props.member);
  const [actor, setActor] = useState(props.actor);
  const [von, setVon] = useState(props.von);
  const [bis, setBis] = useState(props.bis);

  const aktiv = Boolean(props.type || props.quelle || props.member || props.actor || props.von || props.bis);

  function anwenden(): void {
    const suche = new URLSearchParams();
    if (type && type !== ALLE) {
      suche.set('type', type);
    }
    if (quelle && quelle !== ALLE) {
      suche.set('quelle', quelle);
    }
    if (member.trim()) {
      suche.set('member', member.trim());
    }
    if (actor.trim()) {
      suche.set('actor', actor.trim());
    }
    if (von) {
      suche.set('von', von);
    }
    if (bis) {
      suche.set('bis', bis);
    }
    const abfrage = suche.toString();
    router.push(abfrage ? `/moderation/verlauf?${abfrage}` : '/moderation/verlauf');
  }

  return (
    <form
      className="grid gap-3 rounded-xl border border-border bg-card p-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))]"
      onSubmit={(event) => {
        event.preventDefault();
        anwenden();
      }}
    >
      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="filter-type">Massnahme</Label>
        {/* Ein natives Select: die Liste ist kurz und muss ohne JavaScript
            bedienbar bleiben, wenn die Seite geteilt wird. */}
        <select
          id="filter-type"
          value={type}
          onChange={(event) => setType(event.target.value)}
          className="flex h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value={ALLE}>Alle</option>
          {ACTION_TYPES.map((wert) => (
            <option key={wert} value={wert}>
              {ACTION_LABEL[wert]}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="filter-quelle">Quelle</Label>
        {/* Die Frage, die dieser Filter beantwortet: «was haben wir selbst
            getan, und was ist an uns vorbei geschehen?» */}
        <select
          id="filter-quelle"
          value={quelle}
          onChange={(event) => setQuelle(event.target.value)}
          className="flex h-10 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value={ALLE}>Alle</option>
          {SOURCES.map((wert) => (
            <option key={wert} value={wert}>
              {SOURCE_LABEL[wert]}
            </option>
          ))}
        </select>
      </div>

      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="filter-member">Betroffen (Discord-ID)</Label>
        <Input
          id="filter-member"
          value={member}
          inputMode="numeric"
          placeholder="z.B. 123456789012345678"
          onChange={(event) => setMember(event.target.value)}
        />
      </div>

      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="filter-actor">Moderator (Discord-ID)</Label>
        <Input
          id="filter-actor"
          value={actor}
          inputMode="numeric"
          placeholder="z.B. 123456789012345678"
          onChange={(event) => setActor(event.target.value)}
        />
      </div>

      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="filter-von">Von</Label>
        <Input id="filter-von" type="date" value={von} onChange={(event) => setVon(event.target.value)} />
      </div>

      <div className="min-w-0 space-y-1.5">
        <Label htmlFor="filter-bis">Bis</Label>
        <Input id="filter-bis" type="date" value={bis} onChange={(event) => setBis(event.target.value)} />
      </div>

      <div className="flex min-w-0 items-end gap-2">
        <Button type="submit" variant="outline" className="flex-1">
          <Filter aria-hidden="true" />
          Filtern
        </Button>
        {aktiv ? (
          <a
            href="/moderation/verlauf"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
            aria-label="Filter zurücksetzen"
          >
            <X aria-hidden="true" />
          </a>
        ) : null}
      </div>
    </form>
  );
}
