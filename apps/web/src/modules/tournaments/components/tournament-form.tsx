'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ChannelSelect } from '@/modules/configuration/components/channel-select';
import { MultiSelect } from '@/modules/configuration/components/multi-select';
import { RoleSelect } from '@/modules/configuration/components/role-select';
import type {
  ChannelOption,
  RoleOption,
} from '@/modules/configuration/components/discord-option-types';
import {
  createTournamentAction,
  updateTournamentAction,
} from '@/modules/tournaments/admin-actions';
import { FORMAT_LABEL } from './tournament-badges';

const MODI = [
  { wert: 'TEAM', label: 'Team' },
  { wert: 'SOLO', label: 'Einzel' },
] as const;

const ZUGANG = [
  { wert: 'OPEN', label: 'Offen', hinweis: 'Jeder Berechtigte meldet sich direkt an.' },
  { wert: 'APPROVAL', label: 'Mit Freigabe', hinweis: 'Die Leitung bestätigt jede Anmeldung.' },
  { wert: 'INVITE_ONLY', label: 'Nur auf Einladung', hinweis: 'Nur die Leitung trägt Teilnehmer ein.' },
] as const;

const FORMATE = [
  'SINGLE_ELIMINATION',
  'DOUBLE_ELIMINATION',
  'ROUND_ROBIN',
  'SWISS',
  'GROUPS_THEN_ELIMINATION',
] as const;

const SETZUNG = [
  { wert: 'RANDOM', label: 'Zufällig' },
  { wert: 'MANUAL', label: 'Von Hand' },
  { wert: 'REGISTRATION_ORDER', label: 'Reihenfolge der Anmeldung' },
  { wert: 'RATING', label: 'Nach Wertung' },
] as const;

const TIEBREAKER = [
  { wert: 'HEAD_TO_HEAD', label: 'Direkter Vergleich' },
  { wert: 'SCORE_DIFFERENCE', label: 'Punktedifferenz' },
  { wert: 'SCORE_FOR', label: 'Erzielte Punkte' },
  { wert: 'WINS', label: 'Siege' },
  { wert: 'BUCHHOLZ', label: 'Buchholz' },
] as const;

export interface TurnierFormWerte {
  name: string;
  slug: string;
  gameName: string;
  gameId: string | null;
  description: string;
  rules: string;
  mode: 'SOLO' | 'TEAM';
  access: 'OPEN' | 'APPROVAL' | 'INVITE_ONLY';
  format: (typeof FORMATE)[number];
  seeding: 'RANDOM' | 'MANUAL' | 'REGISTRATION_ORDER' | 'RATING';
  minTeamSize: number;
  maxTeamSize: number;
  maxSubstitutes: number;
  maxParticipants: number;
  minParticipants: number;
  registrationOpensAt: string;
  registrationClosesAt: string;
  checkinOpensAt: string;
  checkinClosesAt: string;
  rosterLockAt: string;
  startsAt: string;
  estimatedEndAt: string;
  checkinRequired: boolean;
  autoRemoveMissedCheckin: boolean;
  groupCount: number;
  advancePerGroup: number;
  swissRounds: number;
  pointsPerWin: number;
  pointsPerDraw: number;
  pointsPerLoss: number;
  tiebreakers: string[];
  defaultBestOf: number;
  mapPool: string;
  serverRegion: string;
  bannerUrl: string;
  logoUrl: string;
  announcementChannelId: string;
  matchCategoryId: string;
  staffCategoryId: string;
  streamChannelId: string;
  pingRoleIds: string[];
  matchChannelRetentionHours: number;
  createMatchChannels: boolean;
  twitchUrl: string;
  youtubeUrl: string;
  streamUrl: string;
  requiredRoleId: string;
  minLevel: number;
  requiresPremium: boolean;
}

