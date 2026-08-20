'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { sendOnboardingAction } from '@/modules/spielersuche/actions';

/**
 * Sendet die tägliche Hinweisnachricht sofort.
 *
 * Ersetzt `/testmessage` des alten Bots und verwendet denselben Dienst wie der
 * automatische Versand - die Vorschau daneben zeigt also wirklich das, was
 * ankommt.
 */
export function SendOnboardingButton({
  csrfToken,
  disabled,
}: {
  csrfToken: string;
  disabled?: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSend(): Promise<void> {
    setPending(true);
    const response = await sendOnboardingAction({ csrfToken });
    if (response.ok) {
      toast.success('Die Testnachricht wurde gesendet.');
      router.refresh();
    } else {
      toast.error(response.error.message);
    }
    setPending(false);
  }

  return (
    <Button loading={pending} disabled={disabled} onClick={() => void handleSend()}>
      <Send aria-hidden="true" />
      Testnachricht senden
    </Button>
  );
}
