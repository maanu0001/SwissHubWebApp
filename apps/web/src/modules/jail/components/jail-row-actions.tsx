'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, MoreVertical, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { releaseJailAction } from '@/modules/jail/actions';

interface JailRowActionsProps {
  csrfToken: string;
  jailId: string;
  memberLabel: string;
  /** Nur mit `jail.release` sichtbar - serverseitig zusätzlich geprüft. */
  canRelease: boolean;
}

/**
 * Zeilenmenü der Jail-Tabellen: Details ansehen und vorzeitig freilassen.
 * Die Freilassung erhält beim Öffnen einen Idempotency Key, damit ein
 * Doppelklick nachweislich nur eine Aktion auslöst.
 */
export function JailRowActions({
  csrfToken,
  jailId,
  memberLabel,
  canRelease,
}: JailRowActionsProps): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  async function handleConfirm(): Promise<void> {
    const key = idempotencyKey ?? crypto.randomUUID();
    const response = await releaseJailAction({ csrfToken, jailId, idempotencyKey: key });

    if (response.ok) {
      toast.success(`${memberLabel} wurde freigelassen.`, {
        description:
          response.data.failedRoles > 0
            ? `${response.data.restoredRoles} Rollen wiederhergestellt, ${response.data.failedRoles} nicht möglich.`
            : `${response.data.restoredRoles} Rollen wiederhergestellt.`,
      });
      for (const warning of response.data.warnings) {
        toast.warning(warning);
      }
      router.refresh();
    } else {
      toast.error(response.error.message);
      setIdempotencyKey(null);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Aktionen für ${memberLabel}`}>
            <MoreVertical aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/jail/${jailId}`}>
              <Eye aria-hidden="true" />
              Details
            </Link>
          </DropdownMenuItem>
          {canRelease ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setIdempotencyKey(crypto.randomUUID());
                  setOpen(true);
                }}
                className="text-destructive focus:text-destructive"
              >
                <Unlock aria-hidden="true" />
                Vorzeitig freilassen
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title="Benutzer wirklich freilassen?"
        confirmLabel="Freilassen"
        description={
          <>
            <p className="text-foreground">
              <strong>{memberLabel}</strong> wird sofort freigelassen. Die vorherigen Rollen werden - soweit
              zulässig - wiederhergestellt.
            </p>
            <p>Diese Aktion betrifft einen echten Discord-Benutzer und wird im Audit Log gespeichert.</p>
          </>
        }
        onConfirm={handleConfirm}
      />
    </>
  );
}
