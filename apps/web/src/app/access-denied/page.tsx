import type { Metadata } from 'next';
import Link from 'next/link';
import { UserX } from 'lucide-react';
import { branding } from '@swisshub/config/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { branding as brandingModule } from '@swisshub/modules';
import { BrandMark } from '@/components/shared/brand-mark';
import { LogoutButton } from '@/components/layout/logout-button';
import { buttonVariants } from '@/components/ui/button';
import { getOptionalAuthContext, csrfTokenFor } from '@/server/auth';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Kein Zugriff' };

export default async function AccessDeniedPage(): Promise<React.JSX.Element> {
  const context = await getOptionalAuthContext();
  // Hochgeladenes Logo, sonst das mitgelieferte SwissHub-Logo.
  const logoUrl = await brandingModule.currentLogoUrl();

  /**
   * Der Weg zum Entbannungsantrag.
   *
   * Hier landet, wer nicht auf dem Server ist - und wer gebannt wurde, landet
   * genau hier. Ohne diesen Hinweis waere die Seite fuer ihn eine Sackgasse:
   * er hat eine gueltige Anmeldung und keinen Weg, sie zu nutzen.
   *
   * Der Hinweis erscheint nur bei angemeldeten Personen und nur, wenn das
   * Modul eingeschaltet ist. Ob jemand tatsaechlich gebannt ist, prueft die
   * Seite dahinter - hier waere die Auskunft an der falschen Stelle.
   */
  const { appeals, isModuleEnabled } = await import('@swisshub/modules');
  const appealsAn = context ? await isModuleEnabled(appeals.APPEALS_MODULE_ID).catch(() => false) : false;

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-16">
      <Card className="w-full max-w-lg">
        <CardHeader className="items-center gap-4 text-center">
          <BrandMark size={48} withWordmark={false} logoUrl={logoUrl} />
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
          {appealsAn ? (
            <div className="rounded-lg border border-border/60 bg-muted/30 p-4 text-left">
              <p className="mb-2 text-sm font-medium text-foreground">Wurdest du gebannt?</p>
              <p className="mb-3 text-sm">
                Dann kannst du eine erneute Prüfung beantragen. Der Antrag wird von Menschen gelesen.
              </p>
              <Link href="/entbannung" className={cn(buttonVariants({ variant: 'default', size: 'sm' }))}>
                Entbannungsantrag stellen
              </Link>
            </div>
          ) : null}
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
