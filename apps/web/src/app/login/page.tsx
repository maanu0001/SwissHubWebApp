import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { branding as brandingModule } from '@swisshub/modules';
import { BrandMark } from '@/components/shared/brand-mark';
import { getOptionalAuthContext } from '@/server/auth';

export const metadata: Metadata = { title: 'Anmelden' };

const ERROR_MESSAGES: Record<string, string> = {
  denied: 'Die Anmeldung wurde auf Discord abgebrochen.',
  state: 'Die Sicherheitsprüfung der Anmeldung ist fehlgeschlagen. Bitte erneut versuchen.',
  oauth: 'Die Discord-Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.',
  rate_limit: 'Zu viele Anmeldeversuche. Bitte in einigen Minuten erneut versuchen.',
  configuration:
    'Die Anwendung ist noch nicht vollständig konfiguriert. Bitte an einen Administrator wenden.',
  blocked: 'Dieses Konto wurde für die WebApp gesperrt.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; logout?: string }>;
}): Promise<React.JSX.Element> {
  const context = await getOptionalAuthContext();
  if (context) {
    redirect(context.isMember ? '/dashboard' : '/access-denied');
  }

  // Logo aus der Branding-Konfiguration; ohne Upload greift das Standardlogo.
  const logoUrl = brandingModule.brandingLogoUrl(
    await brandingModule.getBrandingConfig(),
    branding.logo.mark,
  );

  const params = await searchParams;
  const errorMessage = params.error ? (ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.oauth) : null;

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="pointer-events-none absolute inset-0 bg-surface-gradient" aria-hidden="true" />
      <Card className="relative w-full max-w-md border-border/70 bg-card/90 backdrop-blur">
        <CardHeader className="items-center gap-4 text-center">
          <BrandMark size={56} withWordmark={false} logoUrl={logoUrl} />
          <div className="space-y-1">
            <CardTitle className="text-xl">{branding.name} Anmeldung</CardTitle>
            <CardDescription>{branding.description}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {params.logout ? (
            <p className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
              Du wurdest erfolgreich abgemeldet.
            </p>
          ) : null}

          {errorMessage ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {errorMessage}
            </p>
          ) : null}

          <Button asChild size="lg" className="w-full">
            <Link href="/api/auth/login" prefetch={false}>
              Mit Discord anmelden
            </Link>
          </Button>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            Der Zugriff ist ausschliesslich Mitgliedern des {branding.name} Discord-Servers vorbehalten. Deine
            Berechtigungen ergeben sich aus deinen Discord-Rollen.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
