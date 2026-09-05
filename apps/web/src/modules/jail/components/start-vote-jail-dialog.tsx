'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Gavel } from 'lucide-react';
import { formatDuration } from '@swisshub/shared';
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
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import { searchVoteJailTargetsAction, startVoteJailAction } from '@/modules/jail/actions';
import { ZielUeberKennung } from '@/modules/jail/components/ziel-ueber-kennung';

/**
 * Abstimmung starten.
 *
 * Die Regeln (Stimmen, Laufzeit, Jail-Dauer) kommen aus den Moduleinstellungen
 * und werden hier nur angezeigt - entschieden wird serverseitig.
 */
export function StartVoteJailDialog({
  csrfToken,
  requiredVotes,
  durationSeconds,
  resultSeconds,
  channelName,
  disabled,
  darfSuchen,
}: {
  csrfToken: string;
  requiredVotes: number;
  durationSeconds: number;
  resultSeconds: number;
  channelName: string | null;
  disabled?: boolean;
  /**
   * Darf dieser Mensch nach Namen suchen?
   *
   * Eine Namenssuche beantwortet «wer ist alles da?», und die Antwort ist
   * eine Mitgliederliste. Wer sie ohnehin hat, sucht hier weiter; alle
   * anderen geben die Kennung ein, die sie ohnehin kennen. Serverseitig
   * entscheidet dasselbe noch einmal - hier steht nur, was gezeigt wird.
   */
  darfSuchen: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [member, setMember] = useState<PickedMember | null>(null);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setFieldError(null);
    if (!member) {
      setFieldError('Bitte ein Mitglied auswählen.');
      return;
    }
    setPending(true);
    const response = await startVoteJailAction({
      csrfToken,
      targetDiscordId: member.discordId,
      reason: reason.trim() === '' ? undefined : reason.trim(),
    });
    setPending(false);

    if (response.ok) {
      toast.success('Vote Jail wurde gestartet.', {
        description: `${response.data.requiredVotes} Stimmen nötig.`,
      });
      setOpen(false);
      setMember(null);
      setReason('');
      router.refresh();
    } else {
      toast.error(response.error.message);
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
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Gavel aria-hidden="true" />
          Vote Jail starten
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vote Jail starten</DialogTitle>
          <DialogDescription>
            Die Community stimmt {formatDuration(durationSeconds * 1000)} lang ab. Bei {requiredVotes} Stimmen
            wird das Mitglied {formatDuration(resultSeconds * 1000)} gejailt.
            {channelName ? ` Die Abstimmung erscheint in #${channelName}.` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {darfSuchen ? (
            /*
              Für das Team: eine eigene Suche statt der allgemeinen
              Mitgliedersuche. Sie zeigt ausschliesslich Mitglieder, gegen die
              eine Abstimmung überhaupt zulässig wäre - eine Liste mit Zielen,
              die beim Klick abgelehnt würden, wäre zugleich eine Auskunft
              darüber, wer geschützt ist.
            */
            <MemberPicker
              csrfToken={csrfToken}
              value={member}
              onChange={setMember}
              suche={searchVoteJailTargetsAction}
            />
          ) : (
            <ZielUeberKennung csrfToken={csrfToken} value={member} onChange={setMember} />
          )}

          <div className="space-y-2">
            <Label htmlFor="vote-reason">Grund (optional)</Label>
            <Textarea
              id="vote-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              placeholder="z.B. Provokation"
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
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Abbrechen
          </Button>
          <Button onClick={() => void submit()} loading={pending}>
            Abstimmung starten
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
