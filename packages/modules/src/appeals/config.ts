import { z } from 'zod';
import { registerModule, type ModuleDefinition } from '../registry';
import type { SettingsField } from '../settings/fields';
import type { ModuleHealthCheck, ModuleHealthContext } from '../health/types';

export const APPEALS_MODULE_ID = 'appeals';

/**
 * Berechtigungen der Entbannungsanträge.
 *
 * Fein geschnitten, weil die Unterschiede hier besonders zählen. Drei
 * Trennungen tragen die ganze Sicherheit dieses Moduls:
 *
 * 1. **`review` und `decide`.** Einen Fall lesen und bearbeiten ist etwas
 *    anderes, als über ihn zu entscheiden. Wer Rückfragen stellt, muss nicht
 *    entbannen dürfen.
 * 2. **`decide` und `unban`.** Auch das ist getrennt: die Entscheidung fällt
 *    im Antrag, die Entbannung geschieht auf Discord. `unbanMember` verlangt
 *    ohnehin zusätzlich `moderation.unban` - dieses Modul kann die
 *    Moderationsrechte nicht umgehen, und das ist Absicht (§41).
 * 3. **`comment.internal` und `message`.** Eine interne Notiz sieht der
 *    Antragsteller nie; eine Nachricht geht an ihn hinaus. Wer das eine darf,
 *    darf deshalb nicht selbstverständlich das andere.
 *
 * Backend-Durchsetzung ist Pflicht - die Oberfläche versteckt nur, was
 * ohnehin abgewiesen würde.
 */
export const APPEALS_PERMISSIONS = {
  view: 'appeals.view',
  /** Alle Anträge sehen, nicht nur die eigenen zugewiesenen. */
  viewAll: 'appeals.view.all',
  review: 'appeals.review',
  assign: 'appeals.assign',
  commentInternal: 'appeals.comment.internal',
  /** Nachrichten an den Antragsteller senden. */
  message: 'appeals.message',
  priority: 'appeals.priority',
  /** Eine Entscheidung vorschlagen (Vier-Augen) oder treffen. */
  decide: 'appeals.decide',
  approve: 'appeals.approve',
  reject: 'appeals.reject',
  /** Die Discord-Entbannung auslösen. Zusätzlich zu `moderation.unban`. */
  unban: 'appeals.unban',
  settings: 'appeals.settings',
} as const;

export type AppealsPermission = (typeof APPEALS_PERMISSIONS)[keyof typeof APPEALS_PERMISSIONS];

/**
 * Die Fragen des Antragsformulars.
 *
 * Fest und nicht konfigurierbar: sie sind der Kern dessen, was ein Antrag
 * beantworten muss, und ein Server, der sie umschreibt, bekommt Anträge, die
 * sich nicht mehr vergleichen lassen. Die Texte stehen hier, damit sie an
 * einer Stelle stehen - Formular, Zusammenfassung und Fallansicht lesen
 * dieselbe Liste.
 */
export const APPEAL_FRAGEN = [
  {
    key: 'grund',
    label: 'Warum möchtest du entbannt werden?',
    hilfe: 'Erkläre in eigenen Worten, weshalb du zurück auf den Server möchtest.',
    min: 30,
    max: 2000,
    pflicht: true,
  },
  {
    key: 'hergang',
    label: 'Was ist aus deiner Sicht passiert?',
    hilfe: 'Schildere den Vorfall so, wie du ihn erlebt hast.',
    min: 30,
    max: 2000,
    pflicht: true,
  },
  {
    key: 'warumPruefen',
    label: 'Warum sollte SwissHub die Entscheidung erneut prüfen?',
    hilfe: 'Gibt es etwas, das beim ersten Mal nicht bekannt war?',
    min: 20,
    max: 2000,
    pflicht: true,
  },
  {
    key: 'anders',
    label: 'Falls du gegen Regeln verstossen hast: Was würdest du heute anders machen?',
    hilfe: 'Ein Antrag ohne diese Frage ist selten überzeugend.',
    min: 20,
    max: 2000,
    pflicht: true,
  },
  {
    key: 'weiteres',
    label: 'Gibt es weitere Informationen, die wir berücksichtigen sollten?',
    hilfe: 'Freiwillig. Leer lassen, wenn nichts offen ist.',
    min: 0,
    max: 2000,
    pflicht: false,
  },
] as const;

export type AppealFrageKey = (typeof APPEAL_FRAGEN)[number]['key'];

