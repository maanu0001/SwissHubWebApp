'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmationDialog } from '@/components/shared/confirmation-dialog';
import { deleteCommunicationMessageAction } from '@/modules/communication/actions';

/**
 * Eine gesendete Nachricht auf Discord löschen.
 * Der Verlaufseintrag bleibt bestehen und wird als gelöscht markiert.
 */
export function DeleteMessageButton({
  csrfToken,
  id,
  title,
}: {
  csrfToken: string;
  id: string;
  title: string;
}): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function remove(): Promise<void> {
    setPending(true);
    const response = await deleteCommunicationMessageAction({ csrfToken, id });
    setPending(false);

    if (response.ok) {
      toast.success('Nachricht wurde auf Discord gelöscht.');
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={pending}>
        <Trash2 className="size-4" aria-hidden="true" />
        <span className="sr-only">Löschen</span>
      </Button>
      <ConfirmationDialog
        open={open}
        onOpenChange={setOpen}
        title="Nachricht auf Discord löschen?"
        description={`„${title}" wird auf Discord entfernt. Der Verlaufseintrag bleibt zur Nachvollziehbarkeit bestehen.`}
        confirmLabel="Löschen"
        destructive
        onConfirm={remove}
      />
    </>
  );
}
