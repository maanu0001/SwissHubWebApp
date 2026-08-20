'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { createGameAction, deleteGameAction, updateGameAction } from '@/modules/spielersuche/actions';

export interface RoleOption {
  id: string;
  name: string;
  color: number;
  position: number;
}

export interface GameFormValue {
  id?: string;
  name: string;
  roleId: string;
  bannerUrl: string;
  maxSquadSize: string;
  enabled: boolean;
}

const EMPTY: GameFormValue = {
  name: '',
  roleId: '',
  bannerUrl: '',
  maxSquadSize: '',
  enabled: true,
};

/**
 * Spiel anlegen oder bearbeiten.
 *
 * Die Rolle wird ausgewählt, nicht eingetippt - es gibt im ganzen Modul keine
 * Stelle mehr, an der eine Discord-ID von Hand einzugeben wäre.
 */
export function GameDialog({
  csrfToken,
  roles,
  game,
  trigger,
}: {
  csrfToken: string;
  roles: RoleOption[];
  game?: GameFormValue;
  trigger?: React.ReactNode;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<GameFormValue>(game ?? EMPTY);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = Boolean(game?.id);

  async function handleSubmit(): Promise<void> {
    setError(null);
    if (value.name.trim().length < 2) {
      setError('Bitte einen Namen mit mindestens 2 Zeichen angeben.');
      return;
    }
    if (!value.roleId) {
      setError('Bitte eine Discord-Rolle wählen.');
      return;
    }

    const squad = value.maxSquadSize.trim();
    const maxSquadSize = squad === '' ? null : Number(squad);
    if (maxSquadSize !== null && (!Number.isInteger(maxSquadSize) || maxSquadSize < 2 || maxSquadSize > 99)) {
      setError('Die Gruppengrösse muss zwischen 2 und 99 liegen - oder leer für unbegrenzt.');
      return;
    }

    setPending(true);
    const payload = {
      csrfToken,
      name: value.name.trim(),
      roleId: value.roleId,
      bannerUrl: value.bannerUrl.trim() || undefined,
      maxSquadSize,
      enabled: value.enabled,
    };

    const response = editing
      ? await updateGameAction({ ...payload, gameId: game?.id })
      : await createGameAction(payload);

    if (response.ok) {
      toast.success(editing ? 'Das Spiel wurde gespeichert.' : 'Das Spiel wurde angelegt.');
      setOpen(false);
      if (!editing) {
        setValue(EMPTY);
      }
      router.refresh();
    } else {
      toast.error(response.error.message);
      setError(response.error.message);
    }
    setPending(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <Plus aria-hidden="true" />
            Spiel hinzufügen
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? 'Spiel bearbeiten' : 'Neues Spiel'}</DialogTitle>
          <DialogDescription>
            Das Spiel steht anschliessend sofort in <code>/spielersuche</code> zur Auswahl.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="game-name">Name</Label>
            <Input
              id="game-name"
              value={value.name}
              maxLength={60}
              placeholder="Counter-Strike 2"
              onChange={(event) => setValue({ ...value, name: event.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="game-role">Discord-Rolle</Label>
            <Select value={value.roleId} onValueChange={(roleId) => setValue({ ...value, roleId })}>
              <SelectTrigger id="game-role">
                <SelectValue placeholder="Rolle wählen" />
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    @{role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Diese Rolle wird beim Start einer Suche erwähnt - im Rahmen der Sperrfrist.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="game-banner">Banner-URL</Label>
            <Input
              id="game-banner"
              value={value.bannerUrl}
              maxLength={1000}
              placeholder="https://..."
              onChange={(event) => setValue({ ...value, bannerUrl: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Optional, nur https. Discord-Anhänge werden automatisch auf die dauerhafte CDN-Adresse gekürzt.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="game-squad">Maximale Gruppengrösse</Label>
            <Input
              id="game-squad"
              type="number"
              min={2}
              max={99}
              value={value.maxSquadSize}
              placeholder="leer = unbegrenzt"
              onChange={(event) => setValue({ ...value, maxSquadSize: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Inklusive Ersteller. Leer lassen für Spiele ohne feste Gruppengrösse.
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-secondary/30 px-3 py-2.5">
            <Label htmlFor="game-enabled" className="cursor-pointer">
              Aktiv
            </Label>
            <Switch
              id="game-enabled"
              checked={value.enabled}
              onCheckedChange={(enabled) => setValue({ ...value, enabled })}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Abbrechen
          </Button>
          <Button onClick={() => void handleSubmit()} loading={pending}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Auslöser zum Bearbeiten - schlicht ein Stiftsymbol in der Tabelle. */
export function EditGameTrigger(): React.JSX.Element {
  return (
    <Button variant="ghost" size="sm" aria-label="Spiel bearbeiten">
      <Pencil aria-hidden="true" />
    </Button>
  );
}

/** Löscht ein Spiel nach Rückfrage. */
export function DeleteGameButton({
  csrfToken,
  gameId,
  name,
}: {
  csrfToken: string;
  gameId: string;
  name: string;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleDelete(): Promise<void> {
    setPending(true);
    const response = await deleteGameAction({ csrfToken, gameId });
    if (response.ok) {
      toast.success(`"${name}" wurde gelöscht.`);
      setOpen(false);
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
    setPending(false);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`${name} löschen`}>
          <Trash2 aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Spiel löschen</DialogTitle>
          <DialogDescription>
            &bdquo;{name}&ldquo; wird aus der Auswahl entfernt. Vergangene Suchen bleiben im Verlauf erhalten.
            Läuft noch eine Suche zu diesem Spiel, wird das Löschen abgelehnt.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Abbrechen
          </Button>
          <Button variant="destructive" onClick={() => void handleDelete()} loading={pending}>
            Löschen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