export const appealsSettingsSchema = z.object({
  // --- Zulässigkeit ------------------------------------------------------
  /**
   * Wie lange ein Bann bestehen muss, ehe ein Antrag möglich ist.
   *
   * Ein Antrag eine Stunde nach dem Bann sagt selten etwas aus. Die Frist
   * zählt ab dem Moderationseintrag; wurde der Bann ausserhalb von SwissHub
   * gesetzt, gibt es keinen Zeitpunkt und die Frist entfällt - eine erfundene
   * Sperre wäre schlechter als keine.
   */
  wartefristTage: z.number().int().min(0).max(365).default(3),
  /** Wie viele Tage nach einer Ablehnung ein neuer Antrag möglich ist. */
  cooldownTage: z.number().int().min(0).max(730).default(30),
  /** Nach der zweiten Ablehnung. Länger, weil zwei Nein etwas bedeuten. */
  cooldownZweiteAblehnungTage: z.number().int().min(0).max(730).default(90),
  /** Höchstzahl gleichzeitig offener Anträge je Person. Praktisch immer 1. */
  maxAktiveProPerson: z.number().int().min(1).max(3).default(1),

  // --- Ablauf ------------------------------------------------------------
  /**
   * Nach wie vielen Tagen ohne Antwort ein Antrag abläuft.
   *
   * 0 schaltet den Ablauf ab. Ein Antrag bleibt dann offen, bis jemand
   * entscheidet - richtig für ein kleines Team, das lieber selbst schliesst.
   */
  ablaufTageOhneAntwort: z.number().int().min(0).max(90).default(14),
  /** Ab wann ein Antrag ohne Bearbeiter als überfällig gilt (§43). */
  warnungStundenOhneBearbeiter: z.number().int().min(0).max(720).default(48),
  /** Ab wann ein Antrag als Eskalationskandidat gilt. */
  eskalationTage: z.number().int().min(0).max(90).default(7),

  // --- Vier-Augen (§24) --------------------------------------------------
  /**
   * Wann eine zweite Person bestätigen muss.
   *
   * `NIE` ist die Vorgabe: das Vier-Augen-Prinzip ist richtig, blockiert aber
   * ein kleines Team. `GENEHMIGUNG` ist der sinnvolle Mittelweg - eine
   * Ablehnung ändert nichts, eine Genehmigung holt jemanden zurück.
   */
  vierAugen: z.enum(['NIE', 'GENEHMIGUNG', 'IMMER']).default('NIE'),

  // --- Anhänge (§33) -----------------------------------------------------
  anhaengeErlaubt: z.boolean().default(true),
  maxAnhangMb: z.number().int().min(1).max(25).default(8),
  maxAnhaengeProAntrag: z.number().int().min(1).max(20).default(5),

  // --- Meldungen ---------------------------------------------------------
  /** Wohin neue Anträge gemeldet werden. */
  meldeKanalId: z.string().nullable().default(null),
  /** Rolle, die bei einem neuen Antrag erwähnt wird. Leer = keine. */
  meldeRolleId: z.string().nullable().default(null),
  /** Auch melden, wenn ein Antragsteller antwortet. */
  meldeBeiAntwort: z.boolean().default(true),

  // --- Aufbewahrung (§47) ------------------------------------------------
  /**
   * Nach wie vielen Tagen die Anhänge abgeschlossener Anträge entfernt werden.
   *
   * Der Antrag selbst bleibt: er ist Teil der Moderationsspur. Die Dateien
   * sind es nicht - sie sind Beleg für eine Entscheidung, die getroffen ist.
   */
  anhangAufbewahrungTage: z.number().int().min(7).max(3650).default(180),
});

export type AppealsSettings = z.infer<typeof appealsSettingsSchema>;

