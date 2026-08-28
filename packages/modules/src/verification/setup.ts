import { env } from '@swisshub/config';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { listCachedChannels, listCachedRoles } from '../discord/sync';
import { isModuleEnabled } from '../module-state';
import { VERIFICATION_MODULE_ID, type VerificationSettings } from './config';
import { verificationSettings } from './service';

/**
 * «Verifikation testen».
 *
 * Prueft alles, was zur Laufzeit still scheitern kann - und zwar ohne einen
 * echten Vorgang anzulegen, jemandem eine Rolle zu geben oder irgendetwas zu
 * senden. Der Test darf niemanden beruehren.
 *
 * Der Zweck ist, die Fehler *vorher* zu finden: eine Rolle ueber der
 * Bot-Rolle, ein geloeschter Kanal, ein fehlendes Intent. Jeder davon faellt
 * sonst erst auf, wenn das erste neue Mitglied ohne Rolle im Server steht.
 */

export type PruefStatus = 'ok' | 'warning' | 'error' | 'skipped';

export interface Pruefpunkt {
  id: string;
  label: string;
  status: PruefStatus;
  detail: string;
}

export interface Pruefbericht {
  bereit: boolean;
  punkte: Pruefpunkt[];
}

export async function runSetupCheck(
  options: { gateway?: DiscordGateway; settings?: VerificationSettings } = {},
): Promise<Pruefbericht> {
  const gateway = options.gateway ?? defaultDiscord;
  const settings = options.settings ?? (await verificationSettings());
  const punkte: Pruefpunkt[] = [];

  const eintragen = (id: string, label: string, status: PruefStatus, detail: string): void => {
    punkte.push({ id, label, status, detail });
  };

  // --- Modul --------------------------------------------------------------
  const aktiv = await isModuleEnabled(VERIFICATION_MODULE_ID);
  eintragen(
    'module',
    'Modul aktiv',
    aktiv ? 'ok' : 'error',
    aktiv ? 'Eingeschaltet.' : 'Ausgeschaltet - es passiert nichts, wenn jemand beitritt.',
  );

  // --- Bot erreichbar -----------------------------------------------------
  const identitaet = await gateway.bot.identity().catch(() => null);
  eintragen(
    'bot',
    'Bot erreichbar',
    identitaet ? 'ok' : 'error',
    identitaet ? `Angemeldet als ${identitaet.username}.` : 'Der Bot antwortet nicht.',
  );

  // --- Rollen und Hierarchie ---------------------------------------------
  const [rollen, kanaele] = await Promise.all([
    listCachedRoles().catch(() => []),
    listCachedChannels().catch(() => []),
  ]);
  // Die hoechste Rolle des Bots - alles darueber kann er nicht anfassen.
  const botPosition = await gateway.bot.highestRolePosition().catch(() => 0);

  const pruefeRolle = (id: string | null, schluessel: string, label: string): void => {
    if (!id) {
      eintragen(schluessel, label, 'error', 'Nicht eingestellt.');
      return;
    }
    const rolle = rollen.find((eintrag) => eintrag.id === id);
    if (!rolle) {
      eintragen(schluessel, label, 'error', 'Diese Rolle gibt es auf Discord nicht mehr.');
      return;
    }
    if (botPosition > 0 && rolle.position >= botPosition) {
      eintragen(
        schluessel,
        label,
        'error',
        `«${rolle.name}» steht über der Bot-Rolle. Der Bot kann sie weder vergeben noch entfernen - bitte die Bot-Rolle in den Discord-Servereinstellungen höher schieben.`,
      );
      return;
    }
    eintragen(schluessel, label, 'ok', `«${rolle.name}» ist vergebbar.`);
  };

  pruefeRolle(settings.unverifiedRoleId, 'unverifiedRole', 'Rolle «Noch nicht verifiziert»');
  pruefeRolle(settings.memberRoleId, 'memberRole', 'Mitgliederrolle');

  if (settings.moderatorPingRoleId) {
    const rolle = rollen.find((eintrag) => eintrag.id === settings.moderatorPingRoleId);
    eintragen(
      'pingRole',
      'Moderator-Erwähnung',
      rolle ? 'ok' : 'warning',
      rolle ? `«${rolle.name}»` : 'Diese Rolle gibt es nicht mehr - es wird niemand erwähnt.',
    );
  } else {
    eintragen('pingRole', 'Moderator-Erwähnung', 'skipped', 'Nicht eingestellt - es wird niemand erwähnt.');
  }

  // --- Kanaele ------------------------------------------------------------
  const pruefeKanal = async (
    id: string | null,
    schluessel: string,
    label: string,
    pflicht: boolean,
  ): Promise<void> => {
    if (!id) {
      eintragen(schluessel, label, pflicht ? 'error' : 'skipped', 'Nicht eingestellt.');
      return;
    }
    const kanal = kanaele.find((eintrag) => eintrag.id === id);
    if (!kanal) {
      eintragen(schluessel, label, 'error', 'Dieser Channel existiert nicht mehr.');
      return;
    }
    // Darf der Bot dort ueberhaupt schreiben? Ohne diese Pruefung faellt es
    // erst auf, wenn die erste Begruessung ins Leere geht.
    const rechte = await gateway.channels.botPermissions(id).catch(() => null);
    if (rechte === null) {
      eintragen(schluessel, label, 'warning', `#${kanal.name} - Rechte nicht prüfbar.`);
      return;
    }
    const SEND_MESSAGES = 1n << 11n;
    const VIEW_CHANNEL = 1n << 10n;
    const darfSehen = (rechte & VIEW_CHANNEL) !== 0n;
    const darfSchreiben = (rechte & SEND_MESSAGES) !== 0n;
    if (!darfSehen || !darfSchreiben) {
      eintragen(
        schluessel,
        label,
        'error',
        `#${kanal.name} - dem Bot fehlt ${!darfSehen ? 'das Recht, den Kanal zu sehen' : 'das Recht, dort zu schreiben'}.`,
      );
      return;
    }
    eintragen(schluessel, label, 'ok', `#${kanal.name} - der Bot darf dort schreiben.`);
  };

  await pruefeKanal(settings.verificationChannelId, 'verificationChannel', 'Verifikationskanal', true);
  await pruefeKanal(settings.moderatorChannelId, 'moderatorChannel', 'Moderations-Kanal', true);
  await pruefeKanal(settings.logChannelId, 'logChannel', 'Protokoll-Kanal', false);

  // --- Message Content ----------------------------------------------------
  const messageContent = await gateway.bot.messageContentAllowed().catch(() => null);
  if (messageContent === null) {
    eintragen('intent', 'Message Content Intent', 'warning', 'Nicht prüfbar.');
  } else if (!messageContent) {
    eintragen(
      'intent',
      'Message Content Intent',
      'error',
      'Im Discord Developer Portal nicht freigeschaltet. Ohne ihn liest der Bot keine Nachrichten - die Verifikation kann nicht funktionieren.',
    );
  } else {
    eintragen('intent', 'Message Content Intent', 'ok', 'Freigeschaltet.');
  }

  // --- Bann-Recht ---------------------------------------------------------
  //
  // Nur geprueft, nicht ausgeuebt: es wird niemand gebannt.
  // Ueber das Bot-Mitglied und seine Rollen: die Rechte stehen an den Rollen,
  // und `bans.add` waere die einzige andere Art zu pruefen - die verbietet
  // sich, weil sie jemanden bannen wuerde.
  const botMitglied = await gateway.bot.member().catch(() => null);
  if (!botMitglied) {
    eintragen('ban', 'Bann-Recht', 'warning', 'Nicht prüfbar - das Bot-Mitglied war nicht abrufbar.');
  } else {
    const BAN_MEMBERS = 1n << 2n;
    const ADMINISTRATOR = 1n << 3n;
    const rechte = rollen
      .filter((rolle) => botMitglied.roleIds.includes(rolle.id))
      .reduce((summe, rolle) => summe | BigInt(rolle.permissions ?? '0'), 0n);
    const darf = (rechte & BAN_MEMBERS) !== 0n || (rechte & ADMINISTRATOR) !== 0n;
    eintragen(
      'ban',
      'Bann-Recht',
      darf ? 'ok' : 'error',
      darf
        ? 'Der Bot darf bannen - Ablehnungen funktionieren.'
        : 'Dem Bot fehlt das Recht, Mitglieder zu bannen. Ablehnungen würden scheitern.',
    );
  }

  // --- AI -----------------------------------------------------------------
  if (!settings.aiEnabled) {
    eintragen('ai', 'AI-Prüfung', 'skipped', 'Ausgeschaltet - es entscheiden ausschliesslich Menschen.');
  } else if (!env.ANTHROPIC_API_KEY) {
    eintragen(
      'ai',
      'AI-Prüfung',
      'error',
      'Eingeschaltet, aber ANTHROPIC_API_KEY fehlt in der Serverkonfiguration. Es wird nichts geprüft; alle Fälle gehen an die Moderation.',
    );
  } else {
    eintragen(
      'ai',
      'AI-Prüfung',
      'ok',
      `Schlüssel hinterlegt, Modell ${settings.aiModel}, Schwelle ${Math.round(settings.aiThreshold * 100)} %.${
        settings.aiAutoVerify ? '' : ' Automatische Freischaltung ist aus - die AI schlägt nur vor.'
      }`,
    );
  }

  return { bereit: !punkte.some((punkt) => punkt.status === 'error'), punkte };
}
