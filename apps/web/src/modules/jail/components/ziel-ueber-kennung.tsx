'use client';

import { useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { resolveVoteJailTargetAction } from '@/modules/jail/actions';
import type { PickedMember } from '@/modules/members/components/member-picker';

/**
 * Ein Ziel über seine Discord-Kennung.
 *
 * Der Weg für alle, die keine Mitgliedersuche haben - und das sind die
 * meisten, die eine Abstimmung starten dürfen. Wer eine startet, kennt die
 * Person: er sitzt mit ihr im Voice oder liest gerade ihre Nachricht. Er
 * braucht keine Liste des Servers, sondern diesen einen Menschen.
 *
 * Nachgeschlagen wird genau eine Kennung. Aufgezählt wird nichts, und die
 * Antwort ist dieselbe für «gibt es nicht» und «gegen den darfst du nicht» -
 * sonst liesse sich an ihr ablesen, wer geschützt ist.
 *
 * Der bequemere Weg steht daneben: auf Discord genügt ein Rechtsklick und
 * `/vote_jail`, dort wählt Discords eigener Auswahldialog die Person.
 */
export function ZielUeberKennung({
  csrfToken,
  value,
  onChange,
}: {
  csrfToken: string;
  value: PickedMember | null;
  onChange: (member: PickedMember | null) => void;
}): React.JSX.Element {
  const [eingabe, setEingabe] = useState('');
  const [pending, setPending] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const nachschlagen = async (): Promise<void> => {
    const kennung = eingabe.trim();
    if (!/^\d{17,20}$/u.test(kennung)) {
      setFehler('Das ist keine Discord-ID. Sie besteht aus 17 bis 20 Ziffern.');
      return;
    }
    setFehler(null);
    setPending(true);
    try {
      const ergebnis = await resolveVoteJailTargetAction({ csrfToken, discordId: kennung });
      if (!ergebnis.ok) {
        setFehler(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        return;
      }
      if (!ergebnis.data) {
        // Bewusst eine einzige Meldung für beide Fälle.
        setFehler('Gegen dieses Mitglied lässt sich keine Abstimmung starten.');
        return;
      }
      onChange({
        discordId: ergebnis.data.discordId,
        username: ergebnis.data.username,
        displayName: ergebnis.data.displayName,
        avatarHash: ergebnis.data.avatarHash,
        jailed: ergebnis.data.jailed,
      });
      setEingabe('');
    } finally {
      setPending(false);
    }
  };

  if (value) {
    return (
      <div className="space-y-1.5">
        <Label>Mitglied</Label>
        <div className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
          <DiscordAvatar
            discordId={value.discordId}
            avatarHash={value.avatarHash}
            name={value.displayName || value.username}
            size={32}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {value.displayName || value.username}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{value.discordId}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Auswahl aufheben"
            onClick={() => onChange(null)}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="vote-target-id">Discord-ID des Mitglieds</Label>
      <div className="flex gap-2">
        <Input
          id="vote-target-id"
          value={eingabe}
          inputMode="numeric"
          placeholder="z.B. 123456789012345678"
          onChange={(event) => setEingabe(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void nachschlagen();
            }
          }}
        />
        <Button variant="outline" disabled={pending} onClick={() => void nachschlagen()}>
          {pending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Search aria-hidden="true" />
          )}
          Suchen
        </Button>
      </div>
      {fehler ? (
        <p role="alert" className="text-xs text-destructive">
          {fehler}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Rechtsklick auf das Mitglied → «ID kopieren». Schneller geht es direkt auf Discord mit{' '}
          <code>/vote_jail</code> – dort wählst du die Person im Auswahldialog.
        </p>
      )}
    </div>
  );
}
