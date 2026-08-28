'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Check, ExternalLink, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { EmptyState } from '@/components/shared/states';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { AiBadge, StatusBadge, dauer, kontoAlter } from './shared';
import { approveAction, rejectAction, retryAiAction } from '@/modules/verification/actions';

export interface WarteEintrag {
  id: string;
  discordId: string;
  username: string | null;
  displayName: string | null;
  avatarHash: string | null;
  status: 'WAITING_FOR_MESSAGE' | 'AI_ANALYZING' | 'WAITING_FOR_REVIEW';
  joinedAt: string;
  accountCreatedAt: string | null;
  latestMessage: string | null;
  latestMessageId: string | null;
  messageCount: number;
  aiVerdict: string | null;
  aiConfidence: number | null;
  aiError: string | null;
  wartetSeit: number;
  jungesKonto: boolean;
  ohneAvatar: boolean;
}

const GRUENDE = [
  'Spam/Bot',
  'Keine sinnvolle Verifikation',
  'Verdächtiger Account',
  'Regelverstoss',
  'Sonstiges',
];

/**
 * Die Warteschlange.
 *
 * Auf dem Telefon Karten statt einer Tabelle: eine Tabelle mit Avatar,
 * Nachricht und vier Knoepfen ist auf 390 Pixeln nicht bedienbar.
 *
 * Der Live-Strom haelt die Liste aktuell, ohne dass jemand neu laden muss.
 * Faellt er aus, bleibt der zuletzt geladene Stand stehen - das ist
 * schlechter als aktuell, aber besser als leer.
 */
