'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Save, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { DiscordAvatar } from '@/components/shared/discord-avatar';
import { MemberPicker, type PickedMember } from '@/modules/members/components/member-picker';
import { setStaffAction } from '@/modules/tournaments/admin-actions';

export type StaffRolle = 'OWNER' | 'ADMIN' | 'REFEREE' | 'CASTER' | 'OBSERVER';

export interface StaffEintrag {
  discordId: string;
  username: string;
  role: StaffRolle;
}

const ROLLEN: Array<{ wert: StaffRolle; label: string; hinweis: string }> = [
  { wert: 'OWNER', label: 'Turnierleitung', hinweis: 'Alles, inklusive Leitung zuteilen.' },
  { wert: 'ADMIN', label: 'Administration', hinweis: 'Alles ausser die Leitung zu ändern.' },
  { wert: 'REFEREE', label: 'Schiedsrichter', hinweis: 'Check-in, Matches, Resultate, Einsprüche.' },
  { wert: 'CASTER', label: 'Caster', hinweis: 'Teilnehmerliste ansehen, Stream verwalten.' },
  { wert: 'OBSERVER', label: 'Beobachter', hinweis: 'Nur ansehen.' },
];

/**
 * Wer dieses Turnier betreut.
 *
 * Die Rolle hier begrenzt, was jemand darf - sie erlaubt nichts, was das
 * zentrale Rechtesystem nicht ohnehin vergeben hat. Ein Schiedsrichter ohne
 * die Berechtigung «Resultate korrigieren» kann auch hier keine korrigieren.
 * Deshalb ist diese Liste eine Zuständigkeit, keine Rechtevergabe.
 *
 * Mindestens ein Eintrag muss bleiben: ein Turnier ohne Leitung wäre eines,
 * das niemand mehr öffnen kann.
 */
export function StaffAdmin({
  tournamentId,
  csrfToken,
  staff: anfang,
  darfVerwalten,
}: {
  tournamentId: string;
  csrfToken: string;
  staff: StaffEintrag[];
  darfVerwalten: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [staff, setStaff] = useState(anfang);
  const [auswahl, setAuswahl] = useState<PickedMember | null>(null);
  const [rolle, setRolle] = useState<StaffRolle>('REFEREE');
  const [laeuft, setLaeuft] = useState(false);

  function hinzufuegen(): void {
    if (!auswahl) {
      return;
    }
    if (staff.some((eintrag) => eintrag.discordId === auswahl.discordId)) {
      toast.error('Diese Person ist bereits eingetragen.');
      return;
    }
    setStaff([...staff, { discordId: auswahl.discordId, username: auswahl.username, role: rolle }]);
    setAuswahl(null);
  }

  async function speichern(): Promise<void> {
    if (staff.length === 0) {
      toast.error('Mindestens eine Person muss eingetragen bleiben.');
      return;
    }
    setLaeuft(true);
    const antwort = await setStaffAction({ csrfToken, tournamentId, staff });
    if (antwort.ok) {
      toast.success('Turnierleitung gespeichert.');
      router.refresh();
    } else {
      toast.error(antwort.error.message);
    }
    setLaeuft(false);
  }

  return (
    <div className="space-y-5">
      {darfVerwalten ? (
        <form
          className="space-y-3 rounded-xl border border-border/60 p-4"
          onSubmit={(ereignis) => {
            ereignis.preventDefault();
            hinzufuegen();
          }}
        >
          <MemberPicker
            csrfToken={csrfToken}
            value={auswahl}
            onChange={setAuswahl}
            label="Person hinzufügen"
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="staff-rolle">Rolle</Label>
              <select
                id="staff-rolle"
                value={rolle}
                onChange={(e) => setRolle(e.target.value as StaffRolle)}
                className="h-10 rounded-lg border border-border bg-card px-3 text-sm"
              >
                {ROLLEN.map((eintrag) => (
                  <option key={eintrag.wert} value={eintrag.wert}>
                    {eintrag.label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="outline" disabled={auswahl === null}>
              <UserPlus aria-hidden="true" />
              Übernehmen
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {ROLLEN.find((eintrag) => eintrag.wert === rolle)?.hinweis}
          </p>
        </form>
      ) : null}

      <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border">
        {staff.map((eintrag) => (
          <li key={eintrag.discordId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <DiscordAvatar
              discordId={eintrag.discordId}
              name={eintrag.username}
              size={32}
              className="shrink-0"
            />
            <span className="min-w-0 flex-1 basis-40 truncate font-medium">{eintrag.username}</span>

            {darfVerwalten ? (
              <select
                value={eintrag.role}
                onChange={(e) =>
                  setStaff(
                    staff.map((andere) =>
                      andere.discordId === eintrag.discordId
                        ? { ...andere, role: e.target.value as StaffRolle }
                        : andere,
                    ),
                  )
                }
                aria-label={`Rolle von ${eintrag.username}`}
                className="h-9 rounded-lg border border-border bg-card px-2 text-sm"
              >
                {ROLLEN.map((option) => (
                  <option key={option.wert} value={option.wert}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-muted-foreground">
                {ROLLEN.find((option) => option.wert === eintrag.role)?.label ?? eintrag.role}
              </span>
            )}

            {darfVerwalten ? (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={staff.length === 1}
                title={staff.length === 1 ? 'Ein Turnier braucht mindestens eine Leitung.' : undefined}
                onClick={() => setStaff(staff.filter((andere) => andere.discordId !== eintrag.discordId))}
                aria-label={`${eintrag.username} entfernen`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {darfVerwalten ? (
        <div className="flex items-center gap-3">
          <Button disabled={laeuft} onClick={() => void speichern()}>
            {laeuft ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
            Speichern
          </Button>
          <p className="text-xs text-muted-foreground">Änderungen gelten erst nach dem Speichern.</p>
        </div>
      ) : null}
    </div>
  );
}
