# Module entwickeln

Diese Anleitung zeigt Schritt für Schritt, wie ein neues SwissHub-Modul entsteht.
Als durchgehendes Beispiel dient ein **Warnings-Modul** (Verwarnungen).

Ziel der Architektur: Ein neues Modul soll an **einer** Stelle beschrieben werden und
anschliessend automatisch in Navigation, Berechtigungsverwaltung, Modulverwaltung und
Dashboard erscheinen.

---

## 1. Überblick

| Ort                                      | Inhalt                                                      |
| ---------------------------------------- | ----------------------------------------------------------- |
| `packages/modules/src/<modul>/`          | Konfiguration, Schemas, Services, Policies, Discord-Handler |
| `apps/web/src/modules/<modul>/`          | Server Actions und React-Komponenten                        |
| `apps/web/src/app/(app)/<modul>/`        | Seiten (Route)                                              |
| `packages/database/prisma/schema.prisma` | eigene Datenbankmodelle                                     |

Empfohlene Struktur eines Moduls:

```
packages/modules/src/warnings/
  config.ts          Moduldefinition, Permissions, Einstellungen (Zod)
  schemas.ts         Eingabevalidierung
  service.ts         Schreibende Logik (Discord + Datenbank + Audit)
  queries.ts         Lesende Zugriffe (Listen, Details, Statistik)
  notifications.ts   Discord-Embeds (optional)
  index.ts           Re-Exports
```

---

## 2. Schritt 1: Datenbankmodell

`packages/database/prisma/schema.prisma` ergänzen:

```prisma
model Warning {
  id                 String   @id @default(cuid())
  targetDiscordId    String
  targetUsername     String
  moderatorDiscordId String
  moderatorUsername  String
  reason             String
  severity           Int      @default(1)
  revokedAt          DateTime?
  idempotencyKey     String?  @unique
  createdAt          DateTime @default(now())

  @@index([targetDiscordId, createdAt])
}
```

Migration erzeugen:

```bash
npm run db:migrate -- --name add_warnings
```

Grundsätze: Zeiten in UTC, Unique-Constraints für Idempotenz und fachliche Eindeutigkeit,
Indizes für die Felder, nach denen gefiltert wird.

---

## 3. Schritt 2: Moduldefinition

`packages/modules/src/warnings/config.ts`:

```ts
import { z } from 'zod';
import { optionalSnowflakeSchema } from '@swisshub/shared';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';

export const WARNINGS_MODULE_ID = 'warnings';

export const WARNINGS_PERMISSIONS = {
  view: 'warnings.view',
  create: 'warnings.create',
  revoke: 'warnings.revoke',
  settings: 'warnings.settings',
} as const;

export const warningsSettingsSchema = z.object({
  logChannelId: optionalSnowflakeSchema,
  maxSeverity: z.number().int().min(1).max(10).default(3),
});

export type WarningsSettings = z.infer<typeof warningsSettingsSchema>;

/**
 * Beschreibung der Einstellungen. Daraus entsteht die Seite
 * `/modules/warnings` automatisch - inklusive Rollen- und Channel-Auswahl.
 * Ein eigenes Formular ist nicht nötig, und es gibt keine ID-Eingabefelder.
 */
export const warningsSettingsFields: SettingsField[] = [
  {
    key: 'logChannelId',
    type: 'discord-channel',
    label: 'Log-Channel',
    group: 'Discord',
    channelKinds: ['text'],
  },
  {
    key: 'maxSeverity',
    type: 'number',
    label: 'Maximale Schwere',
    group: 'Verhalten',
    min: 1,
    max: 10,
  },
];

export const warningsModule: ModuleDefinition = registerModule({
  id: WARNINGS_MODULE_ID,
  name: 'Verwarnungen',
  description: 'Verwarnungen aussprechen, einsehen und zurücknehmen.',
  icon: 'ShieldAlert', // Name aus components/layout/nav-icon.tsx
  permissionPrefix: 'warnings',
  defaultEnabled: true,
  settingsSchema: warningsSettingsSchema,
  settingsFields: warningsSettingsFields,
  configVersion: 1, // bei inkompatiblen Änderungen am Schema erhöhen
  requiredDiscordPermissions: ['SEND_MESSAGES', 'EMBED_LINKS'],
  // Konkrete Aussagen für die Systemgesundheit - mit Link zur Lösung.
  async healthChecks(context) {
    const { getModuleSettings } = await import('../module-state');
    const settings = await getModuleSettings<WarningsSettings>(WARNINGS_MODULE_ID);
    if (!settings.logChannelId) {
      return [
        {
          label: 'Log-Channel',
          status: 'warning',
          detail: 'Es ist kein Channel gewählt - Verwarnungen werden nicht protokolliert.',
          fixHref: `/modules/${WARNINGS_MODULE_ID}`,
        },
      ];
    }
    void context;
    return [{ label: 'Log-Channel', status: 'ok' }];
  },
  permissions: [
    {
      key: WARNINGS_PERMISSIONS.view,
      label: 'Verwarnungen ansehen',
      description: 'Verwarnungen einsehen.',
      module: WARNINGS_MODULE_ID,
    },
    {
      key: WARNINGS_PERMISSIONS.create,
      label: 'Verwarnung erstellen',
      description: 'Mitglieder verwarnen.',
      module: WARNINGS_MODULE_ID,
      critical: true,
    },
  ],
  tagline: 'Verwarnungen verwalten', // Kurztext für die Modulkachel
  navigation: [
    {
      href: '/warnings',
      label: 'Verwarnungen',
      description: 'Verwarnungen einsehen und aussprechen', // Untertitel in der Kopfzeile
      permission: WARNINGS_PERMISSIONS.view,
      icon: 'ShieldAlert', // Name aus components/layout/nav-icon.tsx
      group: 'moderation', // Abschnitt der Seitenleiste
      order: 35,
      // badge: 'NEU',            // optionales Label rechts im Eintrag
      // counter: 'activeJails',  // optionaler dynamischer Zähler
    },
  ],
});
```

Danach das Modul in `packages/modules/src/index.ts` importieren:

```ts
import './warnings/config';
```

**Das ist die einzige zentrale Änderung.** Navigation, Permission Registry, Modulverwaltung,
Berechtigungszuordnung, Einstellungsseite (`/modules/warnings`), Bot-Berechtigungsprüfung und
Systemgesundheit kennen das Modul ab jetzt automatisch.

### Feldtypen der Einstellungsoberfläche

| Typ                    | Ergebnis im Dashboard                                             |
| ---------------------- | ----------------------------------------------------------------- |
| `discord-role`         | Rollenauswahl (`mustBeManageable` erzwingt die Hierarchieprüfung) |
| `discord-role-list`    | Mehrfachauswahl mit Suche                                         |
| `discord-channel`      | Channel-Auswahl (`channelKinds` filtert die Art)                  |
| `discord-channel-list` | Mehrfachauswahl von Channels                                      |
| `boolean`              | Schalter                                                          |
| `number`               | Zahlenfeld mit Grenzen und Einheit                                |
| `duration`             | Dauer mit Vorschlägen und freier Eingabe                          |
| `text` / `textarea`    | Textfeld                                                          |

Gespeichert wird über `writeModuleSettings` - inklusive Zod-Validierung, Prüfung gegen den
echten Discord-Zustand, Audit Log mit Vorher/Nachher und Erhöhung der Konfigurations-Revision.
Details: [CONFIGURATION.md](CONFIGURATION.md).

> **Keine Rollen-IDs im Code.** Ein Modul liest seine Rollen und Channels ausschliesslich aus
> den eigenen Einstellungen (`getModuleSettings`), niemals aus `process.env`.

> Neues Icon nötig? In `apps/web/src/components/layout/nav-icon.tsx` in die `ICONS`-Zuordnung
> aufnehmen (bewusst eine feste Liste - so bleibt das Bundle klein).

### Navigationsabschnitte

`group` bestimmt, in welchem Abschnitt der Seitenleiste das Modul erscheint
(definiert in `packages/modules/src/registry.ts`):

