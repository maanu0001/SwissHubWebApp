'use client';

import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/shared/states';
import type { ChannelOption, RoleOption } from '@/modules/configuration/components/discord-option-types';
import { CategoryEditor, LEERE_KATEGORIE, type KategorieWerte } from './category-editor';

export interface KategorieZeile extends KategorieWerte {
  categoryId: string;
  ticketCount: number;
}

/**
 * Die Kategorienverwaltung.
 *
 * Liste und Formular in einem Dialog. Ein eigener Adresspfad je Kategorie
 * waere ordentlicher, brauchte aber eine zweite Seite fuer etwas, das man
 * einmal einrichtet und danach selten anfasst.
 */
export function CategoryManager({
  csrfToken,
  kategorien,
  roles,
  channels,
}: {
  csrfToken: string;
  kategorien: KategorieZeile[];
  roles: RoleOption[];
  channels: ChannelOption[];
}): React.JSX.Element {
  const [offen, setOffen] = useState<KategorieWerte | null>(null);

  return (
    <>
      <div className="flex items-center justify-end">
        <Button onClick={() => setOffen({ ...LEERE_KATEGORIE })}>
          <Plus aria-hidden="true" />
          Kategorie anlegen
        </Button>
      </div>

      {kategorien.length === 0 ? (
        <EmptyState
          title="Noch keine Kategorie"
          description="Ohne aktive Kategorie lässt sich kein Ticket eröffnen."
        />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
          {kategorien.map((kategorie) => (
            <li
              key={kategorie.categoryId}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
            >
              <span className="min-w-0 flex-1 basis-48">
                <span className="block truncate font-medium">
                  {kategorie.emoji ? `${kategorie.emoji} ` : ''}
                  {kategorie.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {kategorie.ticketCount} Tickets
                  {kategorie.supportRoleIds.length > 0
                    ? ` · ${kategorie.supportRoleIds.length} zuständige Rollen`
                    : ' · Standard-Support-Rollen'}
                  {kategorie.formFields.length > 0 ? ` · ${kategorie.formFields.length} Fragen` : ''}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {kategorie.sensitive ? <Badge variant="warning">Heikel</Badge> : null}
                <Badge variant={kategorie.active ? 'success' : 'outline'}>
                  {kategorie.active ? 'Aktiv' : 'Inaktiv'}
                </Badge>
                <Button variant="outline" size="sm" onClick={() => setOffen(kategorie)}>
                  <Pencil aria-hidden="true" />
                  Bearbeiten
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={offen !== null} onOpenChange={(naechste) => (naechste ? undefined : setOffen(null))}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{offen?.categoryId ? 'Kategorie bearbeiten' : 'Neue Kategorie'}</DialogTitle>
          </DialogHeader>
          {offen ? (
            <CategoryEditor
              csrfToken={csrfToken}
              werte={offen}
              roles={roles}
              channels={channels}
              ticketAnzahl={
                kategorien.find((eintrag) => eintrag.categoryId === offen.categoryId)?.ticketCount ?? 0
              }
              onFertig={() => setOffen(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
