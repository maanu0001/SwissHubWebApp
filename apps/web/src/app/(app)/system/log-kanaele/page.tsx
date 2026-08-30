import type { Metadata } from 'next';
import { can } from '@swisshub/auth';
import { logs } from '@swisshub/modules';
import { formatDateTime } from '@swisshub/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { requirePagePermission } from '@/server/auth';
import { loadDiscordOptions } from '@/server/configuration';
import { LogKanalVerwaltung } from '@/modules/logs/components/log-kanal-verwaltung';

export const metadata: Metadata = { title: 'Discord-Log-Kanäle' };
export const dynamic = 'force-dynamic';

/**
 * Wohin welche Log-Kategorie geht.
 *
 * Die Seite fragt Discord nicht: Kanäle kommen aus dem Sync-Cache, der
 * Zustand der Ziele aus der Datenbank. Ein Seitenaufruf, der ein Dutzend
 * Discord-Anfragen auslöst, wäre bei jedem Laden langsam und irgendwann am
 * Rate Limit - geprüft wird deshalb regelmässig im Bot, nicht hier.
 */
export default async function LogKanaelePage(): Promise<React.JSX.Element> {
  const context = await requirePagePermission('logs.discord.view');
  const [ziele, optionen] = await Promise.all([logs.ladeZiele(), loadDiscordOptions()]);

  // Nur Kanäle, in die sich schreiben lässt. Sprachkanäle, Kategorien und
  // Bühnen stehen gar nicht erst zur Auswahl - sie später serverseitig
  // abzulehnen wäre eine Falle statt einer Führung.
  const kanaele = optionen.channels.filter((kanal) => kanal.kind === 'text' && !kanal.deleted);

  const zuletztGeprueft = ziele
    .map((ziel) => ziel.checkedAt)
    .filter((datum): datum is Date => datum !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Discord-Log-Kanäle</CardTitle>
          <CardDescription>
            Jede Kategorie kann optional in einen Discord-Kanal ausgegeben werden. Ohne Kanal bleibt
            der Logeintrag im SwissHub System bestehen - es wird lediglich keine Discord-Nachricht
            erzeugt. Derselbe Kanal darf mehrfach verwendet werden.
            {zuletztGeprueft ? ` Zuletzt geprüft ${formatDateTime(zuletztGeprueft)}.` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Der Bot braucht im Zielkanal drei Rechte: <strong>Kanal ansehen</strong>,{' '}
          <strong>Nachrichten senden</strong> und <strong>Embeds senden</strong>. Fehlt eines,
          weist SwissHub den Kanal beim Speichern ab und sagt, welches.
        </CardContent>
      </Card>

      <LogKanalVerwaltung
        ziele={ziele.map((ziel) => ({
          category: ziel.category,
          label: ziel.label,
          beschreibung: ziel.beschreibung,
          beispiel: ziel.beispiel,
          channelId: ziel.channelId,
          channelName: ziel.channelName,
          enabled: ziel.enabled,
          health: ziel.health,
          healthNote: ziel.healthNote,
          lastErrorCode: ziel.lastErrorCode,
        }))}
        channels={kanaele}
        darfVerwalten={can(context, 'logs.discord.manage')}
        darfTesten={can(context, 'logs.discord.test')}
      />
    </div>
  );
}
