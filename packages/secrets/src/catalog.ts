import { z } from 'zod';

/**
 * Was sich zentral verwalten lässt.
 *
 * Der Katalog ist die einzige Stelle, an der eine Integration beschrieben
 * wird: Felder, Geheimhaltung, Prüfung, Bereich und - für die Übergangszeit -
 * die Umgebungsvariable, aus der ein Wert stammen darf, solange er noch nicht
 * in der Datenbank steht.
 *
 * Eine weitere Integration ist ein weiterer Eintrag hier. Oberfläche,
 * Speicherung, Verschlüsselung, Maskierung, Audit und ENV-Übernahme richten
 * sich danach - es gibt für einen neuen Anbieter nichts zu programmieren
 * ausser seinem Verbindungstest.
 */

export type IntegrationScope = 'GLOBAL' | 'GUILD';

export interface IntegrationField {
  key: string;
  label: string;
  description?: string;
  /**
   * Geheim heisst: verschlüsselt gespeichert, im Dashboard nur maskiert, nie
   * in einer Antwort, nie im Protokoll.
   */
  secret: boolean;
  required?: boolean;
  /** Feldtyp der Oberfläche. */
  type: 'password' | 'text' | 'url' | 'number' | 'boolean' | 'select';
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Prüfung des eingegebenen Werts. Bei Geheimnissen bewusst nachsichtig. */
  schema: z.ZodTypeAny;
  /** Vorgabe für nicht geheime Felder. */
  default?: string | number | boolean;
  /**
   * Umgebungsvariable, aus der dieser Wert übergangsweise gelesen werden darf.
   *
   * Sie ist der Rückfall (§39) und die Quelle der Übernahme (§40). Sobald ein
   * Wert in der Datenbank steht, gewinnt dieser.
   */
  envKey?: string;
}

export interface IntegrationDefinition {
  id: string;
  label: string;
  description: string;
  /** Symbol aus der Navigationsliste der WebApp. */
  icon: string;
  scope: IntegrationScope;
  /** Ohne diese Integration läuft nichts - trennt Pflicht von Kür (§44). */
  essential: boolean;
  fields: IntegrationField[];
  /** Kann die Verbindung tatsächlich geprüft werden? */
  testable: boolean;
}

/** Discord Snowflake - dieselbe Prüfung wie in der Umgebungsvalidierung. */
export const snowflake = z
  .string()
  .trim()
  .regex(/^\d{17,20}$/u, 'muss eine gültige Discord-ID sein (17-20 Ziffern)');

/**
 * Snowflake oder leer.
 *
 * Steht hier und nicht bei den Server Actions: eine Datei mit `'use server'`
 * darf auf oberster Ebene keine gewöhnlichen Funktionen enthalten, und eine
 * Zod-Prüfung mit `.refine()` ist genau das. Ein Schema gehört ohnehin zum
 * Katalog und nicht zur Aktion.
 */
export const snowflakeOderLeer = z
  .string()
  .trim()
  .max(20)
  .refine((wert) => wert === '' || /^\d{17,20}$/u.test(wert), 'muss eine Discord-ID sein');

/** Absolute https-Adresse oder leer. */
export const httpsOderLeer = z
  .string()
  .trim()
  .max(300)
  .refine(
    (wert) => wert === '' || /^https:\/\/[^\s]+$/u.test(wert),
    'muss eine absolute https-Adresse sein',
  );

/**
 * Ein Geheimnis wird bewusst nicht getrimmt und nicht umgeformt.
 *
 * Was der Anbieter ausgegeben hat, wird genau so gespeichert - ein
 * «hilfreiches» `trim()` auf einen Schlüssel, der auf ein Leerzeichen endet,
 * macht ihn ungültig, und der Fehler wäre später kaum zu finden. Geprüft wird
 * nur, dass überhaupt etwas dasteht und dass es nicht offensichtlich ein
 * Platzhalter ist.
 */
const geheimnis = (minLaenge: number, hinweis: string) =>
  z
    .string()
    .min(minLaenge, hinweis)
    .refine((wert) => wert.trim().length > 0, 'darf nicht nur aus Leerzeichen bestehen');

