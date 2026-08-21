import { AUDIT_ACTIONS } from '../../packages/database/src/audit-actions';

/**
 * In-Memory-Ersatz für `@swisshub/database`.
 *
 * Damit lassen sich die Integrationstests des Jail-Moduls ohne laufende
 * PostgreSQL-Instanz ausführen. Die für die Sicherheit entscheidenden
 * Eigenschaften werden bewusst nachgebildet:
 *   - Unique-Constraint auf `activeKey`  -> nur ein aktiver Jail pro Mitglied,
 *   - Unique-Constraint auf Idempotenzschlüsseln,
 *   - `updateMany` mit Filter            -> atomares "Beanspruchen" des Release.
 */

export interface FakeJailEntry {
  id: string;
  type: string;
  targetDiscordId: string;
  targetUsername: string;
  targetDisplayName: string | null;
  moderatorDiscordId: string;
  moderatorUsername: string;
  reason: string;
  durationSeconds: number | null;
  startedAt: Date;
  endsAt: Date | null;
  releasedAt: Date | null;
  releaseType: string | null;
  releasedByDiscordId: string | null;
  releasedByUsername: string | null;
  roleSnapshot: string[];
  keptRoleIds: string[];
  restoredRoleIds: string[];
  failedRoleIds: string[];
  status: string;
  releaseStatus: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  activeKey: string | null;
  idempotencyKey: string | null;
  lifecycle: string;
  source: string;
  silent: boolean;
  voiceDisconnected: boolean;
  leftGuildAt: Date | null;
  reappliedCount: number;
  legacyKey: string | null;
  importId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeJailRoleSnapshot {
  id: string;
  jailId: string;
  roleId: string;
  roleNameAtTime: string | null;
  rolePositionAtTime: number | null;
  managedAtTime: boolean;
  kept: boolean;
  restoredAt: Date | null;
  restoreFailedCode: string | null;
}

export interface FakeVoteJailCooldown {
  id: string;
  discordId: string;
  username: string | null;
  lastVoteJailId: string | null;
  startedAt: Date;
  expiresAt: Date;
}

export interface FakeManagedRole {
  discordRoleId: string;
  label: string;
  isProtected: boolean;
  keepOnJail: boolean;
  moderationLevel: number;
}

export interface FakeGuildConfig {
  id: string;
  guildId: string;
  name: string | null;
  iconHash: string | null;
  ownerId: string | null;
  memberCount: number | null;
  presenceCount: number | null;
  lastSyncedAt: Date | null;
  setupCompletedAt: Date | null;
  setupCompletedBy: string | null;
}

export interface FakeRoleCache {
  roleId: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  hoist: boolean;
  permissions: string;
  syncedAt: Date;
  deletedAt: Date | null;
}

export interface FakeChannelCache {
  channelId: string;
  name: string;
  type: number;
  parentId: string | null;
  position: number;
  nsfw: boolean;
  syncedAt: Date;
  deletedAt: Date | null;
}

export interface FakeVoteJail {
  id: string;
  targetDiscordId: string;
  targetUsername: string;
  targetDisplayName: string | null;
  targetAvatarHash: string | null;
  startedByDiscordId: string;
  startedByUsername: string;
  startedByAvatarHash: string | null;
  reason: string | null;
  status: string;
  requiredVotes: number;
  voteCount: number;
  resultingJailMinutes: number;
  discordChannelId: string | null;
  discordMessageId: string | null;
  resultingJailId: string | null;
  activeKey: string | null;
  createdAt: Date;
  expiresAt: Date;
  finishedAt: Date | null;
}

export interface FakeVoteJailVote {
  id: string;
  voteJailId: string;
  voterDiscordId: string;
  voterUsername: string | null;
  voteNumber: number;
  isAdminVote: boolean;
  createdAt: Date;
}

export interface FakeState {
  jails: FakeJailEntry[];
  voteJails: FakeVoteJail[];
  voteJailVotes: FakeVoteJailVote[];
  voteJailCooldowns: FakeVoteJailCooldown[];
  jailRoleSnapshots: FakeJailRoleSnapshot[];
  jailImports: Array<Record<string, unknown>>;
  jailImportRows: Array<Record<string, unknown>>;
  communicationMessages: Array<Record<string, unknown>>;
  communicationDrafts: Array<Record<string, unknown>>;
  managedRoles: FakeManagedRole[];
  rolePermissions: Array<{ discordRoleId: string; permission: string }>;
  moduleSettings: Record<string, unknown>;
  moduleEnabled: Record<string, boolean>;
  systemConfig: Record<string, unknown>;
  audits: Array<Record<string, unknown>>;
  securityEvents: Array<Record<string, unknown>>;
  moderationActions: Array<Record<string, unknown>>;
  idempotency: Map<string, { status: string; resultRef: string | null; createdAt: Date }>;
  reconciliationRuns: Array<Record<string, unknown>>;
  guildConfig: FakeGuildConfig | null;
  roleCache: FakeRoleCache[];
  channelCache: FakeChannelCache[];
  syncRuns: Array<Record<string, unknown>>;
  configRevision: bigint;
  sequence: number;
}

export function createFakeState(): FakeState {
  return {
    jails: [],
    managedRoles: [],
    rolePermissions: [],
    moduleSettings: {},
    moduleEnabled: {},
    systemConfig: {},
    audits: [],
    securityEvents: [],
    moderationActions: [],
    idempotency: new Map(),
    reconciliationRuns: [],
    voteJails: [],
    voteJailVotes: [],
    voteJailCooldowns: [],
    jailRoleSnapshots: [],
    jailImports: [],
    jailImportRows: [],
    communicationMessages: [],
    communicationDrafts: [],
    guildConfig: null,
    roleCache: [],
    channelCache: [],
    syncRuns: [],
    configRevision: 1n,
    sequence: 0,
  };
}

class FakeKnownRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
  }
}