export const LEERE_WERTE: TurnierFormWerte = {
  name: '',
  slug: '',
  gameName: '',
  gameId: null,
  description: '',
  rules: '',
  mode: 'TEAM',
  access: 'OPEN',
  format: 'SINGLE_ELIMINATION',
  seeding: 'RANDOM',
  minTeamSize: 1,
  maxTeamSize: 5,
  maxSubstitutes: 0,
  maxParticipants: 0,
  minParticipants: 2,
  registrationOpensAt: '',
  registrationClosesAt: '',
  checkinOpensAt: '',
  checkinClosesAt: '',
  rosterLockAt: '',
  startsAt: '',
  estimatedEndAt: '',
  checkinRequired: true,
  autoRemoveMissedCheckin: false,
  groupCount: 0,
  advancePerGroup: 2,
  swissRounds: 0,
  pointsPerWin: 3,
  pointsPerDraw: 1,
  pointsPerLoss: 0,
  tiebreakers: [],
  defaultBestOf: 1,
  mapPool: '',
  serverRegion: '',
  bannerUrl: '',
  logoUrl: '',
  announcementChannelId: '',
  matchCategoryId: '',
  staffCategoryId: '',
  streamChannelId: '',
  pingRoleIds: [],
  matchChannelRetentionHours: 0,
  createMatchChannels: true,
  twitchUrl: '',
  youtubeUrl: '',
  streamUrl: '',
  requiredRoleId: '',
  minLevel: 0,
  requiresPremium: false,
};

/** Ein leeres Feld heisst «nicht gesetzt», nicht «leerer Text». */
function textOderNull(wert: string): string | null {
  const geputzt = wert.trim();
  return geputzt === '' ? null : geputzt;
}

/**
 * Ein Zeitpunkt aus dem Formular.
 *
 * `datetime-local` liefert Ortszeit ohne Zone. `new Date(...)` legt die Zone
 * des Browsers zugrunde - genau das, was jemand meint, der «20:00» eintippt.
 */
function zeitOderNull(wert: string): string | null {
  if (wert.trim() === '') {
    return null;
  }
  const zeitpunkt = new Date(wert);
  return Number.isNaN(zeitpunkt.getTime()) ? null : zeitpunkt.toISOString();
}

/**
 * Das Turnierformular - dasselbe zum Anlegen und zum Bearbeiten.
 *
 * Bewusst ein Formular statt eines Assistenten: wer ein Turnier zum dritten
 * Mal ansetzt, will nicht durch sieben Schritte klicken, und wer es bearbeitet,
 * sucht ein einzelnes Feld.
 *
 * Was hier steht, ist ein Vorschlag an den Server. Geprüft wird dort - jede
 * Zahl, jede Frist und jede Berechtigung.
 */