export const AI_PROVIDERS = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI' },
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number]['value'];

/** Vorschläge je Anbieter. Frei überschreibbar - die Liste ist keine Schranke. */
export const AI_MODEL_SUGGESTIONS: Record<AiProviderId, string[]> = {
  anthropic: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-5', 'gpt-5-mini'],
};

export const DISCORD_INTEGRATION_ID = 'discord';
export const AI_INTEGRATION_ID = 'ai';
export const MUSIC_INTEGRATION_ID = 'music';
export const PAYMENT_INTEGRATION_ID = 'payment';

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    id: DISCORD_INTEGRATION_ID,
    label: 'Discord',
    description: 'Zugangsdaten der Discord-Anwendung: Bot, Anmeldung und Server.',
    icon: 'Bot',
    scope: 'GLOBAL',
    essential: true,
    testable: true,
    fields: [
      {
        key: 'botToken',
        label: 'Bot Token',
        description:
          'Discord Developer Portal → Bot → Reset Token. Wird vor dem Übernehmen bei Discord geprüft.',
        secret: true,
        required: true,
        type: 'password',
        schema: geheimnis(20, 'sieht nicht wie ein gültiger Bot Token aus'),
        envKey: 'DISCORD_BOT_TOKEN',
      },
      {
        key: 'clientId',
        label: 'Client ID',
        description: 'Die Application ID derselben Anwendung. Kein Geheimnis.',
        secret: false,
        required: true,
        type: 'text',
        schema: snowflake,
        envKey: 'DISCORD_CLIENT_ID',
      },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        description: 'OAuth2 → Client Secret. Wird für die Anmeldung im Dashboard gebraucht.',
        secret: true,
        required: true,
        type: 'password',
        schema: geheimnis(10, 'wird benötigt'),
        envKey: 'DISCORD_CLIENT_SECRET',
      },
    ],
  },
  {
    id: AI_INTEGRATION_ID,
    label: 'AI',
    description: 'Anbieter, Schlüssel und Modell für alle AI-gestützten Funktionen.',
    icon: 'Sparkles',
    scope: 'GLOBAL',
    essential: false,
    testable: true,
    fields: [
      {
        key: 'enabled',
        label: 'AI aktiviert',
        description: 'Aus: kein Modul fragt ein Modell an, unabhängig von seinen Einstellungen.',
        secret: false,
        type: 'boolean',
        schema: z.boolean(),
        default: false,
      },
      {
        key: 'provider',
        label: 'Anbieter',
        secret: false,
        type: 'select',
        options: AI_PROVIDERS.map((entry) => ({ value: entry.value, label: entry.label })),
        schema: z.enum(['anthropic', 'openai']),
        default: 'anthropic',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        description: 'Wird verschlüsselt gespeichert und niemals angezeigt.',
        secret: true,
        required: true,
        type: 'password',
        schema: geheimnis(8, 'sieht nicht wie ein gültiger Schlüssel aus'),
        // Beide Namen werden bei der Übernahme berücksichtigt - welcher passt,
        // hängt am gewählten Anbieter. Siehe `envKeysFor`.
        envKey: 'ANTHROPIC_API_KEY',
      },
      {
        key: 'model',
        label: 'Modell',
        description: 'Vorschläge stehen im Feld; jedes vom Anbieter unterstützte Modell ist erlaubt.',
        secret: false,
        type: 'text',
        schema: z.string().trim().min(1, 'wird benötigt').max(120),
        default: 'claude-opus-5',
      },
      {
        key: 'baseUrl',
        label: 'Base URL',
        description: 'Nur nötig für einen Proxy oder eine kompatible Gegenstelle. Leer = Standard.',
        secret: false,
        type: 'url',
        schema: z
          .string()
          .trim()
          .max(300)
          .refine(
            (wert) => wert === '' || /^https:\/\/[^\s]+$/u.test(wert),
            'muss eine absolute https-Adresse sein',
          ),
        default: '',
      },
      {
        key: 'timeoutMs',
        label: 'Zeitlimit',
        secret: false,
        type: 'number',
        min: 1000,
        max: 120_000,
        step: 500,
        unit: 'ms',
        schema: z.number().int().min(1000).max(120_000),
        default: 20_000,
      },
      {
        key: 'maxTokens',
        label: 'Max Tokens',
        description: 'Obergrenze je Antwort. Begrenzt die Kosten einer einzelnen Anfrage.',
        secret: false,
        type: 'number',
        min: 16,
        max: 8192,
        step: 16,
        schema: z.number().int().min(16).max(8192),
        default: 256,
      },
    ],
  },
  {
    id: MUSIC_INTEGRATION_ID,
    label: 'Musik-Laufzeit',
    description: 'Adresse und gemeinsamer Schlüssel der Voice-Laufzeit.',
    icon: 'Music',
    scope: 'GLOBAL',
    essential: false,
    testable: true,
    fields: [
      {
        key: 'runtimeUrl',
        label: 'Adresse der Laufzeit',
        description: 'Im Docker-Netz, z.B. http://music-runtime:7700. Nach aussen nicht offen.',
        secret: false,
        type: 'url',
        schema: z
          .string()
          .trim()
          .max(300)
          .refine(
            (wert) => wert === '' || /^https?:\/\/[^\s]+$/u.test(wert),
            'muss eine absolute Adresse sein',
          ),
        default: '',
        envKey: 'MUSIC_RUNTIME_URL',
      },
      {
        key: 'runtimeKey',
        label: 'Gemeinsamer Schlüssel',
        description: 'Übertragen wird nur der SHA-256 des Schlüssels, nie er selbst.',
        secret: true,
        type: 'password',
        schema: geheimnis(8, 'zu kurz - eine lange Zufallszeichenkette verwenden'),
        envKey: 'MUSIC_RUNTIME_KEY',
      },
    ],
  },
  {
    id: PAYMENT_INTEGRATION_ID,
    label: 'Zahlungsanbieter',
    description: 'Zugangsdaten des Anbieters für SwissHub Premium.',
    icon: 'CreditCard',
    scope: 'GLOBAL',
    essential: false,
    testable: false,
    fields: [
      {
        key: 'provider',
        label: 'Anbieter',
        secret: false,
        type: 'select',
        options: [
          { value: 'mock', label: 'Mock (nur Entwicklung)' },
          { value: 'stripe', label: 'Stripe' },
        ],
        schema: z.enum(['mock', 'stripe']),
        default: 'mock',
        envKey: 'PAYMENT_PROVIDER',
      },
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        type: 'password',
        schema: geheimnis(8, 'wird benötigt'),
        envKey: 'PAYMENT_API_KEY',
      },
      {
        key: 'webhookSecret',
        label: 'Webhook Secret',
        secret: true,
        type: 'password',
        schema: geheimnis(8, 'wird benötigt'),
        envKey: 'PAYMENT_WEBHOOK_SECRET',
      },
    ],
  },
];

