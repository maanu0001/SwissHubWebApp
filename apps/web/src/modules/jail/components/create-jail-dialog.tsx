'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { formatDateTime, formatDuration } from '@swisshub/shared';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/input';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import { createJailAction } from '@/modules/jail/actions';

interface CreateJailDialogProps {
  csrfToken: string;
  durationPresets: ReadonlyArray<{ label: string; seconds: number }>;
  maxDurationSeconds: number;
  /** Vorausgewaehltes Mitglied (z.B. aus dem Mitgliederprofil). */
  presetMember?: PickedMember;
  triggerLabel?: string;
}

const CUSTOM = 'custom';

/**
 * Jail-Maske inklusive Bestaetigungsschritt.
 *
 * Der Idempotency Key wird beim Oeffnen der Bestaetigung erzeugt: ein
 * Doppelklick auf "Jail bestaetigen" fuehrt dadurch nachweislich nur eine
 * Aktion aus.
 */
export function CreateJailDialog({
  csrfToken,
  durationPresets,
  maxDurationSeconds,
  presetMember,
  triggerLabel = 'Jail erstellen',
}: CreateJailDialogProps): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [member, setMember] = useState<PickedMember | null>(presetMember ?? null);
  const [preset, setPreset] = useState<string>(String(durationPresets[3]?.seconds ?? 3600));
  const [customMinutes, setCustomMinutes] = useState('90');
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const durationSeconds = useMemo(() => {
    if (preset !== CUSTOM) {
      return Number(preset);
    }
    const minutes = Number(customMinutes);
    return Number.isFinite(minutes) ? Math.round(minutes * 60) : 0;
  }, [preset, customMinutes]);

  const endsAt = useMemo(() => new Date(Date.now() + durationSeconds * 1000), [durationSeconds]);

  function reset(): void {
    setConfirming(false);
    setPending(false);
    setMember(presetMember ?? null);
    setReason('');
    setIdempotencyKey(null);
    setFieldError(null);
  }

  function handleContinue(): void {
    setFieldError(null);
    if (!member) {
      setFieldError('Bitte ein Mitglied auswaehlen.');
      return;
    }
    if (reason.trim().length < 3) {
      setFieldError('Bitte einen Grund mit mindestens 3 Zeichen angeben.');
      return;
    }
    if (durationSeconds < 60) {
      setFieldError('Die Mindestdauer betraegt 1 Minute.');
      return;
    }
    if (durationSeconds > maxDurationSeconds) {
      setFieldError(`Die maximale Dauer betraegt ${formatDuration(maxDurationSeconds * 1000)}.`);
      return;
    }
    setIdempotencyKey(crypto.randomUUID());
    setConfirming(true);
  }

  async function handleConfirm(): Promise<void> {
    if (!member || !idempotencyKey || pending) {
      return;
    }
    setPending(true);
    const response = await createJailAction({
      csrfToken,
      targetDiscordId: member.discordId,
      durationSeconds,
      reason: reason.trim(),
      idempotencyKey,
    });

    if (response.ok) {
      if (response.data.duplicate) {
        toast.info('Diese Aktion wurde bereits ausgefuehrt.');
      } else {
        toast.success(`${member.displayName} wurde erfolgreich gejailt.`, {
          description: `Ende: ${formatDateTime(response.data.endsAt)}`,
        });
      }
      for (const warning of response.data.warnings) {
        toast.warning(warning);
      }
      setOpen(false);
      reset();
      router.refresh();
    } else {
      toast.error(response.error.message);
      setPending(false);
      setConfirming(false);
      // Neuer Schluessel fuer den naechsten Versuch.
      setIdempotencyKey(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) {
          return;
        }
        setOpen(next);
        if (!next) {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Lock aria-hidden="true" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        {confirming && member ? (
          <>
            <DialogHeader>
              <DialogTitle>Jail bestaetigen</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-3 text-sm">
                  <p className="text-foreground">
                    Du bist dabei, <strong>@{member.username}</strong> fuer{' '}
                    <strong>{formatDuration(durationSeconds * 1000)}</strong> zu jailen.
                  </p>
                  <div className="rounded-md border border-border bg-secondary/40 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Grund</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{reason.trim()}</p>
                  </div>
                  <p className="text-muted-foreground">Ende: {formatDateTime(endsAt)}</p>
                  <p className="text-muted-foreground">
                    Diese Aktion betrifft einen echten Discord-Benutzer und wird im Audit Log gespeichert.
                  </p>
                </div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
                Abbrechen
              </Button>
              <Button onClick={() => void handleConfirm()} loading={pending}>
                Jail bestaetigen
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Mitglied jailen</DialogTitle>
              <DialogDescription>
                Die Rollen des Mitglieds werden gesichert und nach Ablauf automatisch wiederhergestellt.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {presetMember ? null : (
                <MemberPicker csrfToken={csrfToken} value={member} onChange={setMember} />
              )}

              <div className="space-y-2">
                <Label htmlFor="jail-duration">Dauer</Label>
                <Select value={preset} onValueChange={setPreset}>
                  <SelectTrigger id="jail-duration">
                    <SelectValue placeholder="Dauer waehlen" />
                  </SelectTrigger>
                  <SelectContent>
                    {durationPresets
                      .filter((entry) => entry.seconds <= maxDurationSeconds)
                      .map((entry) => (
                        <SelectItem key={entry.seconds} value={String(entry.seconds)}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    <SelectItem value={CUSTOM}>Benutzerdefiniert</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {preset === CUSTOM ? (
                <div className="space-y-2">
                  <Label htmlFor="jail-custom">Dauer in Minuten</Label>
                  <Input
                    id="jail-custom"
                    type="number"
                    min={1}
                    max={Math.floor(maxDurationSeconds / 60)}
                    value={customMinutes}
                    onChange={(event) => setCustomMinutes(event.target.value)}
                  />
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="jail-reason">Grund</Label>
                <Textarea
                  id="jail-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={500}
                  placeholder="z.B. Spam im Chat"
                />
                <p className="text-xs text-muted-foreground">{reason.length}/500 Zeichen</p>
              </div>

              {fieldError ? (
                <p role="alert" className="text-sm text-destructive">
                  {fieldError}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Abbrechen
              </Button>
              <Button onClick={handleContinue}>Weiter</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
