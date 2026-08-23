'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Radio } from 'lucide-react';
import { startSessionAction } from '@/modules/music/actions';

/** Holt einen freien Musik-Bot in den eigenen Sprachkanal. */
export function StartSessionButton({
  csrfToken,
  deaktiviert,
}: {
  csrfToken: string;
  deaktiviert: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [, starteUebergang] = useTransition();

  async function starte(): Promise<void> {
    setPending(true);
    try {
      const antwort = await startSessionAction({ csrfToken });
      if (antwort.ok) {
        toast.success('Der Musik-Bot ist deinem Kanal beigetreten.');
        starteUebergang(() => router.refresh());
      } else {
        toast.error(antwort.error.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void starte()}
      disabled={pending || deaktiviert}
      className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-accent-gradient px-5 text-sm font-semibold text-primary-foreground shadow-[0_0_30px_-12px_hsl(var(--primary-bright))] transition-transform hover:scale-[1.02] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:scale-100 disabled:opacity-40 disabled:shadow-none"
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Radio className="size-4" aria-hidden="true" />
      )}
      Musik-Bot verbinden
    </button>
  );
}
