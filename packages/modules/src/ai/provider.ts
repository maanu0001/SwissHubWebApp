import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { createLogger } from '@swisshub/logger';
import { AI_INTEGRATION_ID, getSecret } from '@swisshub/secrets';
import { readAiSettings, type AiSettings } from './settings';

const logger = createLogger('ai:provider');

/**
 * Der eine Weg zu einem Modell.
 *
 * Jedes Modul, das etwas von einer AI will, kommt hier durch - es gibt kein
 * zweites `new Anthropic(...)` im Projekt und kein Modul mit eigenem
 * Schlüsselfeld (§28). Anbieter, Modell, Adresse und Zeitlimit stehen zentral;
 * ein Modul bringt seine Aufgabe mit und sonst nichts.
 *
 * ## Was hier nicht passiert
 *
 * Kein Werkzeuggebrauch, keine Zustandsführung, kein Gedächtnis. Eine Anfrage,
 * eine Antwort, ein Schema. Ein Modell kann über diesen Weg nichts auslösen -
 * es kann nur antworten, und ob aus der Antwort etwas folgt, entscheidet der
 * Aufrufer.
 *
 * ## Fehler
 *
 * `strukturierteAntwort` wirft nicht. Jeder Fehlschlag - kein Schlüssel,
 * Zeitüberschreitung, Ratengrenze, unbrauchbare Antwort - kommt als
 * `{ ok: false, error }` zurück, mit einem kurzen, bereinigten Text ohne
 * Anbieter-Rohantwort (§47).
 */

/** Ein JSON-Schema, wie es beide Anbieter als Antwortformat entgegennehmen. */
export interface JsonSchema {
  // Beide SDKs erwarten ein offenes Objekt fuer das Schema. Die Indexsignatur
  // ist genau das - die vier benannten Felder bleiben trotzdem verlangt.
  [feld: string]: unknown;
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: false;
}

export interface StrukturAnfrage {
  /** Was das Modell tun soll. Enthält nie fremden Text. */
  system: string;
  /** Der Auftrag samt eingebettetem, klar abgegrenztem Prüfmaterial. */
  user: string;
  /** Antwortformat. Wird zusätzlich vom Aufrufer geprüft. */
  schema: JsonSchema;
  /** Name des Schemas - OpenAI verlangt einen. */
  schemaName: string;
  /** Überschreibt `maxTokens` aus den zentralen Einstellungen. */
  maxTokens?: number;
}

export interface StrukturAntwort {
  ok: boolean;
  /** Rohtext der Antwort - vom Aufrufer gegen sein Zod-Schema zu prüfen. */
  json?: unknown;
  error?: string;
  model?: string;
  provider?: AiSettings['provider'];
}

/**
 * Zwischengespeicherte Zugänge.
 *
 * Ein Zugang hält eine Verbindung offen; ihn je Anfrage neu zu bauen kostet
 * einen Handschlag. Der Schlüssel geht in die Kennung ein, damit ein
 * gewechselter Schlüssel nicht auf einen alten Zugang trifft - genau das wäre
 * sonst der Fall, in dem «gespeichert, aber nichts ändert sich» auftritt.
 */
let zwischenspeicher: { kennung: string; anthropic?: Anthropic; openai?: OpenAI } | null = null;

function kennungVon(settings: AiSettings, apiKey: string): string {
  // Der Schlüssel geht nur als Länge und letzte vier Zeichen ein - die
  // Kennung landet potenziell in einer Fehlermeldung.
  return [settings.provider, settings.baseUrl, apiKey.length, apiKey.slice(-4)].join('|');
}

/** Verwirft die Zugänge - nach jedem Wechsel der AI-Konfiguration. */
export function resetAiClients(): void {
  zwischenspeicher = null;
}

interface Zugang {
  settings: AiSettings;
  anthropic?: Anthropic;
  openai?: OpenAI;
}

async function zugang(override?: Partial<AiSettings>): Promise<Zugang | { fehler: string }> {
  const settings = { ...(await readAiSettings()), ...override };
  if (!settings.enabled) {
    return { fehler: 'Die AI-Integration ist ausgeschaltet.' };
  }
  const apiKey = await getSecret(AI_INTEGRATION_ID, 'apiKey', { provider: settings.provider });
  if (!apiKey) {
    return { fehler: 'Es ist kein API-Schlüssel hinterlegt.' };
  }

  const kennung = kennungVon(settings, apiKey);
  if (zwischenspeicher?.kennung !== kennung) {
    zwischenspeicher = { kennung };
  }

  if (settings.provider === 'anthropic') {
    zwischenspeicher.anthropic ??= new Anthropic({
      apiKey,
      timeout: settings.timeoutMs,
      ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
    });
    return { settings, anthropic: zwischenspeicher.anthropic };
  }

  zwischenspeicher.openai ??= new OpenAI({
    apiKey,
    timeout: settings.timeoutMs,
    ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}),
  });
  return { settings, openai: zwischenspeicher.openai };
}

