'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { startCheckoutAction } from '@/modules/premium/actions';

/**
 * Startet den Checkout.
 *
 * Der Knopf sperrt sich beim ersten Klick und bleibt gesperrt, bis der Browser
 * die Seite verlässt. Ohne das entstünden bei einem Doppelklick zwei
 * Checkout-Sitzungen beim Zahlungsanbieter.
 */
export function CheckoutButton({
  slug,
  csrfToken,
  label,
}: {
  slug: string;
  csrfToken: string;
  label: string;
}): React.JSX.Element {
  const [pending, setPending] = useState(false);

  async function start(): Promise<void> {
    if (pending) {
      return;
    }
    setPending(true);
    const response = await startCheckoutAction({ csrfToken, slug });

    if (response.ok) {
      // Bewusst kein `setPending(false)`: der Browser wechselt jetzt zum
      // Zahlungsanbieter. Ein wieder freigegebener Knopf lüde nur zum
      // zweiten Klick ein.
      window.location.assign(response.data.url);
      return;
    }

    toast.error(response.error.message);
    setPending(false);
  }

  return (
    <Button onClick={start} disabled={pending} className="w-full">
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          Checkout wird vorbereitet …
        </>
      ) : (
        label
      )}
    </Button>
  );
}
