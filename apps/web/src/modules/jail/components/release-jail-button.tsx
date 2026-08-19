'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { releaseJailAction } from '@/modules/jail/actions';

interface ReleaseJailButtonProps {
  csrfToken: string;
  jailId: string;
  memberLabel: string;
  size?: 'sm' | 'default';
  variant?: 'outline' | 'default' | 'ghost';
}

/** Vorzeitige Freilassung inklusive Bestaetigung und Idempotency Key. */
export function ReleaseJailButton({
  csrfToken,
  jailId,
  memberLabel,
  size = 'sm',
  variant = 'outline',
}: ReleaseJailButtonProps): React.JSX.Element {
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
            ? `${response.data.restoredRoles} Rollen wiederhergestellt, ${response.data.failedRoles} nicht moeglich.`
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
      <Button
        variant={variant}
        size={size}
        onClick={() => {
          setIdempotencyKey(crypto.randomUUID());
          setOpen(true);
        }}
      >
        <Unlock aria-hidden="true" />
        Vorzeitig freilassen
      </Button>
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
              zulaessig - wiederhergestellt.
            </p>
            <p>Diese Aktion betrifft einen echten Discord-Benutzer und wird im Audit Log gespeichert.</p>
          </>
        }
        onConfirm={handleConfirm}
      />
    </>
  );
}
