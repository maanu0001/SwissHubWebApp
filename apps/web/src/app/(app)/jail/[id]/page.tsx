import { permanentRedirect } from 'next/navigation';

/**
 * Ein einzelner Jail-Vorgang unter seiner alten Adresse.
 *
 * Genau diese Links stehen in Moderationsprotokollen und in der
 * Mitgliederakte - sie muessen weiter funktionieren, sonst fuehrt der Verlauf
 * eines Mitglieds ins Leere.
 */
export default async function JailVorgangUmleitung({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<never> {
  const { id } = await params;
  permanentRedirect(`/moderation/jail/${id}`);
}
