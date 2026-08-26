'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/input';
import { unbanMemberAction } from '@/modules/moderation/actions';

/**
 * Bann aufheben - mit Grund.
 *
 * Auch das Aufheben braucht eine Begründung: in einem halben Jahr ist die
 * Frage «warum ist der wieder da» genauso berechtigt wie «warum ist der weg».
 */
export function UnbanButton({
  csrfToken,
  discordId,
  username,
}: {
  csrfToken: string;
  discordId: string;
  username: string;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    if (pending) {
      return;
    }
    if (reason.trim().length < 3) {
      setFieldError('Bitte einen Grund mit mindestens 3 Zeichen angeben.');
      return;
    }
    setPending(true);
    const antwort = await unbanMemberAction({ csrfToken, discordId, reason: reason.trim() });
    if (antwort.ok) {
      toast.success(`Bann für ${username} aufgehoben.`);
      setOpen(false);
      setReason('');
      setPending(false);
      router.refresh();
    } else {
      toast.error(antwort.error.message);
      setPending(false);
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
          setReason('');
          setFieldError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShieldCheck aria-hidden="true" />
          Entbannen
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bann aufheben</DialogTitle>
          <DialogDescription>
            <strong>{username}</strong> kann dem Server danach wieder beitreten. Eine Einladung wird nicht
            verschickt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor={`unban-reason-${discordId}`}>Grund</Label>
          <Textarea
            id={`unban-reason-${discordId}`}
            value={reason}
            maxLength={400}
            onChange={(event) => setReason(event.target.value)}
            placeholder="z.B. Einspruch angenommen"
          />
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
          <Button onClick={() => void handleConfirm()} loading={pending}>
            Bann aufheben
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
