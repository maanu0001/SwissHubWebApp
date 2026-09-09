import type { Metadata } from 'next';
import { MitgliedsAkte } from '@/modules/members/components/mitglieds-akte';

export const metadata: Metadata = { title: 'Mitglied' };
export const dynamic = 'force-dynamic';

/**
 * Die Akte eines Mitglieds.
 *
 * Die Route reicht nur durch. Wer welchen Abschnitt sehen darf, entscheidet
 * der Aggregator in `getMemberCenterProfile` - und zwar serverseitig und
 * anhand der Sitzung, nicht anhand der Kennung in der Adresszeile. Wer ein
 * fremdes Profil ohne Berechtigung aufruft, bekommt dieselbe Antwort wie bei
 * einem unbekannten Mitglied.
 */
export default async function MemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ discordId: string }>;
  searchParams: Promise<{ tab?: string }>;
}): Promise<React.JSX.Element> {
  const { discordId } = await params;
  const { tab } = await searchParams;

  return <MitgliedsAkte discordId={discordId} tab={tab} basisPfad={`/members/${discordId}`} />;
}
