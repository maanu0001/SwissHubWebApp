import { redirect } from 'next/navigation';
import { requireMember } from '@/server/auth';

/**
 * Das eigene Profil.
 *
 * Nur eine Weiterleitung: es gibt eine Mitgliederakte, und die eigene ist
 * keine andere. Eine zweite Seite mit denselben Abschnitten waere ein zweiter
 * Ort, an dem man Berechtigungen richtig hinschreiben muesste - und irgendwann
 * stuende an einem der beiden etwas anderes.
 *
 * Was jemand auf der eigenen Akte sieht, entscheidet derselbe Aggregator: die
 * Abschnitte mit Geltungsbereich `own` oeffnen sich hier von selbst, weil das
 * Ziel der Betrachter ist.
 */
export const dynamic = 'force-dynamic';

export default async function ProfilePage(): Promise<never> {
  const context = await requireMember();
  redirect(`/members/${context.user.discordId}`);
}
