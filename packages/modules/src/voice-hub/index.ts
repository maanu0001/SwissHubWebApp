/**
 * Voice Hub.
 *
 * Wer den Hub-Channel betritt, bekommt seinen eigenen Talk - mit Bedienfeld im
 * Textchat des Kanals und derselben Verwaltung im Dashboard. Der Lebenszyklus
 * kommt aus der gemeinsamen Engine in `../voice`; hier liegt, was den Hub
 * ausmacht: Vorlagen, Hub-Channels, das Bedienfeld und die Zugriffsregel.
 */
export * from './config';
export * from './presets';
export * from './hubs';
export * from './join';
export * from './control-panel';
export * from './access';
export * from './actions';
export * from './preferences';
export * from './queries';
