'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Save, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import {
  addTrustedAction,
  removeTrustedAction,
  savePreferencesAction,
} from '@/modules/voice/actions';

/**
 * Die eigenen Voreinstellungen.
 *
 * Ausdrücklich freiwillig: ohne den Schalter wird nichts übernommen, auch
 * wenn etwas gespeichert ist. Eine Anwendung, die sich merkt, wie jemand
 * seinen Kanal nennt und wen er hereinlässt, soll das tun, weil er es will -
 * nicht, weil es technisch geht.
 */
export function PreferencesPanel({
  csrfToken,
  vorlieben,
  vertraute,
}: {
  csrfToken: string;
  vorlieben: {
    preferredName: string;
    preferredLimit: number | null;
    applyPreferences: boolean;
    autoAllowTrusted: boolean;
  };
  vertraute: Array<{ discordId: string; username: string | null }>;
}): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState(vorlieben.preferredName);
  const [limit, setLimit] = useState<string>(
    vorlieben.preferredLimit === null ? '' : String(vorlieben.preferredLimit),
  );
  const [uebernehmen, setUebernehmen] = useState(vorlieben.applyPreferences);
  const [vertrauteAn, setVertrauteAn] = useState(vorlieben.autoAllowTrusted);
  const [auswahl, setAuswahl] = useState<PickedMember | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);

  async function speichern(): Promise<void> {
    setLaeuft('save');
    const zahl = limit.trim() === '' ? null : Number.parseInt(limit, 10);
    const antwort = await savePreferencesAction({
      csrfToken,
      preferredName: name.trim() === '' ? null : name.trim(),
      preferredLimit: Number.isFinite(zahl) ? zahl : null,
      preferredBitrate: null,
      applyPreferences: uebernehmen,
      autoAllowTrusted: vertrauteAn,
    });
    if (antwort.ok) {
      toast.success('Gespeichert.');
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(null);
  }

  return (
    <section className="space-y-4 rounded-2xl border border-border p-5">
      <div>
        <h2 className="text-sm font-semibold">Deine Voreinstellungen</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Werden beim nächsten Talk übernommen - aber nur, wenn du den Schalter setzt.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pref-name">Bevorzugter Name</Label>
          <Input
            id="pref-name"
            maxLength={100}
            value={name}
            onChange={(ereignis) => setName(ereignis.target.value)}
            placeholder="Manuels Stübli"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pref-limit">Bevorzugtes Limit</Label>
          <Input
            id="pref-limit"
            type="number"
            min={0}
            max={99}
            value={limit}
            onChange={(ereignis) => setLimit(ereignis.target.value)}
            placeholder="Vorlage des Hubs"
          />
          <p className="text-xs text-muted-foreground">Leer = wie im Hub eingestellt.</p>
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Voreinstellungen übernehmen</p>
          <p className="text-xs text-muted-foreground">
            Ohne diesen Schalter bleibt oben stehen, was du eingibst - angewendet wird es nicht.
          </p>
        </div>
        <Switch
          checked={uebernehmen}
          onCheckedChange={setUebernehmen}
          aria-label="Voreinstellungen übernehmen"
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Vertrauenspersonen automatisch zulassen</p>
          <p className="text-xs text-muted-foreground">
            Sie kommen dann auch in einen gesperrten oder versteckten Talk.
          </p>
        </div>
        <Switch
          checked={vertrauteAn}
          onCheckedChange={setVertrauteAn}
          aria-label="Vertrauenspersonen automatisch zulassen"
        />
      </div>

      <Button disabled={laeuft !== null} onClick={() => void speichern()}>
        {laeuft === 'save' ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Save aria-hidden="true" />
        )}
        Speichern
      </Button>

      {/* --- Vertrauenspersonen ------------------------------------------ */}
      <div className="space-y-3 border-t border-border pt-4">
        <h3 className="text-sm font-medium">Vertrauenspersonen</h3>
        <MemberPicker
          csrfToken={csrfToken}
          value={auswahl}
          onChange={setAuswahl}
          label="Person hinzufügen"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={auswahl === null || laeuft !== null}
          onClick={async () => {
            if (!auswahl) {
              return;
            }
            setLaeuft('trust');
            const antwort = await addTrustedAction({
              csrfToken,
              discordId: auswahl.discordId,
              username: auswahl.username,
            });
            if (antwort.ok) {
              toast.success(`${auswahl.username} ist jetzt Vertrauensperson.`);
              setAuswahl(null);
              router.refresh();
            } else {
              toast.error(antwort.error.message);
            }
            setLaeuft(null);
          }}
        >
          {laeuft === 'trust' ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <UserPlus aria-hidden="true" />
          )}
          Hinzufügen
        </Button>

        {vertraute.length > 0 ? (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
            {vertraute.map((person) => (
              <li key={person.discordId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {person.username ?? person.discordId}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={laeuft !== null}
                  onClick={async () => {
                    setLaeuft(person.discordId);
                    const antwort = await removeTrustedAction({
                      csrfToken,
                      discordId: person.discordId,
                    });
                    if (antwort.ok) {
                      toast.success('Entfernt.');
                      router.refresh();
                    } else {
                      toast.error(antwort.error.message);
                    }
                    setLaeuft(null);
                  }}
                  aria-label={`${person.username ?? person.discordId} entfernen`}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            Noch niemand. Vertrauenspersonen kommen in jeden deiner Talks - auch in einen
            gesperrten.
          </p>
        )}
      </div>
    </section>
  );
}