| Gruppe       | Beschriftung            | Beispiele                                  |
| ------------ | ----------------------- | ------------------------------------------ |
| `overview`   | (ohne Titel)            | Dashboard                                  |
| `moderation` | Mitglieder & Moderation | Mitglieder, Jail, Moderation               |
| `modules`    | Bot Module              | Feature-Module                             |
| `system`     | System                  | Audit Log, Module, Einstellungen, Branding |

### Wenn ein Eintrag mehrere Zugänge hat

Ein Modul hat oft mehr als eine Tür. Beim Jail darf jemand die Strafakte lesen –
oder nur eine Community-Abstimmung starten, ohne die Akte je zu sehen. Dafür gibt
es zwei Werkzeuge, und sie lösen verschiedene Probleme:

| Feld             | Wirkung                                                            | Wann                                                  |
| ---------------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `altPermissions` | Derselbe Eintrag wird auch mit einer anderen Berechtigung sichtbar | Alle dürfen auf **dieselbe** Seite                    |
| `alternatives`   | Der Eintrag zeigt **woandershin** und heisst anders                | Die Berechtigungen führen auf **verschiedene** Seiten |

`altPermissions` war der erste Versuch beim Jail – und er war falsch: Wer nur
abstimmen durfte, sah «Jail», klickte, und bekam eine 403-Seite. Der Eintrag
zeigte auf etwas, das er nicht öffnen durfte.

```ts
navigation: [
  {
    href: '/jail',
    label: 'Jail',
    permission: JAIL_PERMISSIONS.view,
    alternatives: [
      {
        permission: JAIL_PERMISSIONS.voteStart,
        href: '/jail/votes',
        label: 'Vote Jail',
      },
    ],
    // ...
  },
],
```

Geprüft wird der Reihe nach und **nur, wenn die Hauptberechtigung fehlt**: Wer
beides hat, sieht den Hauptbereich und keinen zweiten Eintrag daneben.

Der Auflöser gewährt dabei keine Rechte. Er entscheidet, wohin ein Eintrag
zeigt; die Seite selbst prüft weiterhin serverseitig – und muss dafür
`requirePagePermission([a, b])` mit allen Zugängen aufrufen, die dorthin führen
dürfen.

### Kein Platz für Ausblicke

In der Navigation erscheint ausschliesslich, was auch funktioniert: ein Eintrag
entsteht nur für ein registriertes, eingeschaltetes Modul mit vorhandener Seite.

Es gab dafür einmal einen Ausblick-Modus (`status: 'planned'`, ausgegraut, Label
"Bald"). Er ist entfernt worden, weil er in der Praxis das Gegenteil bewirkte:
Die Einträge sahen aus wie Funktionen und waren keine. Ein Modul wird sichtbar,
sobald es fertig ist - vorher steht es auf der Roadmap, nicht in der Seitenleiste.

---

## 4. Schritt 3: Eingabevalidierung

`packages/modules/src/warnings/schemas.ts`:

```ts
import { z } from 'zod';
import { sanitizeText, snowflakeSchema } from '@swisshub/shared';

export const createWarningSchema = z.object({
  targetDiscordId: snowflakeSchema,
  reason: z
    .string()
    .min(3)
    .max(500)
    .transform((value) => sanitizeText(value, 500)),
  severity: z.number().int().min(1).max(10),
  idempotencyKey: z.string().uuid(),
});

export type CreateWarningInput = z.infer<typeof createWarningSchema>;
```

Regel: **niemals** darauf vertrauen, dass Werte aus dem Frontend korrekt sind.

---

## 5. Schritt 4: Service

`packages/modules/src/warnings/service.ts` - hier gehört die gesamte Fachlogik hin
(niemals in React-Komponenten oder Route Handler).

