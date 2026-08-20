import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { hasSetupAccess } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Keine Berechtigung' };

export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ permission?: string }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  // Solange die Einrichtung läuft, ist der Weg zu den Berechtigungen der
  // Assistent - nicht "wende dich an einen Administrator".
  const setupAccess = await hasSetupAccess().catch(() => false);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <Card className="w-full max-w-lg text-center">
        <CardHeader className="items-center gap-3">
          <span className="rounded-full bg-warning/15 p-3 text-warning">
            <ShieldAlert className="size-6" aria-hidden="true" />
          </span>
          <CardTitle className="text-xl">Keine Berechtigung</CardTitle>
          <CardDescription>
            {setupAccess
              ? 'Die Einrichtung ist noch nicht abgeschlossen. Vergib im Einrichtungsassistenten zuerst die Dashboard-Berechtigungen.'
              : 'Dir fehlt die erforderliche Berechtigung für diesen Bereich. Wende dich an einen Administrator, wenn du Zugriff benötigst.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {params.permission ? (
            <p className="text-xs text-muted-foreground">
              Benötigte Berechtigung: <code className="font-mono">{params.permission}</code>
            </p>
          ) : null}
          {setupAccess ? (
            <Link href="/setup" className={cn(buttonVariants({ variant: 'default' }))}>
              Zur Einrichtung
            </Link>
          ) : (
            <Link href="/dashboard" className={cn(buttonVariants({ variant: 'default' }))}>
              Zurück zum Dashboard
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
