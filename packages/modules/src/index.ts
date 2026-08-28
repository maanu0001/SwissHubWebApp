// Die Kernbereiche und das Jail-Modul registrieren sich beim Import.
// Weitere Module hier ergänzen - siehe docs/MODULES.md.
import './core-modules';
import './jail/config';
import './communication/config';
import './premium/config';
import './music/config';
import './tickets/config';
import './spielersuche/config';
import './level/config';
import './tournaments/config';
import './voice-hub/config';
// Analytics registriert sich beim Import - wie jedes andere Modul auch.
import './analytics/config';
import './calendar/config';
import './verification/config';
// Die Automation Engine: Ereignisse, Aktionen und Vorlagen der Module.
import './automation';
import { registerGuildResolver } from './guild/config';

// Ab hier löst jeder Discord-Aufruf die Guild aus der Datenbank auf.
// Das passiert beim Import, damit weder WebApp noch Bot es vergessen können.
registerGuildResolver();

export * from './registry';
export * from './module-state';
export * from './settings';
export * from './settings/fields';
export * from './settings/service';
export * from './guild/config';
export * from './discord/sync';
export * from './discord/inspector';
export * from './health/types';
export * from './health/service';
export * as branding from './branding';
export * as jail from './jail';
export * as communication from './communication';
export * as premium from './premium';
export * as music from './music';
export * as tickets from './tickets';
export * as spielersuche from './spielersuche';
export * as level from './level';
export * as tournaments from './tournaments';
// Die gemeinsame Engine fuer temporaere Sprachkanaele - modulunabhaengig.
export * as voice from './voice';
export * as voiceHub from './voice-hub';
export * from './bot-status';
export * from './members/service';
export * from './members/avatars';
// Das Member Center. Die beiden Zeilen darueber bleiben, damit bestehende
// Aufrufer von `searchMembers` und `getMemberProfile` unveraendert laufen.
export * as members from './members';
export * as moderation from './moderation';
export * as analytics from './analytics';
export * as calendar from './calendar';
export * as ai from './ai';
export * as verification from './verification';
export * as automation from './automation';