```ts
import { AUDIT_ACTIONS, prisma, claimIdempotencyKey, safeRecordAudit } from '@swisshub/database';
import { discord as defaultDiscord, type DiscordGateway } from '@swisshub/discord';
import { evaluateModerationPolicy, loadRoleConfiguration } from '@swisshub/permissions';
import { conflict, policyViolation } from '@swisshub/shared';
import { WARNINGS_MODULE_ID } from './config';
import type { CreateWarningInput } from './schemas';

export interface WarningActor {
  discordId: string;
  username: string;
  roleIds: string[];
  isOwner: boolean;
  moderationLevel: number;
}

export async function createWarning(
  input: CreateWarningInput,
  actor: WarningActor,
  options: { gateway?: DiscordGateway } = {},
) {
  const gateway = options.gateway ?? defaultDiscord;

  // 1. Ziel immer frisch laden - Rollen können sich geändert haben.
  const target = await gateway.members.get(input.targetDiscordId);
  const configuration = await loadRoleConfiguration();
  const [guildRoles, botHighestPosition, botIdentity, guild] = await Promise.all([
    gateway.roles.list({ force: true }),
    gateway.bot.highestRolePosition(),
    gateway.bot.identity(),
    gateway.guild.get(),
  ]);

  // 2. Zentrale Moderation Policy verwenden - nicht selbst nachbaün.
  const decision = evaluateModerationPolicy({
    actor,
    target,
    guildRoles,
    protectedRoleIds: configuration.protectedRoleIds,
    moderationLevels: configuration.moderationLevels,
    botHighestPosition,
    botUserId: botIdentity.id,
    guildOwnerId: guild.ownerId,
  });
  if (!decision.allowed || !target) {
    throw policyViolation(decision.message ?? 'Aktion nicht zulässig.');
  }

  // 3. Idempotenz sichern.
  const claim = await claimIdempotencyKey('warnings.create', input.idempotencyKey, actor.discordId);
  if (claim.status === 'duplicate') {
    throw conflict('Diese Verwarnung wurde bereits erfasst.');
  }

  // 4. Schreiben + protokollieren.
  const warning = await prisma.warning.create({
    data: {
      targetDiscordId: target.discordId,
      targetUsername: target.username,
      moderatorDiscordId: actor.discordId,
      moderatorUsername: actor.username,
      reason: input.reason,
      severity: input.severity,
      idempotencyKey: `warnings.create:${input.idempotencyKey}`,
    },
  });

  await safeRecordAudit({
    action: 'WARNING_CREATED',
    module: WARNINGS_MODULE_ID,
    actorDiscordId: actor.discordId,
    actorUsername: actor.username,
    targetDiscordId: target.discordId,
    success: true,
    metadata: { warningId: warning.id, severity: input.severity },
  });

  return warning;
}
```

Führt das Modul echte Discord-Aktionen aus, gilt zusätzlich das Muster aus
`packages/modules/src/jail/service.ts`: Status `PENDING -> EXECUTING -> COMPLETED/PARTIAL/FAILED`,
Fehler-Mapping über `mapDiscordError`, Benachrichtigungen als "best effort".

---

## 6. Schritt 5: Server Action

`apps/web/src/modules/warnings/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { warnings } from '@swisshub/modules';
import { defineAction } from '@/server/action';
import { assertModuleEnabled } from '@/server/modules';

export const createWarningAction = defineAction(
  {
    name: 'warnings.create',
    module: 'warnings',
    permission: 'warnings.create',
    schema: warnings.createWarningSchema,
    rateLimit: 'discordAction',
    freshness: 'critical',
  },
  async ({ ctx, input }) => {
    await assertModuleEnabled('warnings');

    const warning = await warnings.createWarning(input, {
      discordId: ctx.user.discordId,
      username: ctx.user.username,
      roleIds: ctx.roleIds,
      isOwner: ctx.user.isOwner,
      moderationLevel: ctx.moderationLevel,
    });

    revalidatePath('/warnings');
    return { warningId: warning.id };
  },
);
```

`defineAction` übernimmt automatisch: Session, Guild-Mitgliedschaft, CSRF, Rate Limit,
Zod-Validierung, Permission-Prüfung, einheitliche Fehlerbehandlung und `ActionResult`.

Braucht das Modul ein eigenes Rate-Limit-Kontingent, in
`apps/web/src/server/rate-limit.ts` unter `RATE_LIMITS` ergänzen.

---

## 7. Schritt 6: Seite und UI

`apps/web/src/app/(app)/warnings/page.tsx`:

```tsx
export const dynamic = 'force-dynamic';

export default async function WarningsPage() {
  const context = await requirePagePermission('warnings.view');
  const csrfToken = csrfTokenFor(context);
  // ... Daten laden und mit DataTable/PageHeader rendern
}
```