const appealsSettingsFields: SettingsField[] = [
  {
    key: 'wartefristTage',
    label: 'Wartefrist nach dem Bann',
    description:
      'So lange muss ein Bann bestehen, ehe ein Antrag möglich ist. Bei Banns ausserhalb von SwissHub entfällt sie, weil kein Zeitpunkt bekannt ist.',
    type: 'number',
    min: 0,
    max: 365,
    unit: 'Tage',
    group: 'Zulässigkeit',
  },
  {
    key: 'cooldownTage',
    label: 'Sperrfrist nach einer Ablehnung',
    type: 'number',
    min: 0,
    max: 730,
    unit: 'Tage',
    group: 'Zulässigkeit',
  },
  {
    key: 'cooldownZweiteAblehnungTage',
    label: 'Sperrfrist ab der zweiten Ablehnung',
    type: 'number',
    min: 0,
    max: 730,
    unit: 'Tage',
    group: 'Zulässigkeit',
  },
  {
    key: 'maxAktiveProPerson',
    label: 'Gleichzeitig offene Anträge je Person',
    type: 'number',
    min: 1,
    max: 3,
    group: 'Zulässigkeit',
  },
  {
    key: 'ablaufTageOhneAntwort',
    label: 'Ablauf ohne Antwort',
    description: '0 schaltet den Ablauf ab - der Antrag bleibt dann offen, bis jemand entscheidet.',
    type: 'number',
    min: 0,
    max: 90,
    unit: 'Tage',
    group: 'Ablauf',
  },
  {
    key: 'warnungStundenOhneBearbeiter',
    label: 'Warnung ohne Bearbeiter',
    type: 'number',
    min: 0,
    max: 720,
    unit: 'Stunden',
    group: 'Ablauf',
  },
  {
    key: 'eskalationTage',
    label: 'Eskalationsschwelle',
    type: 'number',
    min: 0,
    max: 90,
    unit: 'Tage',
    group: 'Ablauf',
  },
  {
    key: 'vierAugen',
    label: 'Vier-Augen-Prinzip',
    description:
      'Wann eine zweite Person bestätigen muss. Eine Ablehnung ändert nichts, eine Genehmigung holt jemanden zurück - deshalb ist «nur bei Genehmigung» der sinnvolle Mittelweg.',
    type: 'select',
    options: [
      { value: 'NIE', label: 'Nicht nötig' },
      { value: 'GENEHMIGUNG', label: 'Nur bei Genehmigung' },
      { value: 'IMMER', label: 'Bei jeder Entscheidung' },
    ],
    group: 'Entscheidung',
  },
  {
    key: 'anhaengeErlaubt',
    label: 'Anhänge erlauben',
    type: 'boolean',
    group: 'Anhänge',
  },
  {
    key: 'maxAnhangMb',
    label: 'Grösse je Anhang',
    type: 'number',
    min: 1,
    max: 25,
    unit: 'MB',
    group: 'Anhänge',
  },
  {
    key: 'maxAnhaengeProAntrag',
    label: 'Anzahl Anhänge je Antrag',
    type: 'number',
    min: 1,
    max: 20,
    group: 'Anhänge',
  },
  {
    key: 'anhangAufbewahrungTage',
    label: 'Anhänge aufbewahren',
    description: 'Der Antrag selbst bleibt - er ist Teil der Moderationsspur. Die Dateien nicht.',
    type: 'number',
    min: 7,
    max: 3650,
    unit: 'Tage',
    group: 'Anhänge',
  },
  {
    key: 'meldeKanalId',
    label: 'Meldekanal',
    description: 'Wohin neue Anträge und Antworten gemeldet werden.',
    type: 'discord-channel',
    group: 'Meldungen',
  },
  {
    key: 'meldeRolleId',
    label: 'Rolle bei neuen Anträgen erwähnen',
    type: 'discord-role',
    group: 'Meldungen',
  },
  {
    key: 'meldeBeiAntwort',
    label: 'Auch bei Antworten melden',
    type: 'boolean',
    group: 'Meldungen',
  },
];

async function appealsHealthChecks(context: ModuleHealthContext): Promise<ModuleHealthCheck[]> {
  const checks: ModuleHealthCheck[] = [];
  const { getModuleSettings } = await import('../module-state');
  const settings = await getModuleSettings<AppealsSettings>(APPEALS_MODULE_ID);
  const fix = `/modules/${APPEALS_MODULE_ID}`;

  if (settings.meldeKanalId) {
    const kanal = context.channels.find((eintrag) => eintrag.id === settings.meldeKanalId);
    checks.push(
      kanal
        ? { label: 'Meldekanal', status: 'ok', detail: `#${kanal.name}` }
        : {
            label: 'Meldekanal',
            status: 'error',
            detail: 'Diesen Kanal gibt es auf Discord nicht mehr.',
            fixHref: fix,
          },
    );
  } else {
    checks.push({
      label: 'Meldekanal',
      status: 'warning',
      detail: 'Nicht gesetzt - neue Anträge fallen nur im Dashboard auf.',
      fixHref: fix,
    });
  }

  // Ohne dieses Recht wäre das Modul eine Sackgasse: Anträge kämen an, aber
  // niemand könnte sie umsetzen. Die Entbannung geht bewusst über die
  // Moderation und nicht an ihr vorbei (§41).
  const { listPermissions } = await import('@swisshub/permissions');
  const kennt = new Set(listPermissions().map((eintrag) => eintrag.key));
  checks.push(
    kennt.has('moderation.unban')
      ? {
          label: 'Entbannung',
          status: 'ok',
          detail: 'Läuft über das Moderation Center - «Bann aufheben» wird zusätzlich verlangt.',
        }
      : {
          label: 'Entbannung',
          status: 'error',
          detail: 'Die Berechtigung «moderation.unban» fehlt im System.',
        },
  );

  return checks;
}