export function TournamentForm({
  csrfToken,
  tournamentId,
  werte: anfang,
  spiele,
  roles,
  channels,
}: {
  csrfToken: string;
  /** Gesetzt beim Bearbeiten; ohne wird ein neues Turnier angelegt. */
  tournamentId?: string;
  werte: TurnierFormWerte;
  spiele: Array<{ id: string; name: string }>;
  roles: RoleOption[];
  channels: ChannelOption[];
}): React.JSX.Element {
  const router = useRouter();
  const [werte, setWerte] = useState<TurnierFormWerte>(anfang);
  const [laeuft, setLaeuft] = useState(false);

  function setze<K extends keyof TurnierFormWerte>(feld: K, wert: TurnierFormWerte[K]): void {
    setWerte((vorher) => ({ ...vorher, [feld]: wert }));
  }

  const kategorien = channels.filter((kanal) => kanal.kind === 'GUILD_CATEGORY');
  const textkanaele = channels.filter((kanal) => kanal.kind === 'GUILD_TEXT');

  async function absenden(ereignis: React.FormEvent): Promise<void> {
    ereignis.preventDefault();
    setLaeuft(true);

    const eingabe = {
      csrfToken,
      name: werte.name.trim(),
      ...(werte.slug.trim() !== '' ? { slug: werte.slug.trim() } : {}),
      gameName: werte.gameName.trim(),
      gameId: werte.gameId,
      description: textOderNull(werte.description),
      rules: textOderNull(werte.rules),
      mode: werte.mode,
      access: werte.access,
      format: werte.format,
      seeding: werte.seeding,
      minTeamSize: werte.minTeamSize,
      maxTeamSize: werte.maxTeamSize,
      maxSubstitutes: werte.maxSubstitutes,
      maxParticipants: werte.maxParticipants,
      minParticipants: werte.minParticipants,
      registrationOpensAt: zeitOderNull(werte.registrationOpensAt),
      registrationClosesAt: zeitOderNull(werte.registrationClosesAt),
      checkinOpensAt: zeitOderNull(werte.checkinOpensAt),
      checkinClosesAt: zeitOderNull(werte.checkinClosesAt),
      rosterLockAt: zeitOderNull(werte.rosterLockAt),
      startsAt: zeitOderNull(werte.startsAt),
      estimatedEndAt: zeitOderNull(werte.estimatedEndAt),
      checkinRequired: werte.checkinRequired,
      autoRemoveMissedCheckin: werte.autoRemoveMissedCheckin,
      groupCount: werte.groupCount,
      advancePerGroup: werte.advancePerGroup,
      swissRounds: werte.swissRounds,
      pointsPerWin: werte.pointsPerWin,
      pointsPerDraw: werte.pointsPerDraw,
      pointsPerLoss: werte.pointsPerLoss,
      tiebreakers: werte.tiebreakers as Array<
        'HEAD_TO_HEAD' | 'SCORE_DIFFERENCE' | 'SCORE_FOR' | 'WINS' | 'BUCHHOLZ'
      >,
      defaultBestOf: werte.defaultBestOf,
      mapPool: werte.mapPool
        .split(',')
        .map((karte) => karte.trim())
        .filter((karte) => karte !== ''),
      serverRegion: textOderNull(werte.serverRegion),
      bannerUrl: textOderNull(werte.bannerUrl),
      logoUrl: textOderNull(werte.logoUrl),
      announcementChannelId: textOderNull(werte.announcementChannelId),
      matchCategoryId: textOderNull(werte.matchCategoryId),
      staffCategoryId: textOderNull(werte.staffCategoryId),
      streamChannelId: textOderNull(werte.streamChannelId),
      pingRoleIds: werte.pingRoleIds,
      matchChannelRetentionHours: werte.matchChannelRetentionHours,
      createMatchChannels: werte.createMatchChannels,
      twitchUrl: textOderNull(werte.twitchUrl),
      youtubeUrl: textOderNull(werte.youtubeUrl),
      streamUrl: textOderNull(werte.streamUrl),
      requiredRoleId: textOderNull(werte.requiredRoleId),
      minLevel: werte.minLevel,
      requiresPremium: werte.requiresPremium,
    };

    if (tournamentId) {
      const antwort = await updateTournamentAction({ ...eingabe, tournamentId });
      if (antwort.ok) {
        toast.success('Turnier gespeichert.');
        router.refresh();
      } else {
        toast.error(antwort.error.message);
      }
      setLaeuft(false);
      return;
    }

    const antwort = await createTournamentAction(eingabe);
    if (!antwort.ok) {
      toast.error(antwort.error.message);
      setLaeuft(false);
      return;
    }

    toast.success('Turnier angelegt.');
    router.push(`/turniere/verwalten/${antwort.data.tournamentId}`);
  }

  return (
    <form onSubmit={absenden} className="space-y-8">
      <Abschnitt titel="Grunddaten">
        <Feld label="Name" id="turnier-name" spalten={2}>
          <Input
            id="turnier-name"
            required
            minLength={3}
            maxLength={120}
            value={werte.name}
            onChange={(e) => setze('name', e.target.value)}
            placeholder="SwissHub Winter Cup"
          />
        </Feld>

        <Feld
          label="Kennung in der Adresse"
          id="turnier-slug"
          hinweis="Leer lassen, dann wird sie aus dem Namen gebildet."
        >
          <Input
            id="turnier-slug"
            maxLength={60}
            value={werte.slug}
            onChange={(e) => setze('slug', e.target.value)}
            placeholder="winter-cup"
          />
        </Feld>

        <Feld label="Spiel" id="turnier-spiel">
          <select
            id="turnier-spiel"
            value={werte.gameId ?? ''}
            onChange={(e) => {
              const id = e.target.value;
              const spiel = spiele.find((eintrag) => eintrag.id === id);
              setWerte((vorher) => ({
                ...vorher,
                gameId: id === '' ? null : id,
                // Der Name bleibt die Wahrheit: er steht auch dann noch da,
                // wenn das Spiel später aus der Spielersuche verschwindet.
                gameName: spiel ? spiel.name : vorher.gameName,
              }));
            }}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
          >
            <option value="">Freier Spielname</option>
            {spiele.map((spiel) => (
              <option key={spiel.id} value={spiel.id}>
                {spiel.name}
              </option>
            ))}
          </select>
        </Feld>

        <Feld label="Spielname" id="turnier-spielname">
          <Input
            id="turnier-spielname"
            required
            maxLength={60}
            value={werte.gameName}
            onChange={(e) => setze('gameName', e.target.value)}
            placeholder="Valorant"
          />
        </Feld>

        <Feld label="Beschreibung" id="turnier-beschreibung" spalten={2} hinweis="Markdown erlaubt.">
          <Textarea
            id="turnier-beschreibung"
            rows={4}
            maxLength={4000}
            value={werte.description}
            onChange={(e) => setze('description', e.target.value)}
          />
        </Feld>

        <Feld
          label="Regelwerk"
          id="turnier-regeln"
          spalten={2}
          hinweis="Markdown erlaubt. Diese Fassung ist die verbindliche."
        >
          <Textarea
            id="turnier-regeln"
            rows={8}
            maxLength={40000}
            value={werte.rules}
            onChange={(e) => setze('rules', e.target.value)}
          />
        </Feld>
      </Abschnitt>

      <Abschnitt titel="Format">
        <Feld label="Modus" id="turnier-modus">
          <select
            id="turnier-modus"
            value={werte.mode}
            onChange={(e) => setze('mode', e.target.value as TurnierFormWerte['mode'])}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
          >
            {MODI.map((eintrag) => (
              <option key={eintrag.wert} value={eintrag.wert}>
                {eintrag.label}
              </option>
            ))}
          </select>
        </Feld>

        <Feld label="Turnierform" id="turnier-format">
          <select
            id="turnier-format"
            value={werte.format}
            onChange={(e) => setze('format', e.target.value as TurnierFormWerte['format'])}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
          >
            {FORMATE.map((wert) => (
              <option key={wert} value={wert}>
                {FORMAT_LABEL[wert] ?? wert}
              </option>
            ))}
          </select>
        </Feld>

        <Feld label="Setzung" id="turnier-setzung">
          <select
            id="turnier-setzung"
            value={werte.seeding}
            onChange={(e) => setze('seeding', e.target.value as TurnierFormWerte['seeding'])}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
          >
            {SETZUNG.map((eintrag) => (
              <option key={eintrag.wert} value={eintrag.wert}>
                {eintrag.label}
              </option>
            ))}
          </select>
        </Feld>

        <Feld label="Anmeldung" id="turnier-zugang" hinweis={ZUGANG.find((e) => e.wert === werte.access)?.hinweis}>
          <select
            id="turnier-zugang"
            value={werte.access}
            onChange={(e) => setze('access', e.target.value as TurnierFormWerte['access'])}
            className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm"
          >
            {ZUGANG.map((eintrag) => (
              <option key={eintrag.wert} value={eintrag.wert}>
                {eintrag.label}
              </option>
            ))}
          </select>
        </Feld>

        <Feld label="Best of" id="turnier-bestof">
          <Zahl
            id="turnier-bestof"
            min={1}
            max={9}
            wert={werte.defaultBestOf}
            aendern={(zahl) => setze('defaultBestOf', zahl)}
          />
        </Feld>

        <Feld label="Mindestteilnehmer" id="turnier-min">
          <Zahl
            id="turnier-min"
            min={2}
            max={1024}
            wert={werte.minParticipants}
            aendern={(zahl) => setze('minParticipants', zahl)}
          />
        </Feld>

        <Feld label="Höchstteilnehmer" id="turnier-max" hinweis="0 = keine Obergrenze, dann ohne Warteliste.">
          <Zahl
            id="turnier-max"
            min={0}
            max={1024}
            wert={werte.maxParticipants}
            aendern={(zahl) => setze('maxParticipants', zahl)}
          />
        </Feld>

        {werte.mode === 'TEAM' ? (
          <>
            <Feld label="Spieler mindestens" id="turnier-teammin">
              <Zahl
                id="turnier-teammin"
                min={1}
                max={20}
                wert={werte.minTeamSize}
                aendern={(zahl) => setze('minTeamSize', zahl)}
              />
            </Feld>
            <Feld label="Spieler höchstens" id="turnier-teammax">
              <Zahl
                id="turnier-teammax"
                min={1}
                max={20}
                wert={werte.maxTeamSize}
                aendern={(zahl) => setze('maxTeamSize', zahl)}
              />
            </Feld>
            <Feld label="Ersatzspieler" id="turnier-ersatz">
              <Zahl
                id="turnier-ersatz"
                min={0}
                max={10}
                wert={werte.maxSubstitutes}
                aendern={(zahl) => setze('maxSubstitutes', zahl)}
              />
            </Feld>
          </>
        ) : null}

        {werte.format === 'GROUPS_THEN_ELIMINATION' ? (
          <>
            <Feld label="Gruppen" id="turnier-gruppen" hinweis="0 = aus der Teilnehmerzahl ableiten.">
              <Zahl
                id="turnier-gruppen"
                min={0}
                max={32}
                wert={werte.groupCount}
                aendern={(zahl) => setze('groupCount', zahl)}
              />
            </Feld>
            <Feld label="Je Gruppe weiter" id="turnier-weiter">
              <Zahl
                id="turnier-weiter"
                min={1}
                max={16}
                wert={werte.advancePerGroup}
                aendern={(zahl) => setze('advancePerGroup', zahl)}
              />
            </Feld>
          </>
        ) : null}

        {werte.format === 'SWISS' ? (
          <Feld label="Runden" id="turnier-swiss" hinweis="0 = aus der Teilnehmerzahl ableiten.">
            <Zahl
              id="turnier-swiss"
              min={0}
              max={20}
              wert={werte.swissRounds}
              aendern={(zahl) => setze('swissRounds', zahl)}
            />
          </Feld>
        ) : null}

        {werte.format === 'ROUND_ROBIN' ||
        werte.format === 'SWISS' ||
        werte.format === 'GROUPS_THEN_ELIMINATION' ? (
          <>
            <Feld label="Punkte für Sieg" id="turnier-psieg">
              <Zahl
                id="turnier-psieg"
                min={0}
                max={10}
                wert={werte.pointsPerWin}
                aendern={(zahl) => setze('pointsPerWin', zahl)}
              />
            </Feld>
            <Feld label="Punkte für Unentschieden" id="turnier-punent">
              <Zahl
                id="turnier-punent"
                min={0}
                max={10}
                wert={werte.pointsPerDraw}
                aendern={(zahl) => setze('pointsPerDraw', zahl)}
              />
            </Feld>
            <Feld label="Punkte für Niederlage" id="turnier-pnied">
              <Zahl
                id="turnier-pnied"
                min={0}
                max={10}
                wert={werte.pointsPerLoss}
                aendern={(zahl) => setze('pointsPerLoss', zahl)}
              />
            </Feld>
            <Feld
              label="Tiebreaker"
              id="turnier-tiebreaker"
              spalten={2}
              hinweis="Reihenfolge zählt: der erste entscheidet zuerst."
            >
              <MultiSelect
                options={TIEBREAKER.map((eintrag) => ({ id: eintrag.wert, label: eintrag.label }))}
                selected={werte.tiebreakers}
                onChange={(naechste) => setze('tiebreakers', naechste.slice(0, 5))}
                searchPlaceholder="Tiebreaker suchen …"
              />
            </Feld>
          </>
        ) : null}

        <Feld label="Kartenpool" id="turnier-karten" spalten={2} hinweis="Mit Komma getrennt.">
          <Input
            id="turnier-karten"
            value={werte.mapPool}
            onChange={(e) => setze('mapPool', e.target.value)}
            placeholder="Ascent, Bind, Haven"
          />
        </Feld>

        <Feld label="Region" id="turnier-region">
          <Input
            id="turnier-region"
            maxLength={40}
            value={werte.serverRegion}
            onChange={(e) => setze('serverRegion', e.target.value)}
            placeholder="EU West"
          />
        </Feld>
      </Abschnitt>

      <Abschnitt titel="Zeitplan">
        <Zeitfeld
          label="Anmeldung öffnet"
          id="turnier-anm-auf"
          wert={werte.registrationOpensAt}
          aendern={(wert) => setze('registrationOpensAt', wert)}
        />
        <Zeitfeld
          label="Anmeldeschluss"
          id="turnier-anm-zu"
          wert={werte.registrationClosesAt}
          aendern={(wert) => setze('registrationClosesAt', wert)}
        />
        <Zeitfeld
          label="Check-in öffnet"
          id="turnier-chk-auf"
          wert={werte.checkinOpensAt}
          aendern={(wert) => setze('checkinOpensAt', wert)}
        />
        <Zeitfeld
          label="Check-in schliesst"
          id="turnier-chk-zu"
          wert={werte.checkinClosesAt}
          aendern={(wert) => setze('checkinClosesAt', wert)}
        />
        <Zeitfeld
          label="Roster Lock"
          id="turnier-roster"
          wert={werte.rosterLockAt}
          aendern={(wert) => setze('rosterLockAt', wert)}
        />
        <Zeitfeld
          label="Turnierstart"
          id="turnier-start"
          wert={werte.startsAt}
          aendern={(wert) => setze('startsAt', wert)}
        />
        <Zeitfeld
          label="Voraussichtliches Ende"
          id="turnier-ende"
          wert={werte.estimatedEndAt}
          aendern={(wert) => setze('estimatedEndAt', wert)}
        />

        <Schalter
          label="Check-in verlangen"
          hinweis="Ohne Check-in gilt jede bestätigte Anmeldung als antretend."
          an={werte.checkinRequired}
          aendern={(an) => setze('checkinRequired', an)}
        />
        {werte.checkinRequired ? (
          <Schalter
            label="Nicht Eingecheckte selbsttätig entfernen"
            hinweis="Sonst entscheidet die Leitung beim Schliessen des Check-ins."
            an={werte.autoRemoveMissedCheckin}
            aendern={(an) => setze('autoRemoveMissedCheckin', an)}
          />
        ) : null}
      </Abschnitt>

      <Abschnitt titel="Discord">
        <Feld label="Ankündigungskanal" id="turnier-kanal">
          <ChannelSelect
            id="turnier-kanal"
            value={werte.announcementChannelId}
            channels={textkanaele}
            onChange={(wert) => setze('announcementChannelId', wert ?? '')}
          />
        </Feld>

        <Feld label="Kategorie für Match-Kanäle" id="turnier-matchkat">
          <ChannelSelect
            id="turnier-matchkat"
            value={werte.matchCategoryId}
            channels={kategorien}
            onChange={(wert) => setze('matchCategoryId', wert ?? '')}
            placeholder="Keine Kategorie"
          />
        </Feld>

        <Feld label="Kategorie für die Leitung" id="turnier-staffkat">
          <ChannelSelect
            id="turnier-staffkat"
            value={werte.staffCategoryId}
            channels={kategorien}
            onChange={(wert) => setze('staffCategoryId', wert ?? '')}
            placeholder="Keine Kategorie"
          />
        </Feld>

        <Feld label="Stream-Kanal" id="turnier-streamkanal">
          <ChannelSelect
            id="turnier-streamkanal"
            value={werte.streamChannelId}
            channels={textkanaele}
            onChange={(wert) => setze('streamChannelId', wert ?? '')}
          />
        </Feld>

        <Feld
          label="Rollen für Erwähnungen"
          id="turnier-ping"
          spalten={2}
          hinweis="Nur diese Rollen dürfen bei Ankündigungen erwähnt werden."
        >
          <MultiSelect
            options={roles.map((rolle) => ({ id: rolle.id, label: rolle.name }))}
            selected={werte.pingRoleIds}
            onChange={(naechste) => setze('pingRoleIds', naechste.slice(0, 10))}
            searchPlaceholder="Rolle suchen …"
          />
        </Feld>

        <Schalter
          label="Match-Kanäle anlegen"
          hinweis="Je Match ein privater Textkanal für beide Seiten und die Leitung."
          an={werte.createMatchChannels}
          aendern={(an) => setze('createMatchChannels', an)}
        />

        {werte.createMatchChannels ? (
          <Feld
            label="Match-Kanäle aufbewahren"
            id="turnier-aufbewahrung"
            hinweis="In Stunden nach dem Match. 0 = bis zum Turnierende."
          >
            <Zahl
              id="turnier-aufbewahrung"
              min={0}
              max={720}
              wert={werte.matchChannelRetentionHours}
              aendern={(zahl) => setze('matchChannelRetentionHours', zahl)}
            />
          </Feld>
        ) : null}
      </Abschnitt>

      <Abschnitt titel="Darstellung und Stream">
        <Feld label="Banner (URL)" id="turnier-banner" spalten={2}>
          <Input
            id="turnier-banner"
            type="url"
            maxLength={500}
            value={werte.bannerUrl}
            onChange={(e) => setze('bannerUrl', e.target.value)}
            placeholder="https://…"
          />
        </Feld>
        <Feld label="Logo (URL)" id="turnier-logo" spalten={2}>
          <Input
            id="turnier-logo"
            type="url"
            maxLength={500}
            value={werte.logoUrl}
            onChange={(e) => setze('logoUrl', e.target.value)}
            placeholder="https://…"
          />
        </Feld>
        <Feld label="Twitch" id="turnier-twitch">
          <Input
            id="turnier-twitch"
            type="url"
            maxLength={500}
            value={werte.twitchUrl}
            onChange={(e) => setze('twitchUrl', e.target.value)}
            placeholder="https://twitch.tv/…"
          />
        </Feld>
        <Feld label="YouTube" id="turnier-youtube">
          <Input
            id="turnier-youtube"
            type="url"
            maxLength={500}
            value={werte.youtubeUrl}
            onChange={(e) => setze('youtubeUrl', e.target.value)}
            placeholder="https://youtube.com/…"
          />
        </Feld>
        <Feld label="Anderer Stream" id="turnier-stream" spalten={2}>
          <Input
            id="turnier-stream"
            type="url"
            maxLength={500}
            value={werte.streamUrl}
            onChange={(e) => setze('streamUrl', e.target.value)}
            placeholder="https://…"
          />
        </Feld>
      </Abschnitt>

      <Abschnitt titel="Wer teilnehmen darf">
        <Feld label="Benötigte Rolle" id="turnier-rolle">
          <RoleSelect
            id="turnier-rolle"
            value={werte.requiredRoleId}
            roles={roles}
            onChange={(wert) => setze('requiredRoleId', wert ?? '')}
          />
        </Feld>

        <Feld label="Mindest-Level" id="turnier-level" hinweis="0 = keine Bedingung.">
          <Zahl
            id="turnier-level"
            min={0}
            max={999}
            wert={werte.minLevel}
            aendern={(zahl) => setze('minLevel', zahl)}
          />
        </Feld>

        <Schalter
          label="Nur mit laufendem Premium-Abo"
          an={werte.requiresPremium}
          aendern={(an) => setze('requiresPremium', an)}
        />
      </Abschnitt>

      <div className="flex items-center gap-3 border-t border-border pt-5">
        <Button type="submit" disabled={laeuft}>
          {laeuft ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Save aria-hidden="true" />
          )}
          {tournamentId ? 'Speichern' : 'Turnier anlegen'}
        </Button>
        {!tournamentId ? (
          <p className="text-xs text-muted-foreground">
            Das Turnier entsteht als Entwurf. Veröffentlicht wird es erst danach.
          </p>
        ) : null}
      </div>
    </form>
  );
}

