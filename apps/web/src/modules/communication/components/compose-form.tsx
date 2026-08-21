'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ExternalLink, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import { sendEventAction, sendNewsAction, sendPollAction } from '@/modules/communication/actions';
import { runSubmit } from '@/modules/communication/submit';
import { EmbedPreview, type PreviewType } from './embed-preview';

/**
 * Nachricht erstellen.
 *
 * Formular links, Discord-Vorschau rechts (auf Mobile untereinander). Vor dem
 * Senden folgt eine Bestätigung mit Channel, Typ und Titel - eine echte
 * Discord-Nachricht soll niemand versehentlich absetzen.
 */
export interface ChannelChoice {
  id: string;
  name: string;
  parentName: string | null;
  /** Fehlende Bot-Rechte; nicht leer = Channel nicht auswählbar. */
  missing: string[];
}

export interface RoleChoice {
  id: string;
  name: string;
  /** Farbe der Rolle als CSS-Wert, damit die Auswahl aussieht wie auf Discord. */
  color?: string | null;
}

const MENTION_NONE = 'none';

export type RegistrationType = 'NONE' | 'TEXT' | 'TICKET' | 'CHANNEL' | 'URL';

/** Vorbelegung aus einer bestehenden Nachricht ("Als Vorlage verwenden"). */
export interface ComposeTemplate {
  title: string;
  content: string;
  bannerUrl: string | null;
  mention?: string;
  mentionTarget?: string;
  location?: string;
  /** Bereits als Wert für `datetime-local` aufbereitet. */
  startsAtLocal?: string;
  registrationType?: RegistrationType;
  registrationValue?: string;
  responsibleDiscordId?: string;
}

/** Discord-Grenzen, gespiegelt aus dem Modul - für die Zeichenzähler. */
const TITLE_MAX = 256;
const CONTENT_MAX = 3000;
const LOCATION_MAX = 200;