export const appealsModule: ModuleDefinition = registerModule({
  id: APPEALS_MODULE_ID,
  name: 'Entbannungsanträge',
  description:
    'Gebannte Mitglieder stellen einen strukturierten Antrag auf erneute Prüfung. Das Team sieht den Fall vollständig, entscheidet nachvollziehbar - und die Entbannung läuft über das Moderation Center.',
  icon: 'Gavel',
  permissionPrefix: 'appeals',
  defaultEnabled: false,
  settingsSchema: appealsSettingsSchema,
  settingsFields: appealsSettingsFields,
  healthChecks: appealsHealthChecks,
  permissions: [
    {
      key: APPEALS_PERMISSIONS.view,
      label: 'Anträge ansehen',
      description: 'Übersicht und die eigenen zugewiesenen Anträge sehen.',
      module: APPEALS_MODULE_ID,
    },
    {
      key: APPEALS_PERMISSIONS.viewAll,
      label: 'Alle Anträge ansehen',
      description: 'Auch Anträge sehen, die jemand anderem zugewiesen sind.',
      module: APPEALS_MODULE_ID,
    },
    {
      key: APPEALS_PERMISSIONS.review,
      label: 'Anträge bearbeiten',
      description: 'Einen Antrag übernehmen, prüfen und seinen Zustand fortschreiben.',
      module: APPEALS_MODULE_ID,
    },
    {
      key: APPEALS_PERMISSIONS.assign,
      label: 'Anträge zuweisen',
      description: 'Einen Antrag an jemand anderen übergeben oder wieder freigeben.',
      module: APPEALS_MODULE_ID,
    },
    {
      key: APPEALS_PERMISSIONS.commentInternal,
      label: 'Intern kommentieren',
      description: 'Notizen schreiben, die der Antragsteller nie zu sehen bekommt.',
      module: APPEALS_MODULE_ID,
    },
    {
      key: APPEALS_PERMISSIONS.message,
      label: 'Mit dem Antragsteller schreiben',
      description: 'Rückfragen stellen und Antworten geben. Diese Nachrichten gehen hinaus.',
      module: APPEALS_MODULE_ID,
    },
    {
      key: APPEALS_PERMISSIONS.priority,
      label: 'Priorität setzen',
      description: 'Die Dringlichkeit eines Antrags ändern.',
      module: APPEALS_MODULE_ID,
    },
    {
      key: APPEALS_PERMISSIONS.decide,
      label: 'Entscheidung vorschlagen',
      description: 'Beim Vier-Augen-Prinzip eine Entscheidung zur Bestätigung vorlegen.',
      module: APPEALS_MODULE_ID,
    },
    {
      key: APPEALS_PERMISSIONS.approve,
      label: 'Antrag genehmigen',
      description:
        'Einen Antrag positiv entscheiden. Holt jemanden zurück auf den Server - deshalb getrennt vom Ablehnen.',
      module: APPEALS_MODULE_ID,
      critical: true,
    },
    {
      key: APPEALS_PERMISSIONS.reject,
      label: 'Antrag ablehnen',
      description: 'Einen Antrag negativ entscheiden und eine Sperrfrist setzen.',
      module: APPEALS_MODULE_ID,
      critical: true,
    },
    {
      key: APPEALS_PERMISSIONS.unban,
      label: 'Entbannung auslösen',
      description:
        'Die Entbannung auf Discord durchführen. Verlangt zusätzlich «Bann aufheben» im Moderation Center.',
      module: APPEALS_MODULE_ID,
      critical: true,
    },
    {
      key: APPEALS_PERMISSIONS.settings,
      label: 'Entbannungsanträge einrichten',
      description: 'Fristen, Anhänge, Meldungen und das Vier-Augen-Prinzip festlegen.',
      module: APPEALS_MODULE_ID,
      critical: true,
    },
  ],
  navigation: [
    {
      href: '/appeals',
      label: 'Entbannungsanträge',
      description: 'Anträge auf erneute Prüfung einer Sanktion',
      permission: APPEALS_PERMISSIONS.view,
      icon: 'Gavel',
      group: 'moderation',
      order: 40,
      altPermissions: [APPEALS_PERMISSIONS.viewAll, APPEALS_PERMISSIONS.review],
    },
  ],
});
