import { z } from 'zod';
import { registerEvent } from '@swisshub/automation';

/**
 * Die Ereignisse der Entbannungsanträge (§36).
 *
 * Sie gehen über den bestehenden Ereignisbus der Automation Engine - es gibt
 * keine zweite Engine und keinen zweiten Bus. Eine Automation kann darauf
 * reagieren: das Team benachrichtigen, einen Antrag zuweisen, eine Erinnerung
 * setzen.
 *
 * **Was eine Automation nicht kann:** genehmigen, ablehnen oder entbannen.
 * Diese Aktionen sind in der Engine nicht angemeldet, und das ist Absicht -
 * eine Entbannung durch eine Bedingung, die versehentlich immer zutrifft,
 * wäre der teuerste Fehler, den dieses Modul machen könnte (§36).
 *
 * Die Nutzdaten tragen **keine** internen Angaben: keine interne Begründung,
 * keine Moderationsnotiz, keinen Moderatornamen. Ereignisnutzdaten landen im
 * Automationsverlauf und in Vorschauen; was dort nicht stehen darf, gehört
 * nicht hinein (§20).
 */

const discordId = z.string().regex(/^\d{17,20}$/u);

const basis = {
  appealId: z.string(),
  fallnummer: z.string(),
  discordId,
  displayName: z.string(),
};

const basisVariablen = [
  { path: 'payload.fallnummer', label: 'Fallnummer', type: 'string' as const },
  { path: 'payload.displayName', label: 'Anzeigename', type: 'string' as const },
  { path: 'event.subjectId', label: 'Discord-ID', type: 'string' as const },
];

registerEvent({
  type: 'appeal.submitted',
  label: 'Entbannungsantrag eingereicht',
  description: 'Jemand hat einen Antrag auf erneute Prüfung gestellt.',
  module: 'appeals',
  payloadSchema: z.object({
    ...basis,
    /** `swisshub`, wenn SwissHub den Bann gesetzt hat - sonst `discord`. */
    quelle: z.enum(['swisshub', 'discord']),
    /** Frühere Anträge derselben Person. Für «wiederholter Antrag». */
    fruehereAntraege: z.number().int(),
  }),
  variables: [
    ...basisVariablen,
    { path: 'payload.fruehereAntraege', label: 'Frühere Anträge', type: 'number' },
  ],
});

registerEvent({
  type: 'appeal.assigned',
  label: 'Antrag wurde zugewiesen',
  description: 'Ein Antrag hat eine Bearbeiterin oder einen Bearbeiter bekommen.',
  module: 'appeals',
  payloadSchema: z.object({ ...basis, bearbeiterDiscordId: discordId.nullable() }),
  variables: basisVariablen,
});

registerEvent({
  type: 'appeal.status_changed',
  label: 'Antragsstatus hat sich geändert',
  description: 'Der Zustand eines Antrags ist fortgeschritten.',
  module: 'appeals',
  payloadSchema: z.object({ ...basis, von: z.string(), nach: z.string() }),
  variables: [
    ...basisVariablen,
    { path: 'payload.nach', label: 'Neuer Status', type: 'string' },
    { path: 'payload.von', label: 'Vorheriger Status', type: 'string' },
  ],
});

registerEvent({
  type: 'appeal.message_received',
  label: 'Antragsteller hat geantwortet',
  description: 'Auf eine Rückfrage ist eine Antwort eingegangen.',
  module: 'appeals',
  payloadSchema: z.object(basis),
  variables: basisVariablen,
});

registerEvent({
  type: 'appeal.escalated',
  label: 'Antrag wurde eskaliert',
  description: 'Ein Antrag braucht die Aufmerksamkeit von jemandem mit mehr Befugnis.',
  module: 'appeals',
  payloadSchema: z.object(basis),
  variables: basisVariablen,
});

registerEvent({
  type: 'appeal.approved',
  label: 'Antrag wurde genehmigt',
  description:
    'Ein Antrag wurde positiv entschieden. Nur zur Meldung - die Entscheidung hat ein Mensch getroffen.',
  module: 'appeals',
  payloadSchema: z.object({
    ...basis,
    /** Ob die Entbannung auf Discord bereits durch ist. */
    entbannt: z.boolean(),
  }),
  variables: [...basisVariablen, { path: 'payload.entbannt', label: 'Entbannt', type: 'boolean' }],
});

registerEvent({
  type: 'appeal.rejected',
  label: 'Antrag wurde abgelehnt',
  description: 'Ein Antrag wurde negativ entschieden.',
  module: 'appeals',
  payloadSchema: z.object({
    ...basis,
    erneutErlaubt: z.boolean(),
    naechsteMoeglichkeitAm: z.string().nullable(),
  }),
  variables: [
    ...basisVariablen,
    { path: 'payload.naechsteMoeglichkeitAm', label: 'Erneut möglich ab', type: 'date' },
  ],
});

registerEvent({
  type: 'appeal.unban_failed',
  label: 'Entbannung nach Genehmigung gescheitert',
  description:
    'Der Antrag ist genehmigt, die Entbannung auf Discord aber noch nicht durchgeführt.',
  module: 'appeals',
  payloadSchema: z.object({ ...basis, grund: z.string() }),
  variables: [...basisVariablen, { path: 'payload.grund', label: 'Grund', type: 'string' }],
});

registerEvent({
  type: 'appeal.closed',
  label: 'Antrag wurde abgeschlossen',
  description: 'Ein Antrag ist endgültig zu den Akten gelegt.',
  module: 'appeals',
  payloadSchema: z.object({ ...basis, ergebnis: z.string() }),
  variables: [...basisVariablen, { path: 'payload.ergebnis', label: 'Ergebnis', type: 'string' }],
});
