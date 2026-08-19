# Module entwickeln

Diese Anleitung zeigt Schritt fuer Schritt, wie ein neues SwissHub-Modul entsteht.
Als durchgehendes Beispiel dient ein **Warnings-Modul** (Verwarnungen).

Ziel der Architektur: Ein neues Modul soll an **einer** Stelle beschrieben werden und
anschliessend automatisch in Navigation, Berechtigungsverwaltung, Modulverwaltung und
Dashboard erscheinen.

---

## 1. Ueberblick

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

`packages/database/prisma/schema.prisma` ergaenzen:

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

Grundsaetze: Zeiten in UTC, Unique-Constraints fuer Idempotenz und fachliche Eindeutigkeit,
Indizes fuer die Felder, nach denen gefiltert wird.

---

## 3. Schritt 2: Moduldefinition

`packages/modules/src/warnings/config.ts`:

```ts
import { z } from 'zod';
import { optionalSnowflakeSchema } from '@swisshub/shared';
import { registerModule, type ModuleDefinition } from '../registry';

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

export const warningsModule: ModuleDefinition = registerModule({
  id: WARNINGS_MODULE_ID,
  name: 'Verwarnungen',
  description: 'Verwarnungen aussprechen, einsehen und zuruecknehmen.',
  icon: 'ShieldAlert', // Name aus components/layout/nav-icon.tsx
  permissionPrefix: 'warnings',
  defaultEnabled: true,
  settingsSchema: warningsSettingsSchema,
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
  navigation: [
    {
      href: '/warnings',
      label: 'Verwarnungen',
      permission: WARNINGS_PERMISSIONS.view,
      icon: 'ShieldAlert',
      order: 35,
    },
  ],
});
```

Danach das Modul in `packages/modules/src/index.ts` importieren:

```ts
import './warnings/config';
```

**Das ist die einzige zentrale Aenderung.** Navigation, Permission Registry, Modulverwaltung und
die Berechtigungszuordnung in den Einstellungen kennen das Modul ab jetzt automatisch.

> Neues Icon noetig? In `apps/web/src/components/layout/nav-icon.tsx` in die `ICONS`-Zuordnung
> aufnehmen (bewusst eine feste Liste - so bleibt das Bundle klein).

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

`packages/modules/src/warnings/service.ts` - hier gehoert die gesamte Fachlogik hin
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

  // 1. Ziel immer frisch laden - Rollen koennen sich geaendert haben.
  const target = await gateway.members.get(input.targetDiscordId);
  const configuration = await loadRoleConfiguration();
  const [guildRoles, botHighestPosition, botIdentity, guild] = await Promise.all([
    gateway.roles.list({ force: true }),
    gateway.bot.highestRolePosition(),
    gateway.bot.identity(),
    gateway.guild.get(),
  ]);

  // 2. Zentrale Moderation Policy verwenden - nicht selbst nachbauen.
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
    throw policyViolation(decision.message ?? 'Aktion nicht zulaessig.');
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

Fuehrt das Modul echte Discord-Aktionen aus, gilt zusaetzlich das Muster aus
`packages/modules/src/jail/service.ts`: Status `PENDING -> EXECUTING -> COMPLETED/PARTIAL/FAILED`,
Fehler-Mapping ueber `mapDiscordError`, Benachrichtigungen als "best effort".

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

`defineAction` uebernimmt automatisch: Session, Guild-Mitgliedschaft, CSRF, Rate Limit,
Zod-Validierung, Permission-Pruefung, einheitliche Fehlerbehandlung und `ActionResult`.

Braucht das Modul ein eigenes Rate-Limit-Kontingent, in
`apps/web/src/server/rate-limit.ts` unter `RATE_LIMITS` ergaenzen.

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

| Komponente                                                                 | Zweck                                   |
| -------------------------------------------------------------------------- | --------------------------------------- |
| `PageHeader`                                                               | Titel, Beschreibung, Aktionen           |
| `StatCard`                                                                 | Kennzahl mit Icon                       |
| `DataTable`                                                                | Tabelle inkl. Leerzustand               |
| `Pagination`                                                               | serverseitige Seitennavigation          |
| `MemberCard`, `DiscordAvatar`, `RoleBadge`                                 | Mitgliederdarstellung                   |
| `ConfirmationDialog`                                                       | Bestaetigung destruktiver Aktionen      |
| `StatusBadge`, `EmptyState`, `ErrorState`, `LoadingState`, `TableSkeleton` | Zustaende                               |
| `PermissionGuard`                                                          | UX-Filterung (keine Sicherheitsgrenze!) |
| `AuditEntry`                                                               | Audit-Eintrag                           |

Formulare in Client-Komponenten uebergeben immer `csrfToken` an die Server Action und melden das
Ergebnis per `toast` (`sonner`).

---

## 8. Schritt 7: Hintergrundjobs (optional)

Braucht das Modul zeitgesteuerte Arbeit (Ablauf, Erinnerungen, Abgleich), wird ein Job in
`apps/bot/src/jobs.ts` ergaenzt:

```ts
{
  name: 'warnings-expiry',
  intervalMs: 60_000,
  async run() {
    await warnings.expireOldWarnings();
  },
},
```

Regeln: idempotent arbeiten, Datenbank als Source of Truth, kein `setTimeout` fuer Fristen,
Batchgroessen begrenzen (Discord Rate Limits).

---

## 9. Schritt 8: Tests

```
tests/unit/warnings-validation.test.ts     Schemas und Grenzwerte
tests/integration/warnings-service.test.ts Service mit Mock-Gateway und Fake-Datenbank
```

Discord ist ueber `createMockGateway()` bzw. eigene `DiscordGateway`-Objekte mockbar; fuer die
Datenbank existiert `tests/helpers/fake-database.ts` (bildet Unique-Constraints nach).
Mindestens abdecken: Erfolgsfall, fehlende Berechtigung, Policy-Verstoss, doppelte Ausfuehrung,
Fehlerfall der Discord-API.

---

## 10. Checkliste fuer ein neues Modul

- [ ] Datenbankmodell + Migration
- [ ] `config.ts` mit `registerModule(...)`, Permissions und Einstellungen
- [ ] Import in `packages/modules/src/index.ts`
- [ ] Zod-Schemas fuer alle Eingaben
- [ ] Service mit Moderation Policy, Idempotenz und Audit Log
- [ ] Server Actions ueber `defineAction`
- [ ] Seite unter `apps/web/src/app/(app)/<modul>/`
- [ ] Icon in `nav-icon.tsx` registriert
- [ ] Einstellungen im UI (falls noetig)
- [ ] Tests (Unit + Integration)
- [ ] `npm run check` laeuft fehlerfrei

---

## 11. Konventionen

1. **Keine Discord-Aufrufe ausserhalb der Service-Schicht.** UI und Route Handler rufen Services auf.
2. **Nie direkt nach Role-IDs fragen** - immer Permissions verwenden.
3. **Fail Closed**: fehlende Berechtigung, unklarer Zustand oder Discord-Ausfall verhindern die Aktion.
4. **Jede sicherheitsrelevante Aktion protokollieren** (`safeRecordAudit`).
5. **Zeiten in UTC speichern**, im UI mit `formatDateTime` in `Europe/Zurich` darstellen.
6. **Keine Buttons ohne Funktion** und keine Mock-Daten in Produktionspfaden.
7. **Dateien klein halten** - Services, Queries und Komponenten trennen.
