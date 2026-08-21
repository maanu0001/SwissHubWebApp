import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { branding as brandingModule } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BrandingForm } from '@/modules/settings/components/branding-form';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Branding' };
export const dynamic = 'force-dynamic';

/** Logo der WebApp verwalten. */
export default async function BrandingPage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('branding.manage');
  const config = await brandingModule.getBrandingConfig({ force: true });

  return (
    <Card>
      <CardHeader>
        <CardTitle>WebApp Logo</CardTitle>
        <CardDescription>
          Das Logo erscheint in der Seitenleiste, auf der Login-Seite und in den Kopfbereichen. Eine Änderung
          wirkt sofort - ein Neustart ist nicht nötig.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <BrandingForm
          csrfToken={csrfTokenFor(context)}
          currentLogoUrl={brandingModule.brandingLogoUrl(config)}
          hasCustomLogo={config.logoPath !== null}
          updatedAt={config.updatedAt ? formatDateTime(new Date(config.updatedAt)) : null}
          canManage={can(context, 'branding.manage')}
        />
      </CardContent>
    </Card>
  );
}
