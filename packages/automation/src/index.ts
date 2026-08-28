/**
 * Die Automation Engine - der Kern.
 *
 * Dieses Paket kennt **kein** SwissHub-Modul. Es weiss, wie ein Ereignis
 * veröffentlicht, verteilt und abgearbeitet wird; *welche* Ereignisse,
 * Bedingungen und Aktionen es gibt, tragen die Module selbst ein. Die
 * Abhängigkeit zeigt daher in genau eine Richtung:
 *
 *     @swisshub/automation   <- @swisshub/modules   <- apps/web, apps/bot
 *
 * Ein neues Modul ändert an diesem Paket nichts. Steht hier je ein `switch`
 * über Modulnamen, ist etwas falsch gelaufen.
 */

// Die drei Auslöser, vier Bedingungen und sechs Aktionen, die kein Modul
// brauchen. Seiteneffekt-Import - dasselbe Muster wie bei den Modulen selbst.
import './core-triggers';
import './core-conditions';
import './core-actions';

export {
  EVENT_TYPE_PATTERN,
  LIMITS,
  clearEventDefinitions,
  eventTypeSchema,
  getEventDefinition,
  listEventDefinitions,
  registerEvent,
  type EventDefinition,
  type EventEnvelope,
  type EventVariable,
  type PublishInput,
} from './contract';

export {
  clearRegistries,
  getAction,
  getCondition,
  getTrigger,
  listActions,
  listConditions,
  listTriggers,
  registerAction,
  registerCondition,
  registerTrigger,
  type ActionDefinition,
  type ActionResult,
  type AutomationField,
  type ConditionDefinition,
  type TriggerDefinition,
  type ValidationEnvironment,
  type ValidationIssue,
} from './registry';

export {
  render,
  renderConfig,
  type AutomationContext,
} from './context';

export {
  OPERATOR_LABEL,
  VERGLEICHS_OPERATOREN,
  conditionNodeSchema,
  sammleTypen,
  vergleiche,
  werteBaumAus,
  type AuswertungsErgebnis,
  type AuswertungsSchritt,
  type ConditionNode,
  type Vergleichsoperator,
} from './conditions';

export {
  FEHLERVERHALTEN,
  einstieg,
  flache,
  sammleAktionen,
  stepNodeSchema,
  stepsSchema,
  zaehleSchritte,
  type Fehlerverhalten,
  type FlacherSchritt,
  type StepNode,
} from './steps';

export {
  beanspruche,
  holeUnverarbeitete,
  publish,
  raeumeEreignisse,
  type PublishErgebnis,
} from './bus';

export {
  INSTANZ_ID,
  PACHT_MS,
  beanspruchFaellige,
  holeVerwaisteZurueck,
  meldeJobFehler,
  naechsterVersuch,
  planeJob,
  raeumeJobs,
  schedulerGesundheit,
  schliesseJobAb,
  verwerfeJobs,
  verwerfeJobsDesLaufs,
  type JobEingabe,
  type SchedulerGesundheit,
} from './scheduler';

export {
  OFFENE_ZUSTAENDE,
  RATE_FENSTER_MS,
  darfEreignisAusloesen,
  loeseSchluesselAuf,
  pruefeGleichzeitigkeit,
  pruefeKette,
  pruefeRate,
  type Gleichzeitigkeitsentscheid,
  type Kettenbefund,
} from './limits';

export {
  idempotenzSchluessel,
  istWiederholbar,
  markiereTot,
  setzeFort,
  starte,
  type LaufErgebnis,
  type StartEingabe,
} from './executor';

export {
  findePassende,
  planeNaechsten,
  planeZeitTrigger,
  verarbeiteJobs,
  verteileEreignisse,
  type JobErgebnis,
  type VerteilErgebnis,
} from './dispatcher';

export {
  STANDARD_ZEITZONE,
  naechsterTermin,
  scheduleTriggerConfigSchema,
  type ScheduleTriggerConfig,
} from './core-triggers';

export {
  WEBHOOK_FRIST_MS,
  istInterneAdresse,
  pruefeZieladresse,
  sendeWebhook,
  type WebhookErgebnis,
  type Zielbefund,
} from './webhook';

export {
  ereignisEinerAutomation,
  pruefeAutomation,
  type Pruefbericht,
  type Pruefeingabe,
} from './validate';

export {
  aendere,
  archiviere,
  holeAutomation,
  legeAn,
  listeAutomationen,
  schalte,
  stelleSystemautomationSicher,
  type Akteur,
  type AutomationEingabe,
  type AutomationMitZahlen,
} from './store';

export {
  brichAb,
  entscheideFreigabe,
  holeFehler,
  holeLauf,
  holeOffeneFreigaben,
  holeVerlauf,
  laufGesundheit,
  raeumeLaeufe,
  type Gesundheit,
  type VerlaufEintrag,
  type VerlaufFilter,
} from './runs';

export {
  clearTemplates,
  getTemplate,
  listTemplates,
  registerTemplate,
  vorlageVollstaendig,
  type AutomationVorlage,
} from './templates';
