'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/shared/states';
import {
  deleteCategoryAction,
  saveCategoryAction,
  seedCategoriesAction,
} from '@/modules/calendar/actions';

interface Kategorie {
  id?: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  defaultBannerUrl: string;
  active: boolean;
  position: number;
}

/**
 * Kategorien pflegen.
 *
 * Bewusst schlicht: Name, Farbe, Symbol, Beschreibung, aktiv. Jede weitere
 * Einstellung waere eine, die gepflegt werden muesste.
 *
 * Das Vorgabe-Banner ist die eine Ausnahme, und es spart Arbeit statt welche
 * zu machen: eine wiederkehrende Reihe hat ihr Bild, und ohne diese Zeile war
 * es an jedem einzelnen Termin nachzutragen.
 */
export function KategorienVerwaltung({
  csrfToken,
  kategorien,
}: {
  csrfToken: string;
  kategorien: Kategorie[];
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [entwurf, setEntwurf] = useState<Kategorie | null>(null);

  const speichern = async (kategorie: Kategorie): Promise<void> => {
    setPending(true);
    try {
      const ergebnis = await saveCategoryAction({ csrfToken, ...kategorie });
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success('Kategorie gespeichert.');
      setEntwurf(null);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const entfernen = async (id: string): Promise<void> => {
    setPending(true);
    try {
      const ergebnis = await deleteCategoryAction({ csrfToken, categoryId: id });
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      toast.success('Kategorie entfernt.');
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const Zeile = ({ kategorie }: { kategorie: Kategorie }): React.JSX.Element => {
    const [werte, setWerte] = useState(kategorie);
    return (
      <div className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-[auto_1fr_1fr_auto_auto]">
        <input
          type="color"
          value={werte.color}
          aria-label={`Farbe von ${werte.name || 'neuer Kategorie'}`}
          onChange={(event) => setWerte({ ...werte, color: event.target.value })}
          className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-background"
        />
        <Input
          value={werte.name}
          maxLength={60}
          placeholder="Name"
          aria-label="Name"
          onChange={(event) => setWerte({ ...werte, name: event.target.value })}
        />
        <Input
          value={werte.description}
          maxLength={200}
          placeholder="Beschreibung"
          aria-label="Beschreibung"
          onChange={(event) => setWerte({ ...werte, description: event.target.value })}
        />
        <Input
          value={werte.defaultBannerUrl}
          maxLength={1000}
          placeholder="Banner (https), optional"
          aria-label="Vorgabe-Banner"
          onChange={(event) => setWerte({ ...werte, defaultBannerUrl: event.target.value })}
          className="sm:col-span-3"
        />
        <label className="flex items-center gap-2">
          <Switch
            checked={werte.active}
            onCheckedChange={(wert) => setWerte({ ...werte, active: wert })}
            aria-label={`${werte.name} aktiv`}
          />
          <span className="text-sm text-muted-foreground">Aktiv</span>
        </label>
        <div className="flex gap-1">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => void speichern(werte)}
            aria-label="Speichern"
          >
            <Save aria-hidden="true" />
          </Button>
          {kategorie.id ? (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              aria-label={`${werte.name} entfernen`}
              onClick={() => void entfernen(kategorie.id!)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            setEntwurf({
              name: '',
              description: '',
              color: '#83060A',
              icon: '',
              defaultBannerUrl: '',
              active: true,
              position: kategorien.length,
            })
          }
        >
          <Plus aria-hidden="true" />
          Kategorie
        </Button>
        {kategorien.length === 0 ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                const ergebnis = await seedCategoriesAction({ csrfToken });
                if (!ergebnis.ok) {
                  toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
                  return;
                }
                toast.success(`${ergebnis.data?.angelegt ?? 0} Kategorien angelegt.`);
                router.refresh();
              } finally {
                setPending(false);
              }
            }}
          >
            <Sparkles aria-hidden="true" />
            Vorschläge übernehmen
          </Button>
        ) : null}
      </div>

      {entwurf ? <Zeile kategorie={entwurf} /> : null}

      {kategorien.length === 0 && !entwurf ? (
        <EmptyState
          title="Noch keine Kategorien"
          description="Ohne Kategorien funktioniert der Kalender - Events lassen sich dann nur nicht farblich unterscheiden."
        />
      ) : (
        <div className="space-y-2">
          {kategorien.map((kategorie) => (
            <Zeile key={kategorie.id} kategorie={kategorie} />
          ))}
        </div>
      )}
    </div>
  );
}