type Filter = Record<string, unknown>;

/**
 * Prisma-Filter nachbilden.
 *
 * Wichtig: ALLE angegebenen Operatoren müssen zutreffen. Prisma kombiniert
 * z.B. `{ not: null, lte: date }` mit UND - würde hier nur der erste Operator
 * geprüft, liefe der Test an der echten Abfrage vorbei.
 */
function matchesStatusFilter(value: unknown, filter: unknown): boolean {
  if (filter === null) {
    return value === null;
  }
  if (typeof filter === 'object' && filter !== null && !(filter instanceof Date)) {
    const criteria = filter as {
      in?: unknown[];
      notIn?: unknown[];
      not?: unknown;
      lte?: Date;
      lt?: Date;
      gte?: Date;
      gt?: Date;
    };

    if (criteria.in !== undefined && !criteria.in.includes(value as never)) {
      return false;
    }
    if (criteria.notIn !== undefined && criteria.notIn.includes(value as never)) {
      return false;
    }
    if ('not' in criteria && value === criteria.not) {
      return false;
    }
    if (criteria.lte instanceof Date && !(value instanceof Date && value <= criteria.lte)) {
      return false;
    }
    if (criteria.lt instanceof Date && !(value instanceof Date && value < criteria.lt)) {
      return false;
    }
    if (criteria.gte instanceof Date && !(value instanceof Date && value >= criteria.gte)) {
      return false;
    }
    if (criteria.gt instanceof Date && !(value instanceof Date && value > criteria.gt)) {
      return false;
    }
    return true;
  }
  return value === filter;
}

function matchesJail(entry: FakeJailEntry, where: Filter): boolean {
  return Object.entries(where).every(([key, filter]) => {
    if (key === 'OR') {
      return (filter as Filter[]).some((sub) => matchesJail(entry, sub));
    }
    if (key === 'AND') {
      return (filter as Filter[]).every((sub) => matchesJail(entry, sub));
    }
    return matchesStatusFilter((entry as unknown as Record<string, unknown>)[key], filter);
  });
}

/** Generischer Filter-Abgleich für Tabellen ohne eigene Matcher-Funktion. */
function matchesGeneric(entry: Record<string, unknown>, where: Filter): boolean {
  return Object.entries(where).every(([key, filter]) => matchesStatusFilter(entry[key], filter));
}