export function ComposeForm({
  csrfToken,
  type,
  channels,
  roles,
  defaultChannelId,
  footerText,
  canMention,
  allowEveryone,
  ticketChannel,
  currentUserName,
  template,
}: {
  csrfToken: string;
  type: PreviewType;
  channels: ChannelChoice[];
  roles: RoleChoice[];
  defaultChannelId: string | null;
  footerText: string;
  canMention: boolean;
  /** @everyone/@here überhaupt möglich - Berechtigung und Einstellung zusammen. */
  allowEveryone: boolean;
  /** Der konfigurierte Ticket-Channel, falls vorhanden. */
  ticketChannel?: { id: string; name: string } | null;
  /** Wer gerade angemeldet ist - ohne Auswahl die verantwortliche Person. */
  currentUserName: string;
  template?: ComposeTemplate | null;
}): React.JSX.Element {
  const router = useRouter();
  const usable = channels.filter((channel) => channel.missing.length === 0);

  const [channelId, setChannelId] = useState(
    defaultChannelId && usable.some((entry) => entry.id === defaultChannelId)
      ? defaultChannelId
      : (usable[0]?.id ?? ''),
  );
  const [title, setTitle] = useState(template?.title ?? '');
  const [content, setContent] = useState(template?.content ?? '');
  const [bannerUrl, setBannerUrl] = useState(template?.bannerUrl ?? '');
  const [mention, setMention] = useState<string>(template?.mention ?? MENTION_NONE);
  const [mentionTarget, setMentionTarget] = useState<string>(template?.mentionTarget ?? '');
  const [mentionUser, setMentionUser] = useState<PickedMember | null>(null);
  const [startsAtLocal, setStartsAtLocal] = useState(template?.startsAtLocal ?? '');
  const [responsible, setResponsible] = useState<PickedMember | null>(null);
  const [location, setLocation] = useState(template?.location ?? '');
  const [registrationType, setRegistrationType] = useState<RegistrationType>(
    template?.registrationType ?? 'NONE',
  );
  const [registrationValue, setRegistrationValue] = useState(template?.registrationValue ?? '');

  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  /** Nach dem Senden: Erfolgsanzeige mit Verweis auf Discord. */
  const [sent, setSent] = useState<{ discordUrl: string | null; channelName: string } | null>(null);

  /**
   * Beim Verlassen warnen, wenn etwas eingetippt wurde.
   *
   * Nur bei tatsächlichem Inhalt - eine Warnung auf einem leeren Formular
   * wäre nur lästig.
   */
  const dirty = title.trim() !== '' || content.trim() !== '' || location.trim() !== '';
  useEffect(() => {
    if (!dirty || sent) {
      return;
    }
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, sent]);

  const channel = channels.find((entry) => entry.id === channelId) ?? null;
  /**
   * Verbindet Browser-Anfrage, Server Action, Discord-Aufruf und Audit-Eintrag.
   * Bleibt über das Leben des Formulars gleich, damit sich ein wiederholter
   * Versuch demselben Vorgang zuordnen lässt.
   */
  const [correlationId] = useState(() => `web:${crypto.randomUUID().slice(0, 8)}`);
  const startsAt = useMemo(() => (startsAtLocal ? new Date(startsAtLocal) : null), [startsAtLocal]);

  const mentionLabel =
    mention === MENTION_NONE
      ? null
      : mention === 'role'
        ? `@${roles.find((role) => role.id === mentionTarget)?.name ?? 'Rolle'}`
        : mention === 'user'
          ? `@${mentionUser?.displayName ?? 'Person'}`
          : `@${mention}`;

  /**
   * Die Anmeldeangabe, so wie sie im Embed erscheinen wird.
   *
   * Nur Darstellung - was tatsächlich gesendet wird, entsteht auf dem Server.
   */
  const registrationLabel = useMemo(() => {
    switch (registrationType) {
      case 'TICKET':
        return ticketChannel ? `#${ticketChannel.name}` : null;
      case 'CHANNEL': {
        const target = channels.find((entry) => entry.id === registrationValue);
        return target ? `#${target.name}` : null;
      }
      case 'URL':
      case 'TEXT':
        return registrationValue.trim() === '' ? null : registrationValue.trim();
      default:
        return null;
    }
  }, [registrationType, registrationValue, ticketChannel, channels]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!channelId) {
      next.channelId = 'Bitte einen Channel wählen.';
    }
    if (title.trim().length < 3) {
      next.title = 'Bitte einen Titel mit mindestens 3 Zeichen angeben.';
    }
    if (content.trim().length < 3) {
      next.content = 'Bitte einen Text mit mindestens 3 Zeichen angeben.';
    }
    if (bannerUrl.trim() !== '' && !bannerUrl.trim().startsWith('https://')) {
      next.bannerUrl = 'Nur https-Adressen sind erlaubt.';
    }
    if (mention === 'role' && !mentionTarget) {
      next.mentionTarget = 'Bitte eine Rolle wählen.';
    }
    if (mention === 'user' && !mentionUser) {
      next.mentionTarget = 'Bitte eine Person wählen.';
    }
    if (type === 'EVENT') {
      if (location.trim().length === 0) {
        next.location = 'Bitte einen Treffpunkt angeben.';
      }
      if (!startsAt) {
        next.startsAt = 'Bitte Datum und Uhrzeit wählen.';
      }
      if (registrationType === 'TEXT' && registrationValue.trim().length === 0) {
        next.registrationValue = 'Bitte angeben, wie man sich anmeldet.';
      }
      if (registrationType === 'CHANNEL' && registrationValue.trim().length === 0) {
        next.registrationValue = 'Bitte einen Channel wählen.';
      }
      if (registrationType === 'URL' && !registrationValue.trim().startsWith('https://')) {
        next.registrationValue = 'Nur https-Adressen sind erlaubt.';
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleContinue(): void {
    if (!validate()) {
      return;
    }
    setIdempotencyKey(crypto.randomUUID());
    setConfirming(true);
  }

  async function handleSend(): Promise<void> {
    if (!idempotencyKey || pending) {
      return;
    }
    setPending(true);

    const base = {
      csrfToken,
      channelId,
      title: title.trim(),
      content: content.trim(),
      bannerUrl: bannerUrl.trim() === '' ? undefined : bannerUrl.trim(),
      mention: mention === MENTION_NONE ? 'none' : mention,
      mentionTarget:
        mention === 'role' ? mentionTarget : mention === 'user' ? (mentionUser?.discordId ?? '') : undefined,
      idempotencyKey,
      correlationId,
    };

    const channelName = channel?.name ?? '';

    // Der Ablauf steckt in `runSubmit`: dort ist zugesichert, dass der
    // Ladezustand in jedem Fall zurückgesetzt wird - auch wenn die Anfrage
    // gar nicht durchkommt. Genau daran hing die Oberfläche zuvor fest.
    await runSubmit(
      () =>
        type === 'NEWS'
          ? sendNewsAction(base)
          : type === 'POLL'
            ? sendPollAction(base)
            : sendEventAction({
                ...base,
                location: location.trim(),
                // Der Server erwartet UTC; der Picker liefert lokale Zeit.
                startsAt: startsAt ? startsAt.toISOString() : '',
                responsibleDiscordId: responsible?.discordId,
                registrationType,
                registrationValue:
                  registrationType === 'NONE' || registrationType === 'TICKET'
                    ? undefined
                    : registrationValue.trim(),
              }),
      {
        settle: () => {
          setPending(false);
          setConfirming(false);
        },
        onSuccess: (data) => {
          for (const warning of data.warnings) {
            toast.warning(warning);
          }
          toast.success(
            type === 'NEWS'
              ? `Neuigkeiten wurden in #${channelName} gesendet.`
              : type === 'EVENT'
                ? `Event wurde in #${channelName} gesendet.`
                : `Umfrage wurde in #${channelName} gesendet.`,
          );
          setSent({ discordUrl: data.discordUrl ?? null, channelName });
          setIdempotencyKey(null);
          setErrors({});
          router.refresh();
        },
        onError: (outcome) => {
          if (outcome.kind === 'error' && outcome.fieldErrors) {
            setErrors(outcome.fieldErrors);
          }
          toast.error(outcome.message);
          // Der Schlüssel bleibt bestehen: ein erneuter Versuch soll dieselbe
          // Nachricht meinen und nicht doppelt posten. Der Formularinhalt
          // bleibt ebenfalls stehen, damit sich der Fehler beheben lässt.
        },
      },
    );
  }

  /** Formular für eine neue Nachricht zurücksetzen. */
  function resetForm(): void {
    setSent(null);
    setTitle('');
    setContent('');
    setBannerUrl('');
    setLocation('');
    setStartsAtLocal('');
    setRegistrationType('NONE');
    setRegistrationValue('');
    setResponsible(null);
    setErrors({});
    setIdempotencyKey(null);
  }

  // Nach dem Senden nicht auf einer Ladeanzeige stehenbleiben, sondern klar
  // sagen, was passiert ist, und beide sinnvollen nächsten Schritte anbieten.
  if (sent) {
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden="true" />
        <h3 className="mt-3 text-lg font-semibold">
          {type === 'NEWS' ? 'Neuigkeiten' : type === 'EVENT' ? 'Event' : 'Umfrage'} wurde gesendet.
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">Veröffentlicht in #{sent.channelName}.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {sent.discordUrl ? (
            <Button asChild variant="outline">
              <a href={sent.discordUrl} target="_blank" rel="noreferrer noopener">
                <ExternalLink aria-hidden="true" />
                Auf Discord öffnen
              </a>
            </Button>
          ) : null}
          <Button onClick={resetForm}>Neue Nachricht erstellen</Button>
          <Button asChild variant="outline">
            <Link href="/communication/history">Zum Verlauf</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="comm-channel">Senden in</Label>
          <Select value={channelId} onValueChange={setChannelId}>
            <SelectTrigger id="comm-channel">
              <SelectValue placeholder="Channel wählen" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((entry) => (
                <SelectItem key={entry.id} value={entry.id} disabled={entry.missing.length > 0}>
                  <span className="flex items-center gap-2">
                    #{entry.name}
                    {entry.parentName ? (
                      <span className="text-xs text-muted-foreground">{entry.parentName}</span>
                    ) : null}
                    {entry.missing.length > 0 ? (
                      <span className="text-xs text-destructive">(Bot darf hier nicht senden)</span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.channelId ? <p className="text-xs text-destructive">{errors.channelId}</p> : null}
          {channels.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Keine Channels synchronisiert - bitte zuerst unter System → Discord-Sync abgleichen.
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="comm-title">Titel</Label>
          <Input
            id="comm-title"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={type === 'EVENT' ? 'z.B. SwissHub Movie Night' : 'z.B. Server Update'}
          />
          <p className="text-xs text-muted-foreground">
            {title.length} / {TITLE_MAX} Zeichen
          </p>
          {errors.title ? <p className="text-xs text-destructive">{errors.title}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="comm-content">Text</Label>
          <Textarea
            id="comm-content"
            value={content}
            maxLength={CONTENT_MAX}
            rows={8}
            onChange={(event) => setContent(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {content.length} / {CONTENT_MAX} Zeichen
          </p>
          {errors.content ? <p className="text-xs text-destructive">{errors.content}</p> : null}
        </div>

        {type === 'EVENT' ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="comm-location">Treffpunkt</Label>
              <Input
                id="comm-location"
                value={location}
                maxLength={LOCATION_MAX}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="z.B. Discord Lounge, Game Lounge, Bern"
              />
              <p className="text-xs text-muted-foreground">
                {location.length} / {LOCATION_MAX} Zeichen
              </p>
              {errors.location ? <p className="text-xs text-destructive">{errors.location}</p> : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="comm-date">Datum und Uhrzeit</Label>
              <Input
                id="comm-date"
                type="datetime-local"
                value={startsAtLocal}
                onChange={(event) => setStartsAtLocal(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Lokale Zeit (Europe/Zurich). Discord zeigt jedem Mitglied seine eigene Zeitzone.
              </p>
              {errors.startsAt ? <p className="text-xs text-destructive">{errors.startsAt}</p> : null}
            </div>

            <MemberPicker
              csrfToken={csrfToken}
              value={responsible}
              onChange={setResponsible}
              label="Verantwortliche Person (optional)"
            />
            <p className="-mt-2 text-xs text-muted-foreground">
              Ohne Auswahl erscheinst du selbst als verantwortliche Person.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="comm-registration">Anmeldung via</Label>
              <Select
                value={registrationType}
                onValueChange={(next) => {
                  setRegistrationType(next as RegistrationType);
                  setRegistrationValue('');
                }}
              >
                <SelectTrigger id="comm-registration">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Keine Angabe</SelectItem>
                  <SelectItem value="TICKET" disabled={!ticketChannel}>
                    Ticket-System
                    {ticketChannel ? ` (#${ticketChannel.name})` : ' (kein Ticket-Channel konfiguriert)'}
                  </SelectItem>
                  <SelectItem value="CHANNEL">Discord Channel</SelectItem>
                  <SelectItem value="URL">Adresse</SelectItem>
                  <SelectItem value="TEXT">Freitext</SelectItem>
                </SelectContent>
              </Select>

              {registrationType === 'TICKET' && !ticketChannel ? (
                <p className="text-xs text-warning">
                  Es ist kein Ticket-Channel konfiguriert.{' '}
                  <Link href="/modules/communication" className="underline">
                    Jetzt konfigurieren
                  </Link>
                </p>
              ) : null}

              {registrationType === 'CHANNEL' ? (
                <Select value={registrationValue} onValueChange={setRegistrationValue}>
                  <SelectTrigger>
                    <SelectValue placeholder="Channel wählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        #{entry.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}

              {registrationType === 'URL' || registrationType === 'TEXT' ? (
                <Input
                  value={registrationValue}
                  maxLength={200}
                  onChange={(event) => setRegistrationValue(event.target.value)}
                  placeholder={registrationType === 'URL' ? 'https://…' : 'z.B. Meldung im Chat'}
                />
              ) : null}
              {errors.registrationValue ? (
                <p className="text-xs text-destructive">{errors.registrationValue}</p>
              ) : null}
            </div>
          </>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="comm-banner">Banner URL (optional)</Label>
          <Input
            id="comm-banner"
            value={bannerUrl}
            onChange={(event) => setBannerUrl(event.target.value)}
            placeholder="https://…"
          />
          {errors.bannerUrl ? <p className="text-xs text-destructive">{errors.bannerUrl}</p> : null}
        </div>

        {canMention ? (
          <div className="space-y-1.5">
            <Label htmlFor="comm-mention">Erwähnung</Label>
            <Select value={mention} onValueChange={setMention}>
              <SelectTrigger id="comm-mention">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={MENTION_NONE}>Keine</SelectItem>
                <SelectItem value="everyone" disabled={!allowEveryone}>
                  @everyone{allowEveryone ? '' : ' (in den Einstellungen deaktiviert)'}
                </SelectItem>
                <SelectItem value="here" disabled={!allowEveryone}>
                  @here{allowEveryone ? '' : ' (in den Einstellungen deaktiviert)'}
                </SelectItem>
                <SelectItem value="role">Bestimmte Rolle</SelectItem>
                <SelectItem value="user">Bestimmte Person</SelectItem>
              </SelectContent>
            </Select>

            {mention === 'role' ? (
              <Select value={mentionTarget} onValueChange={setMentionTarget}>
                <SelectTrigger>
                  <SelectValue placeholder="Rolle wählen" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2.5 rounded-full"
                          style={{ backgroundColor: role.color ?? '#99AAB5' }}
                        />
                        {role.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {mention === 'user' ? (
              <MemberPicker
                csrfToken={csrfToken}
                value={mentionUser}
                onChange={setMentionUser}
                label="Person wählen"
              />
            ) : null}
            {errors.mentionTarget ? <p className="text-xs text-destructive">{errors.mentionTarget}</p> : null}
          </div>
        ) : null}

        {channel && channel.missing.length > 0 ? (
          <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Dem Bot fehlen in #{channel.name}: {channel.missing.join(', ')}.
            </span>
          </p>
        ) : null}

        <Button onClick={handleContinue} disabled={pending || usable.length === 0}>
          <Send aria-hidden="true" />
          Weiter zur Bestätigung
        </Button>
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <EmbedPreview
          type={type}
          title={title}
          content={content}
          bannerUrl={bannerUrl.trim().startsWith('https://') ? bannerUrl.trim() : undefined}
          footerText={footerText}
          channelName={channel?.name ?? null}
          mentionLabel={mentionLabel}
          startsAt={startsAt}
          responsibleLabel={responsible?.displayName ?? currentUserName}
          location={location}
          registrationLabel={registrationLabel}
        />
      </div>

      <Dialog open={confirming} onOpenChange={(next) => (pending ? undefined : setConfirming(next))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nachricht wirklich senden?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm">
                <dl className="space-y-2">
                  <div className="flex items-center gap-2">
                    <dt className="w-24 text-muted-foreground">Channel</dt>
                    <dd className="font-medium text-foreground">#{channel?.name}</dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="w-24 text-muted-foreground">Typ</dt>
                    <dd className="font-medium text-foreground">
                      {type === 'NEWS' ? 'Neuigkeiten' : type === 'EVENT' ? 'Event' : 'Umfrage'}
                    </dd>
                  </div>
                  <div className="flex items-center gap-2">
                    <dt className="w-24 text-muted-foreground">Titel</dt>
                    <dd className="font-medium text-foreground">{title.trim()}</dd>
                  </div>
                  {mentionLabel ? (
                    <div className="flex items-center gap-2">
                      <dt className="w-24 text-muted-foreground">Erwähnung</dt>
                      <dd>
                        <Badge variant="warning">{mentionLabel}</Badge>
                      </dd>
                    </div>
                  ) : null}
                </dl>
                <p className="text-muted-foreground">
                  Die Nachricht erscheint sofort öffentlich auf Discord und wird im Audit Log protokolliert.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
              Abbrechen
            </Button>
            <Button onClick={() => void handleSend()} loading={pending}>
              <ExternalLink aria-hidden="true" />
              Nachricht senden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
