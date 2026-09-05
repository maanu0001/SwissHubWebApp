'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Loader2, Search, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { searchMembersAction } from '@/modules/members/actions';

export interface PickedMember {
  discordId: string;
  username: string;
  displayName: string;
  avatarHash: string | null;
  jailed: boolean;
}

/** Ein Treffer, wie ihn eine Suchaktion zurueckgibt. */
interface SucheTreffer extends PickedMember {
  isBot: boolean;
}

/**
 * Die Suche, mit der dieser Picker arbeitet.
 *
 * Voreingestellt ist die allgemeine Mitgliedersuche. Der Vote-Jail-Ablauf
 * uebergibt stattdessen seine eigene: sie verlangt nicht `members.view` und
 * liefert nur, wogegen tatsaechlich abgestimmt werden darf. Der Picker
 * bleibt derselbe - was er zeigt, entscheidet die Aktion, die ihn beliefert,
 * und die prueft serverseitig.
 */
export type MemberSuche = (eingabe: {
  csrfToken: string;
  query: string;
  limit?: number;
}) => Promise<{ ok: true; data: SucheTreffer[] } | { ok: false; error: { message: string } }>;

interface MemberPickerProps {
  csrfToken: string;
  value: PickedMember | null;
  onChange(member: PickedMember | null): void;
  label?: string;
  /** Abweichende Suche - siehe `MemberSuche`. */
  suche?: MemberSuche;
}

const DEBOUNCE_MS = 350;

/**
 * Mitgliedersuche mit Debouncing.
 * Die eigentliche Suche läuft serverseitig (Rate Limit + Berechtigungsprüfung).
 */
export function MemberPicker({
  csrfToken,
  value,
  onChange,
  label = 'Benutzer',
  suche,
}: MemberPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedMember[]>([]);
  const [pending, startTransition] = useTransition();
  const [touched, setTouched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!touched || query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const response = await (suche ?? searchMembersAction)({ csrfToken, query, limit: 20 });
        if (response.ok) {
          setResults(
            response.data
              .filter((member) => !member.isBot)
              .map((member) => ({
                discordId: member.discordId,
                username: member.username,
                displayName: member.displayName,
                avatarHash: member.avatarHash,
                jailed: member.jailed,
              })),
          );
        } else {
          toast.error(response.error.message);
          setResults([]);
        }
      });
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [query, csrfToken, touched, suche]);

  if (value) {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2">
          <span className="flex items-center gap-3">
            <DiscordAvatar
              discordId={value.discordId}
              avatarHash={value.avatarHash}
              name={value.displayName}
              size={32}
              status={value.jailed ? 'jailed' : null}
            />
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-medium">{value.displayName}</span>
              <span className="text-xs text-muted-foreground">@{value.username}</span>
            </span>
            {value.jailed ? <Badge variant="warning">Bereits gejailt</Badge> : null}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery('');
              setResults([]);
            }}
            className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Ändern
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="member-search">{label}</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          id="member-search"
          value={query}
          onChange={(event) => {
            setTouched(true);
            setQuery(event.target.value);
          }}
          placeholder="Username, Anzeigename oder Discord ID"
          className="pl-9"
          autoComplete="off"
          aria-describedby="member-search-hint"
        />
        {pending ? (
          <Loader2
            className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <p id="member-search-hint" className="text-xs text-muted-foreground">
        Mindestens 2 Zeichen. Discord IDs werden direkt aufgelöst.
      </p>

      {results.length > 0 ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-1 scrollbar-slim">
          {results.map((member) => (
            <li key={member.discordId}>
              <button
                type="button"
                onClick={() => onChange(member)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <DiscordAvatar
                  status={member.jailed ? 'jailed' : null}
                  discordId={member.discordId}
                  avatarHash={member.avatarHash}
                  name={member.displayName}
                  size={32}
                />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm font-medium">{member.displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">@{member.username}</span>
                </span>
                {member.jailed ? (
                  <Badge variant="warning" className="ml-auto">
                    Gejailt
                  </Badge>
                ) : (
                  <UserCheck className="ml-auto size-4 text-muted-foreground" aria-hidden="true" />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
