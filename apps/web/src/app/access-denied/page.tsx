import type { Metadata } from 'next';
import { UserX } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BrandMark } from '@/components/shared/brand-mark';
import { LogoutButton } from '@/components/layout/logout-button';
import { getOptionalAuthContext, csrfTokenFor } from '@/server/auth';

export const metadata: Metadata = { title: 'Kein Zugriff' };

export default async function AccessDeniedPage(): Promise<React.JSX.Element> {
  const context = await getOptionalAuthContext();

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <Card className="w-full max-w-lg">
        <CardHeader className="items-center gap-4 text-center">
          <BrandMark size={48} withWordmark={false} />
          <span className="rounded-full bg-warning/15 p-3 text-warning">
            <UserX className="size-6" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <CardTitle className="text-xl">Kein Zugriff auf {branding.name}</CardTitle>
            <CardDescription>
              Du bist derzeit kein Mitglied des {branding.name} Discord-Servers. Die WebApp steht
              ausschliesslich Mitgliedern zur Verfügung.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-center text-sm text-muted-foreground">
          <p>
            Tritt dem Discord-Server bei und melde dich anschliessend erneut an. Falls du sicher bist, dass du
            Mitglied bist, warte einen Moment - die Mitgliedschaft wird regelmässig neu geprüft.
          </p>
          {context ? (
            <div className="flex justify-center">
              <LogoutButton csrfToken={csrfTokenFor(context)} variant="outline" />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