function Abschnitt({
  titel,
  children,
}: {
  titel: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <fieldset className="space-y-4 rounded-2xl border border-border p-5">
      <legend className="px-2 text-sm font-semibold">{titel}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Feld({
  label,
  id,
  hinweis,
  spalten = 1,
  children,
}: {
  label: string;
  id: string;
  hinweis?: string;
  spalten?: 1 | 2;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={spalten === 2 ? 'space-y-1.5 sm:col-span-2' : 'space-y-1.5'}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hinweis ? <p className="text-xs text-muted-foreground">{hinweis}</p> : null}
    </div>
  );
}

function Zahl({
  id,
  min,
  max,
  wert,
  aendern,
}: {
  id: string;
  min: number;
  max: number;
  wert: number;
  aendern: (zahl: number) => void;
}): React.JSX.Element {
  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      value={wert}
      onChange={(e) => {
        const zahl = Number.parseInt(e.target.value, 10);
        // Ein leeres Feld darf nicht in NaN münden: das käme als `null` beim
        // Server an und würde dort als «nicht gesetzt» gelesen.
        aendern(Number.isFinite(zahl) ? zahl : min);
      }}
    />
  );
}

function Zeitfeld({
  label,
  id,
  wert,
  aendern,
}: {
  label: string;
  id: string;
  wert: string;
  aendern: (wert: string) => void;
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="datetime-local"
        value={wert}
        onChange={(e) => aendern(e.target.value)}
      />
    </div>
  );
}

function Schalter({
  label,
  hinweis,
  an,
  aendern,
}: {
  label: string;
  hinweis?: string;
  an: boolean;
  aendern: (an: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border/60 p-3 sm:col-span-2">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        {hinweis ? <p className="text-xs text-muted-foreground">{hinweis}</p> : null}
      </div>
      <Switch checked={an} onCheckedChange={aendern} aria-label={label} />
    </div>
  );
}

/** Einen Zeitpunkt für `datetime-local` schreiben - in Ortszeit, ohne Zone. */
export function fuerZeitfeld(zeitpunkt: Date | null): string {
  if (!zeitpunkt) {
    return '';
  }
  const versetzt = new Date(zeitpunkt.getTime() - zeitpunkt.getTimezoneOffset() * 60_000);
  return versetzt.toISOString().slice(0, 16);
}
