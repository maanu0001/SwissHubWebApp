/**
 * Temporaere Sprachkanaele.
 *
 * Die gemeinsame Grundlage fuer alle Module, die Sprachkanaele auf Zeit
 * anlegen - der Voice Hub, die Spielersuche, spaeter vielleicht ein Turnier.
 * Wer hier einen Kanal erzeugt, bekommt denselben Lebenszyklus: dieselbe
 * Rechtestrategie, dieselbe Schonfrist, denselben Abgleich nach einem
 * Neustart.
 */
export * from './permissions';
export * from './bot-rechte';
export * from './naming';
export * from './service';
export * from './members';
export * from './lifecycle';
export * from './reconcile';
