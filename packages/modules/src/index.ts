// Die Kernbereiche und das Jail-Modul registrieren sich beim Import.
// Weitere Module hier ergänzen - siehe docs/MODULES.md.
import './core-modules';
import './jail/config';
import './communication/config';
import './premium/config';
import './spielersuche/config';
import './level/config';
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
export * as spielersuche from './spielersuche';
export * as level from './level';
export * from './bot-status';
export * from './members/service';
export * from './members/avatars';