export function getIntegration(id: string): IntegrationDefinition | undefined {
  return INTEGRATIONS.find((entry) => entry.id === id);
}

export function getField(integrationId: string, key: string): IntegrationField | undefined {
  return getIntegration(integrationId)?.fields.find((field) => field.key === key);
}

/**
 * Alle Umgebungsvariablen, aus denen ein Feld stammen darf.
 *
 * Für den AI-Schlüssel sind es zwei: welche gilt, entscheidet der eingestellte
 * Anbieter. Ein einzelnes `envKey` würde bei OpenAI ins Leere greifen.
 */
export function envKeysFor(integrationId: string, key: string, provider?: string): string[] {
  if (integrationId === AI_INTEGRATION_ID && key === 'apiKey') {
    return provider === 'openai'
      ? ['OPENAI_API_KEY']
      : provider === 'anthropic'
        ? ['ANTHROPIC_API_KEY']
        : ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];
  }
  const feld = getField(integrationId, key);
  return feld?.envKey ? [feld.envKey] : [];
}

/** Die Präfix-Form, unter der ein Bot-Token gespeichert wird. */
export const botProvider = (botId: string): string => `bot:${botId}`;

/** Feldname des Tokens innerhalb eines Bot-Anbieters. */
export const BOT_TOKEN_FIELD = 'token';
