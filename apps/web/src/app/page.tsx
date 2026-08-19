import { redirect } from 'next/navigation';
import { getOptionalAuthContext } from '@/server/auth';

export default async function IndexPage(): Promise<never> {
  const context = await getOptionalAuthContext();
  if (!context) {
    redirect('/login');
  }
  redirect(context.isMember ? '/dashboard' : '/access-denied');
}
