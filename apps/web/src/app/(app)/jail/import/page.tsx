import { permanentRedirect } from 'next/navigation';

/** Der Import steht jetzt im Moderationsbereich. */
export default function JailImportUmleitung(): never {
  permanentRedirect('/moderation/jail/import');
}