/** Kurz, verständlich, ohne Anbieterdetails - dieser Text erreicht die Oberfläche. */
function bereinige(error: unknown): string {
  if (error instanceof Anthropic.APIError || error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    if (status === 401) {
      return 'Der API-Schlüssel wurde abgelehnt.';
    }
    if (status === 403) {
      return 'Der Schlüssel hat keinen Zugriff auf dieses Modell.';
    }
    if (status === 404) {
      return 'Dieses Modell gibt es beim gewählten Anbieter nicht.';
    }
    if (status === 429) {
      return 'Der Anbieter drosselt gerade die Anfragen.';
    }
    if (status >= 500) {
      return 'Der Anbieter ist derzeit nicht erreichbar.';
    }
    return `Der Anbieter hat die Anfrage abgelehnt (Status ${status || 'unbekannt'}).`;
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return 'Zeitlimit überschritten.';
  }
  return 'Die Anfrage ist fehlgeschlagen.';
}

function alsJson(rohtext: string): { json: unknown } | { fehler: string } {
  try {
    return { json: JSON.parse(rohtext) };
  } catch {
    return { fehler: 'Antwort war kein gültiges JSON.' };
  }
}

export async function strukturierteAntwort(
  anfrage: StrukturAnfrage,
  override?: Partial<AiSettings>,
): Promise<StrukturAntwort> {
  const geoeffnet = await zugang(override);
  if ('fehler' in geoeffnet) {
    return { ok: false, error: geoeffnet.fehler };
  }
  const { settings } = geoeffnet;
  const maxTokens = anfrage.maxTokens ?? settings.maxTokens;

  try {
    if (geoeffnet.anthropic) {
      const antwort = await geoeffnet.anthropic.messages.create({
        model: settings.model,
        max_tokens: maxTokens,
        system: anfrage.system,
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: anfrage.schema },
        },
        messages: [{ role: 'user', content: anfrage.user }],
      });

      if (antwort.stop_reason === 'refusal') {
        return {
          ok: false,
          error: 'Das Modell hat die Antwort abgelehnt.',
          model: antwort.model,
          provider: 'anthropic',
        };
      }

      const rohtext = antwort.content
        .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      const geparst = alsJson(rohtext);
      return 'fehler' in geparst
        ? { ok: false, error: geparst.fehler, model: antwort.model, provider: 'anthropic' }
        : { ok: true, json: geparst.json, model: antwort.model, provider: 'anthropic' };
    }

    const antwort = await geoeffnet.openai!.chat.completions.create({
      model: settings.model,
      max_completion_tokens: maxTokens,
      response_format: {
        type: 'json_schema',
        json_schema: { name: anfrage.schemaName, strict: true, schema: anfrage.schema },
      },
      messages: [
        { role: 'system', content: anfrage.system },
        { role: 'user', content: anfrage.user },
      ],
    });

    const wahl = antwort.choices[0];
    if (wahl?.finish_reason === 'content_filter') {
      return {
        ok: false,
        error: 'Das Modell hat die Antwort abgelehnt.',
        model: antwort.model,
        provider: 'openai',
      };
    }
    const rohtext = wahl?.message?.content?.trim() ?? '';
    const geparst = alsJson(rohtext);
    return 'fehler' in geparst
      ? { ok: false, error: geparst.fehler, model: antwort.model, provider: 'openai' }
      : { ok: true, json: geparst.json, model: antwort.model, provider: 'openai' };
  } catch (error) {
    const grund = bereinige(error);
    // Der ausführliche Fehler geht ins Protokoll - dort greift die
    // Schwärzung, und der Schlüssel steht in ihrer Liste.
    logger.warn('AI-Anfrage fehlgeschlagen', { error, provider: settings.provider });
    return { ok: false, error: grund, provider: settings.provider };
  }
}

/**
 * Der Verbindungstest der Oberfläche (§26).
 *
 * Prüft in einem Zug Schlüssel, Anbieter, Adresse und Modellzugriff: eine
 * winzige Anfrage mit erzwungenem Format. Ein Test, der nur den Schlüssel
 * prüfte, ginge bei einem falsch geschriebenen Modellnamen grün durch.
 */
export async function testAiConnection(
  override?: Partial<AiSettings>,
): Promise<{ ok: boolean; detail: string; model?: string }> {
  const antwort = await strukturierteAntwort(
    {
      system: 'Du antwortest ausschliesslich im vorgegebenen Format.',
      user: 'Antworte mit {"ok": true}.',
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
      schemaName: 'verbindungstest',
      maxTokens: 32,
    },
    override,
  );

  if (!antwort.ok) {
    return { ok: false, detail: antwort.error ?? 'Die Anfrage ist fehlgeschlagen.' };
  }
  return {
    ok: true,
    detail: `Verbindung erfolgreich${antwort.model ? ` (${antwort.model})` : ''}.`,
    ...(antwort.model ? { model: antwort.model } : {}),
  };
}
