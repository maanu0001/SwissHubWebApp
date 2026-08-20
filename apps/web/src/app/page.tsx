import { redirect } from 'next/navigation';
import { can } from '@swisshub/auth';
import { getOptionalAuthContext, hasSetupAccess } from '@/server/auth';

export default async function IndexPage(): Promise<never> {
  const context = await getOptionalAuthContext();
  if (!context) {
    redirect('/login');
  }
  if (!context.isMember) {
    redirect('/access-denied');
  }

  // Ohne Dashboard-Berechtigung, aber mit Erstzugang: direkt in die Einrichtung
  // statt auf eine 403-Seite - dort werden die Berechtigungen ja erst vergeben.
  if (!can(context, 'dashboard.view') && (await hasSetupAccess())) {
    redirect('/setup');
  }

  redirect('/dashboard');
}