Wiederverwendbare Bausteine:

| Komponente                                                                 | Zweck                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------- |
| `PageHeader`                                                               | Titel, Beschreibung, Aktionen                     |
| `StatCard`                                                                 | Kennzahl mit Icon                                 |
| `DataTable`                                                                | Tabelle inkl. Leerzustand                         |
| `Pagination`                                                               | serverseitige Seitennavigation                    |
| `MemberCard`, `DiscordAvatar`, `RoleBadge`                                 | Mitgliederdarstellung                             |
| `ConfirmationDialog`                                                       | Bestätigung destruktiver Aktionen                 |
| `StatusBadge`, `EmptyState`, `ErrorState`, `LoadingState`, `TableSkeleton` | Zustände                                          |
| `PermissionGuard`                                                          | UX-Filterung (keine Sicherheitsgrenze!)           |
| `AuditEntry`                                                               | Audit-Eintrag                                     |
| `SettingsForm`                                                             | generische Einstellungsseite aus `settingsFields` |
| `RoleSelect`, `ChannelSelect`, `MultiSelect`                               | Discord-Auswahllisten statt ID-Feldern            |
| `HealthChecks`                                                             | Ergebnis der Modulprüfungen mit Quick-Fix         |

Formulare in Client-Komponenten übergeben immer `csrfToken` an die Server Action und melden das
Ergebnis per `toast` (`sonner`).

> Für **Einstellungen** ist keine eigene Seite nötig: `settingsFields` in der Moduldefinition
> genügt, `/modules/<id>` wird daraus erzeugt.

---

## 8. Schritt 7: Hintergrundjobs (optional)

Braucht das Modul zeitgesteuerte Arbeit (Ablauf, Erinnerungen, Abgleich), wird ein Job in
`apps/bot/src/jobs.ts` ergänzt:

```ts
{
  name: 'warnings-expiry',
  intervalMs: 60_000,
  async run() {
    await warnings.expireOldWarnings();
  },
},
```

Regeln: idempotent arbeiten, Datenbank als Source of Truth, kein `setTimeout` für Fristen,
Batchgrössen begrenzen (Discord Rate Limits).

---

## 9. Schritt 8: Tests

```
tests/unit/warnings-validation.test.ts     Schemas und Grenzwerte
tests/integration/warnings-service.test.ts Service mit Mock-Gateway und Fake-Datenbank
```

Discord ist über `createMockGateway()` bzw. eigene `DiscordGateway`-Objekte mockbar; für die
Datenbank existiert `tests/helpers/fake-database.ts` (bildet Unique-Constraints nach).
Mindestens abdecken: Erfolgsfall, fehlende Berechtigung, Policy-Verstoss, doppelte Ausführung,
Fehlerfall der Discord-API.

---

## 10. Checkliste für ein neues Modul

- [ ] Datenbankmodell + Migration
- [ ] `config.ts` mit `registerModule(...)`, Permissions und Einstellungen
- [ ] `settingsFields`, `configVersion`, `requiredDiscordPermissions`, `healthChecks` gesetzt
- [ ] keine Rollen-/Channel-IDs aus `process.env` - alles aus den Moduleinstellungen
- [ ] Import in `packages/modules/src/index.ts`
- [ ] Zod-Schemas für alle Eingaben
- [ ] Service mit Moderation Policy, Idempotenz und Audit Log
- [ ] Server Actions über `defineAction`
- [ ] Seite unter `apps/web/src/app/(app)/<modul>/`
- [ ] Icon in `nav-icon.tsx` registriert
- [ ] Einstellungen über `settingsFields` beschrieben (die Seite entsteht automatisch)
- [ ] Tests (Unit + Integration)
- [ ] `npm run check` läuft fehlerfrei

---

## 10a. Beispiel: Vote Jail als Aufsatz auf ein bestehendes Modul

Vote Jail zeigt, wie eine neue Funktion in ein vorhandenes Modul integriert wird, statt daneben
ein zweites System zu bauen:

