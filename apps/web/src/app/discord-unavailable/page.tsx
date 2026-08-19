import type { Metadata } from 'next';
import Link from 'next/link';
import { PlugZap } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Discord nicht erreichbar' };

export default function DiscordUnavailablePage(): React.JSX.Element {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <Card className="w-full max-w-lg text-center">
        <CardHeader className="items-center gap-3">
          <span className="rounded-full bg-warning/15 p-3 text-warning">
            <PlugZap className="size-6" aria-hidden="true" />
          </span>
          <CardTitle className="text-xl">Discord derzeit nicht erreichbar</CardTitle>
          <CardDescription>
            Die Verbindung zu Discord ist momentan gestoert. Bereits gespeicherte Daten bleiben sichtbar,
            Discord-Aktionen sind voruebergehend nicht moeglich.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/dashboard" className={cn(buttonVariants({ variant: 'outline' }))}>
            Zurueck zum Dashboard
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
