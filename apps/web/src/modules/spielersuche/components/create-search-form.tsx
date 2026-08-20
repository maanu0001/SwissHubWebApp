'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserSearch } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createSearchAction } from '@/modules/spielersuche/actions';

export interface GameOption {
  id: string;
  name: string;
  maxSquadSize: number | null;
  roleName: string | null;
}

/**
 * Formular für eine neue Spielersuche.
 *
 * Es ruft dieselbe Server Action - und damit denselben Service - wie
 * `/spielersuche` auf Discord. Die Suche entsteht immer im Namen des
 * eingeloggten Kontos; eine fremde Discord-ID lässt sich hier nicht angeben.
 */
export function CreateSearchForm({
  csrfToken,
  games,
  maxRequestedPlayers,
}: {
  csrfToken: string;
  games: GameOption[];
  maxRequestedPlayers: number;
}): React.JSX.Element {
  const router = useRouter();
  const [gameId, setGameId] = useState(games[0]?.id ?? '');
  const [requested, setRequested] = useState('3');
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const game = useMemo(() => games.find((entry) => entry.id === gameId) ?? null, [games, gameId]);

  // Der Ersteller zählt bereits als Teilnehmer - deshalb ein Platz weniger.
  const maximum = game?.maxSquadSize ? game.maxSquadSize - 1 : maxRequestedPlayers;

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    const value = Number(requested);
    if (!gameId) {
      setError('Bitte ein Spiel auswählen.');
      return;
    }
    if (!Number.isFinite(value) || value < 1) {
      setError('Bitte mindestens einen gesuchten Mitspieler angeben.');
      return;
    }
    if (value > maximum) {
      setError(
        game?.maxSquadSize
          ? `Bei ${game.name} passen maximal ${game.maxSquadSize} Personen in die Gruppe - du kannst also höchstens ${maximum} suchen.`
          : `Maximal ${maximum} zusätzliche Spieler.`,
      );
      return;
    }

    setPending(true);
    const response = await createSearchAction({
      csrfToken,
      gameId,
      requestedPlayers: value,
      comment: comment.trim() || undefined,
      // Verhindert, dass ein Doppelklick zwei Suchen erzeugt.
      idempotencyKey: crypto.randomUUID(),
    });

    if (response.ok) {
      if (response.data.duplicate) {
        toast.info('Diese Suche wurde bereits erstellt.');
      } else {
        toast.success('Deine Spielersuche ist veröffentlicht.', {
          description: response.data.rolePinged
            ? 'Die Spielrolle wurde erwähnt.'
            : 'Die Spielrolle wurde wegen des Cooldowns nicht erneut erwähnt.',
        });
      }
      for (const warning of response.data.warnings) {
        toast.warning(warning);
      }
      router.push(`/spielersuche/${response.data.matchId}`);
      router.refresh();
    } else {
      toast.error(response.error.message);
      setError(response.error.message);
      setPending(false);
    }
  }

  if (games.length === 0) {
    return (
      <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
        Es ist noch kein aktives Spiel hinterlegt. Unter <strong>Spiele</strong> lässt sich eines anlegen.
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="max-w-xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="spielersuche-game">Spiel</Label>
        <Select value={gameId} onValueChange={setGameId}>
          <SelectTrigger id="spielersuche-game">
            <SelectValue placeholder="Spiel wählen" />
          </SelectTrigger>
          <SelectContent>
            {games.map((entry) => (
              <SelectItem key={entry.id} value={entry.id}>
                {entry.name}
                {entry.maxSquadSize ? ` · max. ${entry.maxSquadSize}` : ' · unbegrenzt'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {game?.roleName ? (
          <p className="text-xs text-muted-foreground">
            Die Rolle @{game.roleName} wird erwähnt, sofern kein Cooldown läuft.
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label htmlFor="spielersuche-count">Gesuchte Spieler</Label>
        <Input
          id="spielersuche-count"
          type="number"
          min={1}
          max={maximum}
          value={requested}
          onChange={(event) => setRequested(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Zusätzlich zu dir.{' '}
          {game?.maxSquadSize
            ? `Gruppengrösse ${game.maxSquadSize} - also höchstens ${maximum}.`
            : `Höchstens ${maximum}.`}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="spielersuche-comment">Kommentar</Label>
        <Textarea
          id="spielersuche-comment"
          value={comment}
          maxLength={500}
          placeholder="z.B. Premier, 15k+"
          onChange={(event) => setComment(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{comment.length}/500 Zeichen · optional</p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={pending}>
        <UserSearch aria-hidden="true" />
        Spielersuche starten
      </Button>
    </form>
  );
}