```
packages/modules/src/jail/vote/
  service.ts   Abstimmung starten, Stimmen zählen, Ergebnis ausführen
  embed.ts     Discord-Darstellung inkl. Button
  queries.ts   Leseseite für das Dashboard
```

Entscheidende Punkte:

- **Keine zweite Jail-Logik.** Bei Erfolg ruft `completeSuccessfulVote` den bestehenden
  `createJail`-Service auf - Moderation Policy, Rollen-Snapshot, Idempotenz und Audit Log gelten
  unverändert.
- **Berechtigungen über die Registry.** `jail.vote.start` und `jail.vote.multivote` sind normale
  Permissions und im Dashboard zuweisbar. Ob jemand mehrfach stimmen darf, entscheidet nie eine
  hart codierte ID.
- **Zustand in der Datenbank.** Abstimmungen und Stimmen liegen in `VoteJail`/`VoteJailVote`,
  nicht im Speicher - ein Neustart verliert nichts.
- **Nebenläufigkeit.** Die Zählung läuft in einer Transaktion mit Zeilensperre; der Statuswechsel
  auf `SUCCEEDED` passiert in derselben Transaktion wie die entscheidende Stimme.
- **Discord-Interaktionen im Bot.** `apps/bot/src/vote-jail.ts` nimmt Button-Klicks entgegen und
  ruft ausschliesslich Modulfunktionen auf - die Fachlogik bleibt im Modul.

## 10b. Beispiel: Slash Commands als Adapter

Die Discord-Befehle des Jail-Moduls (`/jail`, `/silent_jail`, `/jail_free`, `/jail_list`,
`/vote_jail`) liegen in `apps/bot/src/commands/` und enthalten **keine** Jail-Logik. Jeder Befehl
folgt derselben Kette:

```
Interaktion -> Berechtigung -> Eingabe prüfen -> Service -> Antwort
```

- **Ein Service für zwei Oberflächen.** `handleJailCommand` ruft `jail.createJail`,
  `jail.releaseJail` und `jail.startVoteJail` auf - dieselben Funktionen wie die Server Actions
  des Dashboards. Ein Unique-Constraint, ein Audit-Eintrag, ein Rollen-Snapshot.
- **Berechtigungen aus derselben Zuordnung.** `buildCommandActor` löst die Rollen des Aufrufers
  über `loadRoleConfiguration`/`resolvePermissions` auf. Es gibt keine Admin-Rollen-ID im Code.
- **Konfiguration aus dem Dashboard.** Jail-Rolle, Channels, Vorlagen und Grenzwerte kommen aus
  den Moduleinstellungen; eine Änderung wirkt ohne Neustart des Bots.
- **Registrierung pro Guild.** `registerJailCommands` setzt die Befehlsliste vollständig
  (`commands.set`) - entfernte Befehle verschwinden dadurch auch auf Discord.
- **Herkunft statt Sonderweg.** Der einzige Unterschied im Datensatz ist `source`
  (`DASHBOARD` / `SLASH_COMMAND` / `VOTE_JAIL` / `IMPORT` / `AUTO_RESTORE`).

Der Test `tests/integration/jail-shared-service.test.ts` prüft genau das: Ein über das Dashboard
angelegter Jail blockiert `/jail` und lässt sich mit `/jail_free` beenden.

## 10c. Beispiel: Datenübernahme aus einem Altsystem

`packages/modules/src/jail/import/` übernimmt die SQLite-Datenbank des früheren Jail-Bots. Der
Ablauf ist zweistufig und bis zur Bestätigung folgenlos:

```
reader.ts    Datei lesen (nur lesend, node:sqlite, feste Tabellenliste)
service.ts   analysieren -> bewerten -> bestätigen -> in einer Transaktion übernehmen
queries.ts   Leseseite für den Assistenten
```

- **Die Analyse verändert nichts.** Sie speichert nur ihr Ergebnis; Jails entstehen erst nach der
  ausdrücklichen Bestätigung.
- **Wiederholbar.** Jede Altzeile bekommt einen `legacyKey`; ein zweiter Durchgang erkennt sie
  wieder und legt nichts doppelt an.
- **Bestehende Daten bleiben.** Läuft für ein Mitglied bereits ein Jail, wird die Altzeile als
  Konflikt übersprungen statt überschrieben.
