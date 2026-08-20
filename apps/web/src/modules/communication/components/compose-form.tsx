'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { AlertTriangle, ExternalLink, Send } from 'lucide-react';
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
}

const MENTION_NONE = 'none';

export function ComposeForm({
  csrfToken,
  type,
  channels,
  roles,
  defaultChannelId,
  footerText,
  canMention,
  allowEveryone,
  template,
}: {
  csrfToken: string;
  type: PreviewType;
  channels: ChannelChoice[];
  roles: RoleChoice[];
  defaultChannelId: string | null;
  footerText: string;
  canMention: boolean;
  allowEveryone: boolean;
  template?: { title: string; content: string; bannerUrl: string | null } | null;
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
  const [mention, setMention] = useState<string>(MENTION_NONE);
  const [mentionRoleId, setMentionRoleId] = useState<string>('');
  const [startsAtLocal, setStartsAtLocal] = useState('');
  const [responsible, setResponsible] = useState<PickedMember | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const channel = channels.find((entry) => entry.id === channelId) ?? null;
  const startsAt = useMemo(() => (startsAtLocal ? new Date(startsAtLocal) : null), [startsAtLocal]);

  const mentionLabel =
    mention === MENTION_NONE
      ? null
      : mention === 'role'
        ? `@${roles.find((role) => role.id === mentionRoleId)?.name ?? 'Rolle'}`
        : `@${mention}`;

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
    if (mention === 'role' && !mentionRoleId) {
      next.mentionRoleId = 'Bitte eine Rolle wählen.';
    }
    if (type === 'EVENT' && !startsAt) {
      next.startsAt = 'Bitte Datum und Uhrzeit wählen.';
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
      mentionRoleId: mention === 'role' ? mentionRoleId : undefined,
      idempotencyKey,
    };

    const response =
      type === 'NEWS'
        ? await sendNewsAction(base)
        : type === 'POLL'
          ? await sendPollAction(base)
          : await sendEventAction({
              ...base,
              // Der Server erwartet UTC; der Picker liefert lokale Zeit.
              startsAt: startsAt ? startsAt.toISOString() : '',
              responsibleDiscordId: responsible?.discordId,
            });

    setPending(false);
    setConfirming(false);

    if (response.ok) {
      for (const warning of response.data.warnings) {
        toast.warning(warning);
      }
      toast.success(
        type === 'NEWS'
          ? 'Neuigkeiten wurden gesendet.'
          : type === 'EVENT'
            ? 'Event wurde gesendet.'
            : 'Umfrage wurde gesendet.',
      );
      setTitle('');
      setContent('');
      setBannerUrl('');
      setIdempotencyKey(null);
      router.refresh();
    } else {
      const fieldErrors = response.error.details?.fieldErrors;
      if (typeof fieldErrors === 'object' && fieldErrors !== null) {
        setErrors(fieldErrors as Record<string, string>);
      }
      toast.error(response.error.message);
      setIdempotencyKey(null);
    }
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
            maxLength={256}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={type === 'EVENT' ? 'z.B. SwissHub Movie Night' : 'z.B. Server Update'}
          />
          {errors.title ? <p className="text-xs text-destructive">{errors.title}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="comm-content">Text</Label>
          <Textarea
            id="comm-content"
            value={content}
            maxLength={3000}
            rows={8}
            onChange={(event) => setContent(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">{content.length}/3000 Zeichen</p>
          {errors.content ? <p className="text-xs text-destructive">{errors.content}</p> : null}
        </div>

        {type === 'EVENT' ? (
          <>
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
              </SelectContent>
            </Select>

            {mention === 'role' ? (
              <Select value={mentionRoleId} onValueChange={setMentionRoleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Rolle wählen" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {errors.mentionRoleId ? <p className="text-xs text-destructive">{errors.mentionRoleId}</p> : null}
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
          responsibleLabel={responsible?.displayName ?? null}
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