/** Erzeugt das Mock-Modul für `vi.mock('@swisshub/database', ...)`. */
export function createFakeDatabaseModule(state: FakeState) {
  const prisma = {
    async $transaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      return handler(prisma);
    },

    /**
     * `SELECT ... FOR UPDATE` gibt es in der In-Memory-Variante nicht. Für die
     * Tests genügt es, die abgefragte Zeile zurückzugeben - die eigentliche
     * Nebenläufigkeit wird durch die Reihenfolge der Aufrufe simuliert.
     */
    async $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      const id = values[0] as string;
      const entry = state.voteJails.find((item) => item.id === id);
      void strings;
      return (entry ? [{ id: entry.id, status: entry.status }] : []) as T;
    },
    jailEntry: {
      async create({ data }: { data: Partial<FakeJailEntry> }): Promise<FakeJailEntry> {
        if (data.activeKey && state.jails.some((entry) => entry.activeKey === data.activeKey)) {
          throw new FakeKnownRequestError('P2002', 'Unique constraint failed on activeKey');
        }
        if (
          data.idempotencyKey &&
          state.jails.some((entry) => entry.idempotencyKey === data.idempotencyKey)
        ) {
          throw new FakeKnownRequestError('P2002', 'Unique constraint failed on idempotencyKey');
        }

        if (data.legacyKey && state.jails.some((entry) => entry.legacyKey === data.legacyKey)) {
          throw new FakeKnownRequestError('P2002', 'Unique constraint failed on legacyKey');
        }

        state.sequence += 1;
        const now = new Date();
        // Verschachteltes `create` der Rollen-Snapshot-Zeilen abtrennen -
        // gespeichert wird es weiter unten in der eigenen Sammlung.
        const { roleSnapshotEntries, ...scalars } = data as Partial<FakeJailEntry> & {
          roleSnapshotEntries?: { create: Array<Partial<FakeJailRoleSnapshot>> };
        };
        const entry: FakeJailEntry = {
          id: `jail-${state.sequence}`,
          type: 'TEMPORARY',
          targetDiscordId: '',
          targetUsername: '',
          targetDisplayName: null,
          moderatorDiscordId: '',
          moderatorUsername: '',
          reason: '',
          durationSeconds: 0,
          startedAt: now,
          endsAt: now,
          releasedAt: null,
          releaseType: null,
          releasedByDiscordId: null,
          releasedByUsername: null,
          roleSnapshot: [],
          keptRoleIds: [],
          restoredRoleIds: [],
          failedRoleIds: [],
          status: 'PENDING',
          releaseStatus: null,
          errorCode: null,
          errorMessage: null,
          activeKey: null,
          idempotencyKey: null,
          lifecycle: 'PENDING',
          source: 'DASHBOARD',
          silent: false,
          voiceDisconnected: false,
          leftGuildAt: null,
          reappliedCount: 0,
          legacyKey: null,
          importId: null,
          createdAt: now,
          updatedAt: now,
          ...scalars,
        };
        state.jails.push(entry);

        for (const row of roleSnapshotEntries?.create ?? []) {
          state.jailRoleSnapshots.push({
            id: `snapshot-${state.jailRoleSnapshots.length + 1}`,
            jailId: entry.id,
            roleId: '',
            roleNameAtTime: null,
            rolePositionAtTime: null,
            managedAtTime: false,
            kept: false,
            restoredAt: null,
            restoreFailedCode: null,
            ...row,
          });
        }

        return { ...entry };
      },

      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const entry = state.jails.find((item) => item.id === where.id);
        if (!entry) {
          throw new FakeKnownRequestError('P2025', 'Record not found');
        }
        // Prisma erlaubt `{ increment: n }` statt eines festen Werts.
        const resolved: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && 'increment' in value) {
            const current = (entry as unknown as Record<string, number>)[key] ?? 0;
            resolved[key] = current + Number((value as { increment: number }).increment);
          } else {
            resolved[key] = value;
          }
        }
        Object.assign(entry, resolved, { updatedAt: new Date() });
        return { ...entry };
      },

      async updateMany({ where, data }: { where: Filter; data: Partial<FakeJailEntry> }) {
        const matching = state.jails.filter((entry) => matchesJail(entry, where));
        for (const entry of matching) {
          Object.assign(entry, data, { updatedAt: new Date() });
        }
        return { count: matching.length };
      },

      async findUnique({
        where,
        include,
      }: {
        where: { id?: string; activeKey?: string; legacyKey?: string };
        include?: { roleSnapshotEntries?: unknown };
      }) {
        const entry = state.jails.find(
          (item) =>
            (where.id !== undefined && item.id === where.id) ||
            (where.activeKey !== undefined && item.activeKey === where.activeKey) ||
            (where.legacyKey !== undefined && item.legacyKey === where.legacyKey),
        );
        if (!entry) {
          return null;
        }
        return include?.roleSnapshotEntries
          ? {
              ...entry,
              roleSnapshotEntries: state.jailRoleSnapshots
                .filter((row) => row.jailId === entry.id)
                .map((row) => ({ ...row })),
            }
          : { ...entry };
      },

      async findFirst({ where }: { where?: Filter } = {}) {
        const entry = state.jails.find((item) => (where ? matchesJail(item, where) : true));
        return entry ? { ...entry } : null;
      },

      async findMany({
        where,
        take,
      }: { where?: Filter; take?: number; orderBy?: unknown; select?: unknown } = {}) {
        const matching = state.jails.filter((entry) => (where ? matchesJail(entry, where) : true));
        return (take ? matching.slice(0, take) : matching).map((entry) => ({ ...entry }));
      },

      async count({ where }: { where?: Filter } = {}) {
        return state.jails.filter((entry) => (where ? matchesJail(entry, where) : true)).length;
      },
    },

    jailRoleSnapshot: {
      async createMany({ data }: { data: Array<Partial<FakeJailRoleSnapshot>> }) {
        for (const row of data) {
          state.jailRoleSnapshots.push({
            id: `snapshot-${state.jailRoleSnapshots.length + 1}`,
            jailId: '',
            roleId: '',
            roleNameAtTime: null,
            rolePositionAtTime: null,
            managedAtTime: false,
            kept: false,
            restoredAt: null,
            restoreFailedCode: null,
            ...row,
          });
        }
        return { count: data.length };
      },
      async updateMany({
        where,
        data,
      }: {
        where: { jailId?: string; roleId?: { in: string[] } };
        data: Partial<FakeJailRoleSnapshot>;
      }) {
        const matching = state.jailRoleSnapshots.filter(
          (row) =>
            (where.jailId === undefined || row.jailId === where.jailId) &&
            (where.roleId === undefined || where.roleId.in.includes(row.roleId)),
        );
        for (const row of matching) {
          Object.assign(row, data);
        }
        return { count: matching.length };
      },
      async findMany({ where }: { where?: { jailId?: string } } = {}) {
        return state.jailRoleSnapshots
          .filter((row) => (where?.jailId === undefined ? true : row.jailId === where.jailId))
          .map((row) => ({ ...row }));
      },
      async count({ where }: { where?: { jailId?: string } } = {}) {
        return state.jailRoleSnapshots.filter((row) =>
          where?.jailId === undefined ? true : row.jailId === where.jailId,
        ).length;
      },
    },

    voteJailCooldown: {
      async findUnique({ where }: { where: { discordId: string } }) {
        const entry = state.voteJailCooldowns.find((row) => row.discordId === where.discordId);
        return entry ? { ...entry } : null;
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { discordId: string };
        create: Partial<FakeVoteJailCooldown>;
        update: Partial<FakeVoteJailCooldown> & { expiresAt?: Date | { set: Date } };
      }) {
        const existing = state.voteJailCooldowns.find((row) => row.discordId === where.discordId);
        if (existing) {
          const { expiresAt, ...rest } = update;
          Object.assign(existing, rest, {
            expiresAt:
              expiresAt && typeof expiresAt === 'object' && 'set' in expiresAt
                ? expiresAt.set
                : (expiresAt ?? existing.expiresAt),
          });
          return { ...existing };
        }
        const entry: FakeVoteJailCooldown = {
          id: `cooldown-${state.voteJailCooldowns.length + 1}`,
          discordId: where.discordId,
          username: null,
          lastVoteJailId: null,
          startedAt: new Date(),
          expiresAt: new Date(),
          ...create,
        };
        state.voteJailCooldowns.push(entry);
        return { ...entry };
      },
      async deleteMany({ where }: { where?: Filter } = {}) {
        const before = state.voteJailCooldowns.length;
        state.voteJailCooldowns = state.voteJailCooldowns.filter(
          (row) => !(where ? matchesJail(row as unknown as FakeJailEntry, where) : true),
        );
        return { count: before - state.voteJailCooldowns.length };
      },
      async count() {
        return state.voteJailCooldowns.length;
      },
    },

    jailImport: {
      async create({ data }: { data: Record<string, unknown> }) {
        const { rows, ...scalars } = data as Record<string, unknown> & {
          rows?: { create: Array<Record<string, unknown>> };
        };
        const entry: Record<string, unknown> = {
          id: `import-${state.jailImports.length + 1}`,
          status: 'ANALYSED',
          totalRows: 0,
          importableRows: 0,
          duplicateRows: 0,
          releasedRows: 0,
          invalidRows: 0,
          conflictRows: 0,
          importedRows: 0,
          failedRows: 0,
          legacyBotStopped: false,
          reconciledAt: null,
          reconcileSummary: null,
          confirmedByDiscordId: null,
          confirmedAt: null,
          errorMessage: null,
          createdAt: new Date(),
          finishedAt: null,
          ...scalars,
        };
        state.jailImports.push(entry);

        const created = (rows?.create ?? []).map((row, index) => ({
          id: `import-row-${state.jailImportRows.length + index + 1}`,
          importId: entry.id,
          imported: false,
          jailId: null,
          createdAt: new Date(),
          ...row,
        }));
        state.jailImportRows.push(...created);

        return { ...entry, rows: created.map((row) => ({ ...row })) };
      },
      async findUnique({
        where,
        include,
      }: {
        where: { id: string };
        include?: { rows?: { where?: { action?: string } } };
      }) {
        const entry = state.jailImports.find((row) => row.id === where.id);
        if (!entry) {
          return null;
        }
        if (!include?.rows) {
          return { ...entry };
        }
        const action = include.rows.where?.action;
        return {
          ...entry,
          rows: state.jailImportRows
            .filter((row) => row.importId === entry.id && (action ? row.action === action : true))
            .map((row) => ({ ...row })),
        };
      },
      async findFirst({ where }: { where?: Filter } = {}) {
        const entry = state.jailImports.find((row) =>
          where ? matchesJail(row as unknown as FakeJailEntry, where) : true,
        );
        return entry ? { ...entry } : null;
      },
      async findMany() {
        return [...state.jailImports].reverse().map((row) => ({ ...row }));
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const entry = state.jailImports.find((row) => row.id === where.id);
        if (!entry) {
          throw new FakeKnownRequestError('P2025', 'Record not found');
        }
        Object.assign(entry, data);
        return { ...entry };
      },
      async updateMany({ where, data }: { where: Filter; data: Record<string, unknown> }) {
        const matching = state.jailImports.filter((row) =>
          matchesJail(row as unknown as FakeJailEntry, where),
        );
        for (const row of matching) {
          Object.assign(row, data);
        }
        return { count: matching.length };
      },
      async count({ where }: { where?: Filter } = {}) {
        return state.jailImports.filter((row) =>
          where ? matchesJail(row as unknown as FakeJailEntry, where) : true,
        ).length;
      },
    },

    jailImportRow: {
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const entry = state.jailImportRows.find((row) => row.id === where.id);
        if (!entry) {
          throw new FakeKnownRequestError('P2025', 'Record not found');
        }
        Object.assign(entry, data);
        return { ...entry };
      },
      async findMany({ where }: { where?: Filter } = {}) {
        return state.jailImportRows
          .filter((row) => (where ? matchesJail(row as unknown as FakeJailEntry, where) : true))
          .map((row) => ({ ...row }));
      },
      async count({ where }: { where?: Filter } = {}) {
        return state.jailImportRows.filter((row) =>
          where ? matchesJail(row as unknown as FakeJailEntry, where) : true,
        ).length;
      },
    },

    moderationAction: {
      async create({ data }: { data: Record<string, unknown> }) {
        const entry = { id: `action-${state.moderationActions.length + 1}`, createdAt: new Date(), ...data };
        state.moderationActions.push(entry);
        return entry;
      },
      async findMany() {
        return [...state.moderationActions];
      },
      async count() {
        return state.moderationActions.length;
      },
    },

    moduleState: {
      async findUnique({ where }: { where: { moduleId: string } }) {
        return {
          moduleId: where.moduleId,
          enabled: state.moduleEnabled[where.moduleId] ?? true,
          settings: state.moduleSettings[where.moduleId] ?? {},
          updatedAt: new Date(),
          updatedBy: null,
        };
      },
      async findMany() {
        return Object.keys(state.moduleSettings).map((moduleId) => ({
          moduleId,
          enabled: state.moduleEnabled[moduleId] ?? true,
          settings: state.moduleSettings[moduleId],
          updatedAt: new Date(),
          updatedBy: null,
        }));
      },
      async upsert({ where, create, update }: { where: { moduleId: string }; create: never; update: never }) {
        const data = { ...(create as object), ...(update as object) } as {
          settings?: unknown;
          enabled?: boolean;
        };
        if (data.settings !== undefined) {
          state.moduleSettings[where.moduleId] = data.settings;
        }
        if (data.enabled !== undefined) {
          state.moduleEnabled[where.moduleId] = data.enabled;
        }
        return { moduleId: where.moduleId, ...data };
      },
    },

    systemConfig: {
      async findUnique({ where }: { where: { key: string } }) {
        const value = state.systemConfig[where.key];
        return value === undefined ? null : { key: where.key, value, updatedAt: new Date(), updatedBy: null };
      },
      async upsert({ where, create }: { where: { key: string }; create: { value: unknown } }) {
        state.systemConfig[where.key] = create.value;
        return { key: where.key, value: create.value };
      },
      async create({ data }: { data: { key: string; value: unknown } }) {
        state.systemConfig[data.key] = data.value;
        return data;
      },
    },

    managedRole: {
      async findMany() {
        return state.managedRoles.map((role) => ({ ...role }));
      },
      async upsert() {
        return null;
      },
      async delete({ where }: { where: { discordRoleId: string } }) {
        const index = state.managedRoles.findIndex((role) => role.discordRoleId === where.discordRoleId);
        if (index >= 0) {
          state.managedRoles.splice(index, 1);
        }
        return null;
      },
    },

    rolePermission: {
      async findMany({ where }: { where?: { permission?: { in?: string[] } } } = {}) {
        const allowed = where?.permission?.in;
        return state.rolePermissions
          .filter((entry) => !allowed || allowed.includes(entry.permission))
          .map((entry) => ({ ...entry }));
      },
      async count({ where }: { where?: { permission?: { in?: string[] } } } = {}) {
        const allowed = where?.permission?.in;
        return state.rolePermissions.filter((entry) => !allowed || allowed.includes(entry.permission)).length;
      },
      async upsert() {
        return null;
      },
      async deleteMany() {
        return { count: 0 };
      },
    },

    guildConfig: {
      async findUnique() {
        return state.guildConfig ? { ...state.guildConfig } : null;
      },
      async create({ data }: { data: Partial<FakeGuildConfig> }) {
        state.guildConfig = {
          id: 'singleton',
          guildId: '',
          name: null,
          iconHash: null,
          ownerId: null,
          memberCount: null,
          presenceCount: null,
          lastSyncedAt: null,
          setupCompletedAt: null,
          setupCompletedBy: null,
          ...data,
        } as FakeGuildConfig;
        return { ...state.guildConfig };
      },
      async upsert({
        create,
        update,
      }: {
        create: Partial<FakeGuildConfig>;
        update: Partial<FakeGuildConfig>;
      }) {
        if (state.guildConfig) {
          Object.assign(state.guildConfig, update);
        } else {
          state.guildConfig = {
            id: 'singleton',
            guildId: '',
            name: null,
            iconHash: null,
            ownerId: null,
            memberCount: null,
            presenceCount: null,
            lastSyncedAt: null,
            setupCompletedAt: null,
            setupCompletedBy: null,
            ...create,
          } as FakeGuildConfig;
        }
        return { ...state.guildConfig };
      },
      async update({ data }: { data: Partial<FakeGuildConfig> }) {
        if (!state.guildConfig) {
          throw new FakeKnownRequestError('P2025', 'Record not found');
        }
        Object.assign(state.guildConfig, data);
        return { ...state.guildConfig };
      },
    },

    discordRoleCache: {
      async findMany() {
        return state.roleCache.map((role) => ({ ...role })).sort((a, b) => b.position - a.position);
      },
      async findUnique({ where }: { where: { roleId: string } }) {
        const role = state.roleCache.find((entry) => entry.roleId === where.roleId);
        return role ? { ...role } : null;
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { roleId: string };
        create: Partial<FakeRoleCache>;
        update: Partial<FakeRoleCache>;
      }) {
        const existing = state.roleCache.find((entry) => entry.roleId === where.roleId);
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const role = {
          roleId: where.roleId,
          name: '',
          color: 0,
          position: 0,
          managed: false,
          hoist: false,
          permissions: '0',
          syncedAt: new Date(),
          deletedAt: null,
          ...create,
        } as FakeRoleCache;
        state.roleCache.push(role);
        return { ...role };
      },
      async updateMany({
        where,
        data,
      }: {
        where: { roleId?: { notIn?: string[] }; deletedAt?: null };
        data: { deletedAt: Date };
      }) {
        const keep = where.roleId?.notIn ?? [];
        const matching = state.roleCache.filter(
          (entry) => !keep.includes(entry.roleId) && entry.deletedAt === null,
        );
        for (const entry of matching) {
          entry.deletedAt = data.deletedAt;
        }
        return { count: matching.length };
      },
      async count({ where }: { where?: { deletedAt?: null } } = {}) {
        return state.roleCache.filter((entry) => (where ? entry.deletedAt === null : true)).length;
      },
    },

    discordChannelCache: {
      async findMany() {
        return state.channelCache.map((channel) => ({ ...channel })).sort((a, b) => a.position - b.position);
      },
      async findUnique({ where }: { where: { channelId: string } }) {
        const channel = state.channelCache.find((entry) => entry.channelId === where.channelId);
        return channel ? { ...channel } : null;
      },
      async upsert({
        where,
        create,
        update,
      }: {
        where: { channelId: string };
        create: Partial<FakeChannelCache>;
        update: Partial<FakeChannelCache>;
      }) {
        const existing = state.channelCache.find((entry) => entry.channelId === where.channelId);
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const channel = {
          channelId: where.channelId,
          name: '',
          type: 0,
          parentId: null,
          position: 0,
          nsfw: false,
          syncedAt: new Date(),
          deletedAt: null,
          ...create,
        } as FakeChannelCache;
        state.channelCache.push(channel);
        return { ...channel };
      },
      async updateMany({
        where,
        data,
      }: {
        where: { channelId?: { notIn?: string[] }; deletedAt?: null };
        data: { deletedAt: Date };
      }) {
        const keep = where.channelId?.notIn ?? [];
        const matching = state.channelCache.filter(
          (entry) => !keep.includes(entry.channelId) && entry.deletedAt === null,
        );
        for (const entry of matching) {
          entry.deletedAt = data.deletedAt;
        }
        return { count: matching.length };
      },
      async count({ where }: { where?: { deletedAt?: null } } = {}) {
        return state.channelCache.filter((entry) => (where ? entry.deletedAt === null : true)).length;
      },
    },

    voteJail: {
      async create({ data }: { data: Partial<FakeVoteJail> }) {
        if (data.activeKey && state.voteJails.some((entry) => entry.activeKey === data.activeKey)) {
          throw new FakeKnownRequestError('P2002', 'Unique constraint failed on activeKey');
        }
        state.sequence += 1;
        const entry: FakeVoteJail = {
          id: `vote-${state.sequence}`,
          targetDiscordId: '',
          targetUsername: '',
          targetDisplayName: null,
          targetAvatarHash: null,
          startedByDiscordId: '',
          startedByUsername: '',
          startedByAvatarHash: null,
          reason: null,
          status: 'ACTIVE',
          requiredVotes: 5,
          voteCount: 0,
          resultingJailMinutes: 30,
          discordChannelId: null,
          discordMessageId: null,
          resultingJailId: null,
          activeKey: null,
          createdAt: new Date(),
          expiresAt: new Date(),
          finishedAt: null,
          ...data,
        };
        state.voteJails.push(entry);
        return { ...entry };
      },
      async findUnique({ where }: { where: { id?: string; activeKey?: string } }) {
        const entry = state.voteJails.find(
          (item) =>
            (where.id !== undefined && item.id === where.id) ||
            (where.activeKey !== undefined && item.activeKey === where.activeKey),
        );
        return entry ? { ...entry } : null;
      },
      async findUniqueOrThrow({ where }: { where: { id: string } }) {
        const entry = state.voteJails.find((item) => item.id === where.id);
        if (!entry) {
          throw new FakeKnownRequestError('P2025', 'Record not found');
        }
        return { ...entry };
      },
      async findMany({ where, take }: { where?: Filter; take?: number; orderBy?: unknown } = {}) {
        const matching = state.voteJails.filter((entry) =>
          where ? matchesGeneric(entry as unknown as Record<string, unknown>, where) : true,
        );
        return (take ? matching.slice(0, take) : matching).map((entry) => ({ ...entry }));
      },
      async update({ where, data }: { where: { id: string }; data: Partial<FakeVoteJail> }) {
        const entry = state.voteJails.find((item) => item.id === where.id);
        if (!entry) {
          throw new FakeKnownRequestError('P2025', 'Record not found');
        }
        Object.assign(entry, data);
        return { ...entry };
      },
      async count({ where }: { where?: Filter } = {}) {
        return state.voteJails.filter((entry) =>
          where ? matchesGeneric(entry as unknown as Record<string, unknown>, where) : true,
        ).length;
      },
    },

    voteJailVote: {
      async create({ data }: { data: Partial<FakeVoteJailVote> }) {
        const duplicate = state.voteJailVotes.some(
          (entry) =>
            entry.voteJailId === data.voteJailId &&
            entry.voterDiscordId === data.voterDiscordId &&
            entry.voteNumber === (data.voteNumber ?? 1),
        );
        if (duplicate) {
          throw new FakeKnownRequestError('P2002', 'Unique constraint failed');
        }
        state.sequence += 1;
        const entry: FakeVoteJailVote = {
          id: `votevote-${state.sequence}`,
          voteJailId: '',
          voterDiscordId: '',
          voterUsername: null,
          voteNumber: 1,
          isAdminVote: false,
          createdAt: new Date(),
          ...data,
        };
        state.voteJailVotes.push(entry);
        return { ...entry };
      },
      async count({ where }: { where?: { voteJailId?: string; voterDiscordId?: string } } = {}) {
        return state.voteJailVotes.filter(
          (entry) =>
            (where?.voteJailId === undefined || entry.voteJailId === where.voteJailId) &&
            (where?.voterDiscordId === undefined || entry.voterDiscordId === where.voterDiscordId),
        ).length;
      },
      async findMany({ where }: { where?: { voteJailId?: string } } = {}) {
        return state.voteJailVotes
          .filter((entry) => where?.voteJailId === undefined || entry.voteJailId === where.voteJailId)
          .map((entry) => ({ ...entry }));
      },
    },

    communicationDraft: {
      async create({ data }: { data: Record<string, unknown> }) {
        state.sequence += 1;
        const entry = {
          // Wie in der echten Datenbank eine CUID - die Eingabepruefung
          // erwartet dieses Format, und ein Test soll daran nicht scheitern,
          // sondern es mitpruefen.
          id: `c${state.sequence.toString().padStart(24, 'a')}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.communicationDrafts.push(entry);
        return { ...entry };
      },
      async findUnique({ where }: { where: { id: string } }) {
        const entry = state.communicationDrafts.find((item) => item.id === where.id);
        return entry ? { ...entry } : null;
      },
      async findMany({ where, take }: { where?: Filter; take?: number; orderBy?: unknown } = {}) {
        const owner = (where as { createdByDiscordId?: string } | undefined)?.createdByDiscordId;
        const all = state.communicationDrafts.filter(
          (entry) => owner === undefined || entry.createdByDiscordId === owner,
        );
        return (take ? all.slice(0, take) : all).map((entry) => ({ ...entry }));
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const entry = state.communicationDrafts.find((item) => item.id === where.id);
        if (!entry) {
          throw new FakeKnownRequestError('P2025', 'Record not found');
        }
        Object.assign(entry, data, { updatedAt: new Date() });
        return { ...entry };
      },
      async delete({ where }: { where: { id: string } }) {
        const index = state.communicationDrafts.findIndex((item) => item.id === where.id);
        if (index >= 0) {
          state.communicationDrafts.splice(index, 1);
        }
        return {};
      },
    },
    communicationMessage: {
      async create({ data }: { data: Record<string, unknown> }) {
        const key = data.idempotencyKey as string | undefined;
        if (key && state.communicationMessages.some((entry) => entry.idempotencyKey === key)) {
          throw new FakeKnownRequestError('P2002', 'Unique constraint failed');
        }
        state.sequence += 1;
        const entry = {
          id: `comm-${state.sequence}`,
          sentAt: new Date(),
          deletedAt: null,
          deletedByDiscordId: null,
          ...data,
        };
        state.communicationMessages.push(entry);
        return { ...entry };
      },
      async findUnique({ where }: { where: { id: string } }) {
        const entry = state.communicationMessages.find((item) => item.id === where.id);
        return entry ? { ...entry } : null;
      },
      async findMany({ take }: { where?: Filter; take?: number; orderBy?: unknown; skip?: number } = {}) {
        const all = [...state.communicationMessages].reverse();
        return (take ? all.slice(0, take) : all).map((entry) => ({ ...entry }));
      },
      async count() {
        return state.communicationMessages.length;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const entry = state.communicationMessages.find((item) => item.id === where.id);
        if (!entry) {
          throw new FakeKnownRequestError('P2025', 'Record not found');
        }
        Object.assign(entry, data);
        return { ...entry };
      },
    },

    syncRun: {
      async create({ data }: { data: Record<string, unknown> }) {
        const entry = { id: `sync-${state.syncRuns.length + 1}`, startedAt: new Date(), ...data };
        state.syncRuns.push(entry);
        return entry;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const entry = state.syncRuns.find((item) => item.id === where.id);
        if (entry) {
          Object.assign(entry, data);
        }
        return entry ?? null;
      },
      async findFirst() {
        return state.syncRuns.at(-1) ?? null;
      },
      async findMany() {
        return [...state.syncRuns];
      },
    },

    configRevision: {
      async findUnique() {
        return { id: 'singleton', revision: state.configRevision };
      },
      async upsert() {
        state.configRevision += 1n;
        return { id: 'singleton', revision: state.configRevision };
      },
    },

    reconciliationRun: {
      async create({ data }: { data: Record<string, unknown> }) {
        const entry = { id: `run-${state.reconciliationRuns.length + 1}`, ...data };
        state.reconciliationRuns.push(entry);
        return entry;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const entry = state.reconciliationRuns.find((item) => item.id === where.id);
        if (entry) {
          Object.assign(entry, data);
        }
        return entry ?? null;
      },
    },

    discordIdentityCache: {
      async findUnique() {
        return null;
      },
      async upsert() {
        return null;
      },
      async updateMany() {
        return { count: 0 };
      },
    },

    user: {
      async updateMany() {
        return { count: 0 };
      },
    },

    botStatus: {
      async findUnique() {
        return null;
      },
      async upsert() {
        return null;
      },
    },
  };

  return {
    prisma,
    Prisma: { PrismaClientKnownRequestError: FakeKnownRequestError },

    AUDIT_ACTIONS,

    SECURITY_EVENTS: {
      INVALID_SESSION: 'INVALID_SESSION',
      CSRF_FAILED: 'CSRF_FAILED',
      PERMISSION_DENIED: 'PERMISSION_DENIED',
      POLICY_VIOLATION: 'POLICY_VIOLATION',
      RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
      NOT_A_MEMBER: 'NOT_A_MEMBER',
      INVALID_INPUT: 'INVALID_INPUT',
    },

    async safeRecordAudit(input: Record<string, unknown>): Promise<void> {
      state.audits.push(input);
    },

    async recordAudit(input: Record<string, unknown>) {
      state.audits.push(input);
      return { id: `audit-${state.audits.length}`, hash: 'hash' };
    },

    async recordSecurityEvent(input: Record<string, unknown>): Promise<void> {
      state.securityEvents.push(input);
    },

    async claimIdempotencyKey(scope: string, key: string, actorDiscordId: string) {
      const fullKey = `${scope}:${key}`;
      const existing = state.idempotency.get(fullKey);
      if (existing) {
        return { status: 'duplicate' as const, existing };
      }
      state.idempotency.set(fullKey, { status: 'PENDING', resultRef: null, createdAt: new Date() });
      void actorDiscordId;
      return { status: 'claimed' as const };
    },

    async completeIdempotencyKey(scope: string, key: string, status: string, resultRef?: string) {
      const fullKey = `${scope}:${key}`;
      const existing = state.idempotency.get(fullKey);
      if (existing) {
        existing.status = status;
        existing.resultRef = resultRef ?? null;
      }
    },

    async releaseIdempotencyKey(scope: string, key: string) {
      state.idempotency.delete(`${scope}:${key}`);
    },

    async purgeExpiredIdempotencyKeys() {
      return 0;
    },

    async readConfigValue(
      key: string,
      schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
      fallback: unknown,
    ) {
      const value = state.systemConfig[key];
      if (value === undefined) {
        return fallback;
      }
      const parsed = schema.safeParse(value);
      return parsed.success ? parsed.data : fallback;
    },

    async writeConfigValue(key: string, schema: { parse(value: unknown): unknown }, value: unknown) {
      const parsed = schema.parse(value);
      state.systemConfig[key] = parsed;
      return parsed;
    },

    async ensureConfigValue() {
      return undefined;
    },

    async consumeRateLimit() {
      return { allowed: true, limit: 100, remaining: 99, resetAt: new Date(), retryAfterMs: 0 };
    },

    async checkDatabase() {
      return { ok: true, latencyMs: 1 };
    },

    async readConfigRevision() {
      return state.configRevision;
    },

    async bumpConfigRevision() {
      state.configRevision += 1n;
      return state.configRevision;
    },

    // Im Test wird bewusst nicht zwischengespeichert: jeder Aufruf liest den
    // aktuellen Zustand, damit Tests keine Cache-Effekte umgehen müssen.
    async revisionCache<T>(_key: string, loader: () => Promise<T>): Promise<T> {
      return loader();
    },

    clearRevisionCaches(): void {
      return undefined;
    },

    async disconnectDatabase() {
      return undefined;
    },
  };
}