- **Untrusted Input.** Siehe [SECURITY.md](./SECURITY.md) - die Datei wird nie als SQL ausgeführt,
  nie verändert und nach dem Lesen gelöscht.

Details und die vollständige Feldabbildung: [JAIL_MIGRATION.md](./JAIL_MIGRATION.md).

## 10d. Beispiel: Spielersuche - ein Modul mit Discord-Zustand

Die Spielersuche ist das umfangreichste Modul und zeigt, wie ein Modul aussieht,
das dauerhaft Discord-Objekte verwaltet (Nachrichten, Sprachkanäle) statt nur
Rollen zu setzen:

```
packages/modules/src/spielersuche/
  config.ts       Moduldefinition, Berechtigungen, Einstellungen, Health Checks
  context.ts      Laufzeitkonfiguration an einem Ladepunkt
  schemas.ts      Eingabevalidierung (Dashboard und Slash Command gemeinsam)
  games.ts        Spieleverwaltung
  service.ts      Zentrale Engine: erstellen, beitreten, verlassen, beenden
  voice.ts        Sprachkanäle: anlegen, Rechte setzen, aufräumen
  embed.ts        Discord-Darstellung inkl. persistenter Knöpfe
  stats.ts        Nutzung, Voice-Zeit, Rangliste, Kennzahlen
  onboarding.ts   Tägliche Hinweisnachricht
  queries.ts      Leseseite für das Dashboard
  import/         Übernahme der alten SQLite-Datenbank
```

Entscheidende Punkte:

- **Ein Service, drei Oberflächen.** `createSearch` wird von der Server Action,
  vom Slash Command und (über `joinSearch`/`closeSearch`) von den Discord-Knöpfen
  aufgerufen. Die Oberflächen liefern einen Akteur und eine Eingabe, sonst nichts.
- **Grenzen in der Datenbank, nicht im Code.** Das Limit gleichzeitiger Suchen
  steckt im Unique-Index auf `activeCreatorKey` (`<discordId>#<Platznummer>`).
  Zwei gleichzeitige Anfragen können denselben Platz nicht beide belegen -
  unabhängig davon, wie schnell der Anwendungscode ist.
- **Nebenläufigkeit beim Beitritt.** Die Platzprüfung läuft in einer Transaktion
  mit `SELECT … FOR UPDATE` auf der Suche. Aus 4 von 5 wird nie 6 von 5.
- **Persistente Knöpfe.** Die Custom IDs sind stabil; die zugehörige Suche wird
  über die Nachrichten-ID nachgeschlagen. Dadurch funktionieren die Knöpfe nach
  einem Neustart - und die IDs des Vorgängersystems werden weiterhin erkannt.
- **Discord-Objekte gehören dem Modul.** Ein Sprachkanal wird nur gelöscht, wenn
  eine Suche in der Datenbank auf ihn zeigt. Fremde Kanäle bleiben unberührt.

Details zur Ablösung des Vorgängersystems:
[SPIELERSUCHE_MIGRATION.md](./SPIELERSUCHE_MIGRATION.md).

## 10e. Beispiel: XP-Verlosungen - ein Aufsatz mit eigener Mitgliederseite

Die XP-Verlosungen (`packages/modules/src/level/raffle/`) zeigen drei Muster,
die bei einer Erweiterung eines bestehenden Moduls wiederkehren.

**Kein zweites Konto.** Eine Verlosung bewegt XP, führt sie aber nicht selbst.
Gebucht wird über `applyXpWithin` - denselben Code, den Nachrichten, Voice und
die XP-Spiele verwenden. Wer eine zweite Tabelle mit Punkteständen anlegt, hat
ab dem ersten Tag zwei Wahrheiten.

**Eine fremde Transaktion mitbenutzen.** Abbuchung und Teilnahme müssen
zusammen stehen oder fallen. `applyXp` öffnet dafür eine eigene Transaktion -
zu wenig, wenn noch etwas anderes dazugehört. Der Kern liegt deshalb in
`applyXpWithin(tx, ...)`, das eine laufende Transaktion entgegennimmt. Ein
verschachteltes `prisma.$transaction` wäre kein Ersatz: es liefe auf einer
zweiten Verbindung und könnte sich mit der äusseren Zeilensperre verklemmen.

