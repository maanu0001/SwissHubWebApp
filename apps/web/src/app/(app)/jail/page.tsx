import { permanentRedirect } from 'next/navigation';

/**
 * Der alte Ort des Jail-Bereichs.
 *
 * Jail ist fachlich eine Moderationsmassnahme und steht jetzt dort, wo die
 * anderen auch stehen. Die alte Adresse verschwindet deswegen nicht: sie
 * steht in Lesezeichen, in alten Discord-Nachrichten und in Verweisen, die
 * niemand mehr findet. Ein 404 waere die schlechteste Antwort darauf.
 *
 * `permanentRedirect` statt `redirect`: die Verschiebung ist keine
 * voruebergehende. Wer den Link speichert, soll die neue Adresse speichern.
 */
export default function JailUmleitung(): never {
  permanentRedirect('/moderation/jail');
}
