/**
 * In-Memory-Ersatz fuer `@swisshub/database`.
 *
 * Damit lassen sich die Integrationstests des Jail-Moduls ohne laufende
 * PostgreSQL-Instanz ausfuehren. Die fuer die Sicherheit entscheidenden
 * Eigenschaften werden bewusst nachgebildet:
 *   - Unique-Constraint auf `activeKey`  -> nur ein aktiver Jail pro Mitglied,
 *   - Unique-Constraint auf Idempotenzschluesseln,
 *   - `updateMany` mit Filter            -> atomares "Beanspruchen" des Release.
 */

export interface FakeJailEntry {
  id: string;
  targetDiscordId: string;
  targetUsername: string;
  targetDisplayName: string | null;
  moderatorDiscordId: string;
  moderatorUsername: string;
  reason: string;
  durationSeconds: number;
  startedAt: Date;
  endsAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface FakeManagedRole {
  discordRoleId: string;
  label: string;
  isProtected: boolean;
  keepOnJail: boolean;
  moderationLevel: number;
}

export interface FakeState {
  jails: FakeJailEntry[];
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

function matchesStatusFilter(value: unknown, filter: unknown): boolean {
  if (filter === null) {
    return value === null;
  }
  if (typeof filter === 'object' && filter !== null) {
    const criteria = filter as { in?: unknown[]; not?: unknown; lte?: Date; lt?: Date; gte?: Date };
    if (criteria.in) {
      return criteria.in.includes(value as never);
    }
    if ('not' in criteria) {
      return value !== criteria.not;
    }
    if (criteria.lte instanceof Date) {
      return value instanceof Date && value <= criteria.lte;
    }
    if (criteria.lt instanceof Date) {
      return value instanceof Date && value < criteria.lt;
    }
    if (criteria.gte instanceof Date) {
      return value instanceof Date && value >= criteria.gte;
    }
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

/** Erzeugt das Mock-Modul fuer `vi.mock('@swisshub/database', ...)`. */
export function createFakeDatabaseModule(state: FakeState) {
  const prisma = {
    async $transaction<T>(handler: (tx: unknown) => Promise<T>): Promise<T> {
      return handler(prisma);
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

        state.sequence += 1;
        const now = new Date();
        const entry: FakeJailEntry = {
          id: `jail-${state.sequence}`,
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
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        state.jails.push(entry);
        return { ...entry };
      },

      async update({ where, data }: { where: { id: string }; data: Partial<FakeJailEntry> }) {
        const entry = state.jails.find((item) => item.id === where.id);
        if (!entry) {
          throw new FakeKnownRequestError('P2025', 'Record not found');
        }
        Object.assign(entry, data, { updatedAt: new Date() });
        return { ...entry };
      },

      async updateMany({ where, data }: { where: Filter; data: Partial<FakeJailEntry> }) {
        const matching = state.jails.filter((entry) => matchesJail(entry, where));
        for (const entry of matching) {
          Object.assign(entry, data, { updatedAt: new Date() });
        }
        return { count: matching.length };
      },

      async findUnique({ where }: { where: { id?: string; activeKey?: string } }) {
        const entry = state.jails.find(
          (item) =>
            (where.id !== undefined && item.id === where.id) ||
            (where.activeKey !== undefined && item.activeKey === where.activeKey),
        );
        return entry ? { ...entry } : null;
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
    },

    rolePermission: {
      async findMany() {
        return state.rolePermissions.map((entry) => ({ ...entry }));
      },
      async upsert() {
        return null;
      },
      async deleteMany() {
        return { count: 0 };
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

    AUDIT_ACTIONS: {
      LOGIN: 'LOGIN',
      LOGIN_DENIED: 'LOGIN_DENIED',
      LOGOUT: 'LOGOUT',
      PERMISSION_DENIED: 'PERMISSION_DENIED',
      SETTING_CHANGED: 'SETTING_CHANGED',
      ROLE_MAPPING_CHANGED: 'ROLE_MAPPING_CHANGED',
      MODULE_ENABLED: 'MODULE_ENABLED',
      MODULE_DISABLED: 'MODULE_DISABLED',
      MODULE_SETTINGS_CHANGED: 'MODULE_SETTINGS_CHANGED',
      DISCORD_ACTION_FAILED: 'DISCORD_ACTION_FAILED',
      JAIL_CREATED: 'JAIL_CREATED',
      JAIL_RELEASED: 'JAIL_RELEASED',
      JAIL_FAILED: 'JAIL_FAILED',
      JAIL_RECONCILED: 'JAIL_RECONCILED',
      RECONCILIATION_RUN: 'RECONCILIATION_RUN',
    },

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

    async disconnectDatabase() {
      return undefined;
    },
  };
}
