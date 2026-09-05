'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { repairStuebliAction } from '@/modules/premium/actions';

/**
 * Repariert das Stuebli eines Mitglieds.
 *
 * "Reparieren" heisst hier: abgleichen. Der Abgleich stellt selbst fest, was
 * fehlt - Kanal, Kategorie oder Rechte - und legt genau das an. Ein eigener
 * "neu erstellen"-Knopf waere gefaehrlich: er wuerde einen zweiten Kanal
 * anlegen, wenn der erste in Wahrheit noch existiert.
 */
export function StuebliRepairButton({
  userId,
  csrfToken,
}: {
  userId: string;
  csrfToken: string;
}): React.JSX.Element {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function reparieren(): Promise<void> {
    if (pending) {
      return;
    }
    setPending(true);
    const response = await repairStuebliAction({ csrfToken, userId });

    if (response.ok && response.data.ok) {
      toast.success(
        response.data.kanalAngelegt
          ? 'Das Stübli wurde neu angelegt.'
          : response.data.kanalRepariert
            ? 'Kategorie und Rechte wurden wiederhergestellt.'
            : 'Alles in Ordnung - es gab nichts zu reparieren.',
      );
      router.refresh();
    } else {
      toast.error(
        response.ok ? (response.data.error ?? 'Die Reparatur ist fehlgeschlagen.') : response.error.message,
      );
    }
    setPending(false);
  }

  return (
    <Button variant="outline" size="sm" onClick={reparieren} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Wrench aria-hidden="true" />}
      Abgleichen
    </Button>
  );
}