export function Warteschlange({
  csrfToken,
  eintraege: initial,
  guildId,
  verifikationsKanalId,
  rechte,
}: {
  csrfToken: string;
  eintraege: WarteEintrag[];
  guildId: string;
  verifikationsKanalId: string | null;
  rechte: { approve: boolean; reject: boolean; ai: boolean };
}): React.JSX.Element {
  const router = useRouter();
  const [eintraege, setEintraege] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [ablehnen, setAblehnen] = useState<WarteEintrag | null>(null);
  const [grund, setGrund] = useState(GRUENDE[0]!);
  const [live, setLive] = useState(false);

  // Der Server bleibt die Wahrheit: kommt ein frischer Stand herein, ersetzt
  // er die Liste vollständig.
  useEffect(() => {
    setEintraege(initial);
  }, [initial]);

  useEffect(() => {
    const quelle = new EventSource('/api/verifikation/live');
    quelle.addEventListener('open', () => setLive(true));
    quelle.addEventListener('queue', (ereignis) => {
      try {
        const daten = JSON.parse((ereignis as MessageEvent<string>).data) as {
          zeilen: Array<Omit<WarteEintrag, 'joinedAt' | 'accountCreatedAt'> & {
            joinedAt: string;
            accountCreatedAt: string | null;
          }>;
        };
        setEintraege(daten.zeilen as WarteEintrag[]);
      } catch {
        // Ein unlesbares Ereignis ist kein Grund, die Liste zu leeren.
      }
    });
    quelle.addEventListener('error', () => setLive(false));
    return () => quelle.close();
  }, []);

  const fuehreAus = async (
    schluessel: string,
    aktion: () => Promise<{ ok: boolean; error?: { message: string }; data?: unknown }>,
    erfolg: string,
  ): Promise<void> => {
    setPending(schluessel);
    try {
      const ergebnis = await aktion();
      if (!ergebnis.ok) {
        toast.error(ergebnis.error?.message ?? 'Das hat nicht geklappt.');
        throw new Error('fehlgeschlagen');
      }
      const daten = ergebnis.data as { gewonnen?: boolean; hinweis?: string | null } | undefined;
      if (daten?.gewonnen === false) {
        toast.info('Dieser Fall war bereits entschieden.');
      } else {
        toast.success(daten?.hinweis ? `${erfolg} Hinweis: ${daten.hinweis}` : erfolg);
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  if (eintraege.length === 0) {
    return (
      <EmptyState
        title="Niemand wartet"
        description="Sobald jemand beitritt und schreibt, erscheint der Fall hier - ohne Neuladen."
      />
    );
  }

  return (
    <>
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
        />
        {live ? 'Live - neue Fälle erscheinen von selbst.' : 'Nicht verbunden - bitte neu laden.'}
      </p>

      <div className="space-y-3">
        {eintraege.map((eintrag) => {
          const busy = pending !== null;
          const name = eintrag.displayName ?? eintrag.username ?? eintrag.discordId;
          return (
            <div
              key={eintrag.id}
              className="space-y-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
                <DiscordAvatar
                  discordId={eintrag.discordId}
                  avatarHash={eintrag.avatarHash}
                  name={name}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {eintrag.username ? `@${eintrag.username} · ` : ''}
                    {eintrag.discordId}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={eintrag.status} />
                  <AiBadge verdict={eintrag.aiVerdict} confidence={eintrag.aiConfidence} />
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Konto</dt>
                  <dd className={eintrag.jungesKonto ? 'text-amber-500' : ''}>
                    {kontoAlter(
                      new Date(eintrag.joinedAt),
                      eintrag.accountCreatedAt ? new Date(eintrag.accountCreatedAt) : null,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Wartet</dt>
                  <dd className="tabular-nums">{dauer(eintrag.wartetSeit)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Nachrichten</dt>
                  <dd className="tabular-nums">{eintrag.messageCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Avatar</dt>
                  <dd className={eintrag.ohneAvatar ? 'text-amber-500' : ''}>
                    {eintrag.ohneAvatar ? 'keiner' : 'vorhanden'}
                  </dd>
                </div>
              </dl>

              {eintrag.jungesKonto || eintrag.ohneAvatar ? (
                <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-500">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    {[
                      eintrag.jungesKonto ? 'Konto jünger als 24 Stunden' : null,
                      eintrag.ohneAvatar ? 'kein Avatar' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    . Ein Hinweis, kein Urteil - bitte die Nachricht bewerten.
                  </span>
                </p>
              ) : null}

              {eintrag.latestMessage ? (
                <blockquote className="rounded-lg border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-sm">
                  {eintrag.latestMessage}
                </blockquote>
              ) : (
                <p className="text-sm text-muted-foreground">Noch keine Nachricht geschrieben.</p>
              )}

              {eintrag.aiError ? (
                <p className="text-xs text-muted-foreground">
                  AI-Prüfung fehlgeschlagen ({eintrag.aiError}) - bitte von Hand bewerten.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {rechte.approve ? (
                  <Button
                    size="sm"
                    disabled={busy || !eintrag.latestMessage}
                    onClick={() =>
                      void fuehreAus(
                        `approve-${eintrag.id}`,
                        () => approveAction({ csrfToken, requestId: eintrag.id }),
                        'Mitglied freigeschaltet.',
                      ).catch(() => undefined)
                    }
                  >
                    <Check aria-hidden="true" />
                    Verifizieren
                  </Button>
                ) : null}

                {rechte.reject ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setAblehnen(eintrag);
                      setGrund(GRUENDE[0]!);
                    }}
                  >
                    <X aria-hidden="true" />
                    Ablehnen
                  </Button>
                ) : null}

                {rechte.ai && eintrag.latestMessage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label="AI-Prüfung erneut versuchen"
                    onClick={() =>
                      void fuehreAus(
                        `ai-${eintrag.id}`,
                        () => retryAiAction({ csrfToken, requestId: eintrag.id }),
                        'AI-Prüfung durchgeführt.',
                      ).catch(() => undefined)
                    }
                  >
                    <RefreshCw aria-hidden="true" />
                  </Button>
                ) : null}

                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`https://discord.com/users/${eintrag.discordId}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <ExternalLink aria-hidden="true" />
                    Profil
                  </a>
                </Button>

                {verifikationsKanalId && eintrag.latestMessageId ? (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`https://discord.com/channels/${guildId}/${verifikationsKanalId}/${eintrag.latestMessageId}`}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Nachricht
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmationDialog
        open={ablehnen !== null}
        onOpenChange={(offen) => !offen && setAblehnen(null)}
        title="User wirklich ablehnen und bannen?"
        description={
          ablehnen
            ? `${ablehnen.displayName ?? ablehnen.discordId} wird vom Server gebannt. Der Bann erscheint im Moderation Center und in der Akte.`
            : ''
        }
        confirmLabel="Ablehnen & bannen"
        destructive
        onConfirm={async () => {
          if (!ablehnen) {
            return;
          }
          await fuehreAus(
            `reject-${ablehnen.id}`,
            () => rejectAction({ csrfToken, requestId: ablehnen.id, reason: grund }),
            'Abgelehnt und gebannt.',
          );
          setAblehnen(null);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="grund">Grund</Label>
          <select
            id="grund"
            value={grund}
            onChange={(event) => setGrund(event.target.value)}
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
          >
            {GRUENDE.map((eintrag) => (
              <option key={eintrag} value={eintrag}>
                {eintrag}
              </option>
            ))}
          </select>
        </div>
      </ConfirmationDialog>
    </>
  );
}
