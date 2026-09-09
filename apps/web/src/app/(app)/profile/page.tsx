import type { Metadata } from 'next';
import { MitgliedsAkte } from '@/modules/members/components/mitglieds-akte';
import { requireMember } from '@/server/auth';

export const metadata: Metadata = { title: 'Mein Profil' };
export const dynamic = 'force-dynamic';

/**
 * Das eigene Profil.
 *
 * Eine eigene Adresse, aber keine zweite Darstellung: gerendert wird dieselbe
 * Komponente wie unter `/members/<id>`. Eine zweite Seite mit denselben
 * Abschnitten waere ein zweiter Ort, an dem Berechtigungen richtig stehen
 * muessten - und irgendwann stuende an einem der beiden etwas anderes.
 *
 * Frueher war das hier eine Weiterleitung auf `/members/<eigene-id>`. Das
 * hatte zwei Folgen, die beide erst im Betrieb auffielen: die Seitenleiste
 * markierte «Mitglieder» als aktiv - einen Eintrag, den ein gewoehnliches
 * Mitglied gar nicht sieht -, und wer den Mitgliederbereich nicht sehen darf,
 * landete auf einer Adresse, die nach fremdem Bereich aussieht.
 *
 * **Die Kennung kommt aus der Sitzung**, nie aus der Adresszeile. Das ist der
 * Unterschied zwischen Selbstauskunft und Mitgliederzugriff: hier gibt es kein
 * Ziel, das sich manipulieren liesse.
 */
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}): Promise<React.JSX.Element> {
  const context = await requireMember();
  const { tab } = await searchParams;

  return <MitgliedsAkte discordId={context.user.discordId} tab={tab} basisPfad="/profile" />;
}