**Eine eigene Seite ausserhalb des Verwaltungsbereichs.** `/xp-gluecksrad`
richtet sich an alle Mitglieder, nicht an die Verwaltung. Der Eintrag steht
deshalb im Navigationsabschnitt `overview` statt unter `modules`, und die Seite
verwendet bewusst kein Verwaltungslayout. Fachlich gehört sie trotzdem zum
Level-Modul - es gibt kein zweites Modul "Gewinnspiel".

Dazu zwei Fallstricke, die erst im Browser sichtbar wurden und für jede
Komponente gelten, die Server und Client teilen:

- `toLocaleString('de-CH')` liefert je nach ICU-Fassung einen anderen
  Apostroph. Für geteilte Formatierer `formatSwissNumber` aus
  `@swisshub/shared` verwenden.
- `Math.cos`/`Math.sin` weichen zwischen Node und Browser im letzten Bit ab.
  Werte, die in Attribute geschrieben werden, vorher runden.

Beides führt sonst zu einem Hydration-Fehler, der nur in der Konsole steht.

## 10f. Beispiel: Kommunikation - was eine Seite beim Öffnen kosten darf

Das Kommunikationsmodul liess sich zeitweise nicht öffnen. Der Eintrag in der
Seitenleiste reagierte scheinbar nicht auf Klicks.

Die Ursache lag nicht in der Navigation, sondern in der Seite: Sie holte vor
dem Rendern für **jeden** Textkanal einzeln die Berechtigungen des Bots bei
Discord. Auf einem Server mit sechzig Kanälen sind das sechzig Anfragen, bevor
überhaupt etwas erscheint - unter Discords Ratenbegrenzung zehn Sekunden bis
Minuten. Für die bedienende Person sah das aus wie ein toter Link.

Die Lehre ist allgemein: **Was eine Seite beim Öffnen tut, gehört begrenzt.**

- Kein Aufwand, der mit der Zahl der Discord-Objekte wächst. Discord liefert
  die Rechte-Ausnahmen beim Abruf der Kanalliste ohnehin mit; sie lokal
  auszurechnen macht aus sechzig Anfragen eine.
- Was von Discord kommt, mit `.catch(() => …)` absichern. Ein nicht
  erreichbarer Discord-Server darf eine Seite höchstens unvollständig machen,
  nicht unerreichbar.
- Filter aus der Adresszeile nachsichtig lesen. Ein unsinniger Wert soll zum
  Standardwert führen, nicht zu einem Fehler.

Dazu gehört eine `error.tsx` **innerhalb** des Layouts. Die Fehlergrenze an
der Wurzel ersetzt sonst die gesamte Seite samt Seitenleiste - aus einem
Fehler in einem Modul wird dann eine Anwendung, aus der man nur noch über die
Adresszeile herausfindet.

Und auf der Client-Seite dieselbe Sorgfalt: Der Aufruf einer Server Action
gehört in `try`/`catch`/`finally`. Ohne `finally` bleibt der Ladezustand
stehen, sobald die Anfrage gar nicht erst durchkommt - Netzabbruch,
Serverfehler, abgelaufene Sitzung. Der Ablauf liegt deshalb in
`modules/communication/submit.ts` und ist als solcher geprüft.

## 11. Konventionen

1. **Keine Discord-Aufrufe ausserhalb der Service-Schicht.** UI und Route Handler rufen Services auf.
2. **Nie direkt nach Role-IDs fragen** - immer Permissions verwenden.
3. **Fail Closed**: fehlende Berechtigung, unklarer Zustand oder Discord-Ausfall verhindern die Aktion.
4. **Jede sicherheitsrelevante Aktion protokollieren** (`safeRecordAudit`).
5. **Zeiten in UTC speichern**, im UI mit `formatDateTime` in `Europe/Zurich` darstellen.
6. **Keine Buttons ohne Funktion** und keine Mock-Daten in Produktionspfaden.
7. **Dateien klein halten** - Services, Queries und Komponenten trennen.
