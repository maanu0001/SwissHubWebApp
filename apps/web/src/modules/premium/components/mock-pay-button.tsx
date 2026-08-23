'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

/** Loest die Testzahlung aus - nur mit aktivem Mock-Anbieter. */
export function MockPayButton({ subscriptionId }: { subscriptionId: string }): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function bezahlen(): Promise<void> {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/premium/mock-pay', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscriptionId }),
      });
      if (!response.ok) {
        throw new Error('Die Testzahlung ist fehlgeschlagen.');
      }
      router.push('/premium/erfolg');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unbekannter Fehler');
      setPending(false);
    }
  }

  return (
    <Button onClick={bezahlen} disabled={pending} className="w-full">
      {pending ? (
        <>
          <Loader2 className="animate-spin" aria-hidden="true" />
          Zahlung wird verarbeitet …
        </>
      ) : (
        'Testzahlung auslösen'
      )}
    </Button>
  );
}
