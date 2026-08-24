import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prisma } from '@swisshub/database';
import type { TicketTranscriptAudience } from '@swisshub/database';
import { AppError } from '@swisshub/shared';
import { formatDateTime } from '@swisshub/shared';
import { createLogger } from '@swisshub/logger';
import { UPLOAD_DIR } from '../branding/storage';
import { listMessages } from './messages';

const logger = createLogger('tickets:transcript');

/**
 * Gespraechsverlaeufe als eigenstaendige Datei.
 *
 * Zwei Fassungen, weil es zwei Publika gibt: das Mitglied bekommt seinen
 * Verlauf ohne interne Notizen, das Team den vollstaendigen. Die Trennung
 * geschieht beim Erzeugen, nicht beim Anzeigen - eine Notiz, die in der
 * Datei steht und nur ausgeblendet wird, ist zwei Tastendruecke von der
 * Veroeffentlichung entfernt.
 *
 * Die Datei ist ein Zwischenspeicher, nicht die Wahrheit: fehlt sie, wird
 * sie aus der Datenbank neu erzeugt. Dadurch ueberlebt ein Transcript den
 * Verlust des Verzeichnisses, und die Aufbewahrungsfrist darf Dateien
 * loeschen, ohne den Verlauf zu vernichten.
 */

/** Eigenes Unterverzeichnis - Transcripts sind keine Bilder. */
const TRANSCRIPT_DIR = join(UPLOAD_DIR, 'transcripts');

/** Erlaubt ausschliesslich die selbst erzeugten Namen. */
const NAMENSMUSTER = /^transcript-[0-9a-f]{32}\.html$/u;

export interface TranscriptInhalt {
  html: string;
  messageCount: number;
  /** Name fuer den Download - traegt die Ticketnummer, nicht die Kennung. */
  downloadName: string;
}

/**
 * Den Verlauf eines Tickets als HTML erzeugen.
 *
 * Ohne Dateizugriff und ohne Netz - damit laesst sich pruefen, was
 * tatsaechlich in einer Fassung landet.
 */
export async function renderTranscript(
  ticketId: string,
  audience: TicketTranscriptAudience,
): Promise<TranscriptInhalt> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { category: { select: { name: true } } },
  });
  if (!ticket) {
    throw new AppError('NOT_FOUND', { userMessage: 'Dieses Ticket existiert nicht.' });
  }

  // Der Parameter entscheidet, was geladen wird. Interne Notizen erreichen
  // die Nutzerfassung damit gar nicht erst.
  const nachrichten = await listMessages(ticketId, audience === 'STAFF');

  const nummer = String(ticket.ticketNumber).padStart(4, '0');
  const kopf: Array<[string, string]> = [
    ['Ticket', `#${nummer}`],
    ['Betreff', ticket.subject],
    ['Kategorie', ticket.category?.name ?? 'Ohne Kategorie'],
    ['Eröffnet von', ticket.creatorUsername],
    ['Eröffnet am', formatDateTime(ticket.createdAt)],
    ...(ticket.assignedToUsername
      ? ([['Bearbeitet von', ticket.assignedToUsername]] as Array<[string, string]>)
      : []),
    ...(ticket.closedAt
      ? ([['Geschlossen am', formatDateTime(ticket.closedAt)]] as Array<[string, string]>)
      : []),
    ...(ticket.closeReason && audience === 'STAFF'
      ? ([['Grund', ticket.closeReason]] as Array<[string, string]>)
      : []),
  ];

  const zeilen = nachrichten
    .map((nachricht) => {
      const notiz = nachricht.source === 'INTERNAL_NOTE';
      const klasse = notiz ? 'nachricht notiz' : nachricht.fromStaff ? 'nachricht team' : 'nachricht';
      const anhaenge =
        nachricht.attachments.length > 0
          ? `<ul class="anhaenge">${nachricht.attachments
              .map(
                (anhang) =>
                  `<li><a href="${escape(anhang.url)}" rel="noreferrer noopener">${escape(anhang.fileName)}</a></li>`,
              )
              .join('')}</ul>`
          : '';
      const inhalt = nachricht.deletedAt
        ? '<p class="entfernt">Diese Nachricht wurde auf Discord gelöscht.</p>'
        : `<p>${escape(nachricht.content).replace(/\n/gu, '<br>')}</p>`;

      return `<article class="${klasse}">
  <header>
    <strong>${escape(nachricht.authorUsername ?? 'System')}</strong>
    ${notiz ? '<span class="marke">Interne Notiz</span>' : nachricht.fromStaff ? '<span class="marke team">Support</span>' : ''}
    <time>${escape(formatDateTime(nachricht.createdAt))}</time>
  </header>
  ${inhalt}
  ${anhaenge}
</article>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticket #${escape(nummer)} · ${escape(ticket.subject)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 2rem 1rem; font: 15px/1.6 system-ui, sans-serif; background: #0f1115; color: #e7e9ee; }
  main { max-width: 46rem; margin: 0 auto; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: .25rem 1rem; margin: 0 0 2rem; font-size: .875rem; }
  dt { color: #9aa1ad; }
  dd { margin: 0; }
  .nachricht { border: 1px solid #262a33; border-radius: .75rem; padding: .875rem 1rem; margin-bottom: .75rem; }
  .nachricht.team { border-color: rgba(131, 6, 10, .5); background: rgba(131, 6, 10, .08); }
  .nachricht.notiz { border-color: #8a6d1f; background: rgba(138, 109, 31, .1); }
  .nachricht header { display: flex; flex-wrap: wrap; gap: .5rem; align-items: baseline; margin-bottom: .375rem; }
  .marke { font-size: .75rem; padding: .0625rem .375rem; border-radius: .25rem; background: rgba(138, 109, 31, .25); }
  .marke.team { background: rgba(131, 6, 10, .3); }
  time { font-size: .75rem; color: #9aa1ad; }
  p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .entfernt { font-style: italic; color: #9aa1ad; }
  .anhaenge { margin: .5rem 0 0; padding-left: 1.25rem; font-size: .875rem; }
  a { color: #e0616a; }
  footer { margin-top: 2rem; font-size: .75rem; color: #9aa1ad; }
  @media (prefers-color-scheme: light) {
    body { background: #fff; color: #16181d; }
    .nachricht { border-color: #e3e5ea; }
    dt, time, .entfernt, footer { color: #666b76; }
    a { color: #83060a; }
  }
</style>
</head>
<body>
<main>
<h1>Ticket #${escape(nummer)} · ${escape(ticket.subject)}</h1>
<dl>
${kopf.map(([bezeichnung, wert]) => `  <dt>${escape(bezeichnung)}</dt><dd>${escape(wert)}</dd>`).join('\n')}
</dl>
${zeilen || '<p>Keine Nachrichten.</p>'}
<footer>${nachrichten.length} Nachrichten · ${audience === 'STAFF' ? 'Team-Fassung mit internen Notizen' : 'Fassung ohne interne Notizen'} · erstellt am ${escape(formatDateTime(new Date()))}</footer>
</main>
</body>
</html>`;

  return {
    html,
    messageCount: nachrichten.length,
    downloadName: `ticket-${nummer}${audience === 'STAFF' ? '-intern' : ''}.html`,
  };
}

/**
 * Beide Fassungen erzeugen und ablegen.
 *
 * Laeuft beim Schliessen. Schlaegt das Schreiben fehl, bleibt der Verlauf in
 * der Datenbank - deshalb ist ein Fehler hier kein Grund, das Schliessen
 * scheitern zu lassen.
 */
export async function ensureTranscripts(ticketId: string): Promise<void> {
  for (const audience of ['USER', 'STAFF'] as const) {
    try {
      const inhalt = await renderTranscript(ticketId, audience);
      const fileName = `transcript-${randomBytes(16).toString('hex')}.html`;

      await mkdir(TRANSCRIPT_DIR, { recursive: true });
      await writeFile(join(TRANSCRIPT_DIR, fileName), inhalt.html, { mode: 0o640 });

      const vorher = await prisma.ticketTranscript.findUnique({
        where: { ticketId_audience: { ticketId, audience } },
      });

      await prisma.ticketTranscript.upsert({
        where: { ticketId_audience: { ticketId, audience } },
        create: {
          ticketId,
          audience,
          fileName,
          sizeBytes: Buffer.byteLength(inhalt.html),
          messageCount: inhalt.messageCount,
        },
        update: {
          fileName,
          sizeBytes: Buffer.byteLength(inhalt.html),
          messageCount: inhalt.messageCount,
        },
      });

      // Die vorherige Fassung erst danach entfernen: bricht der Upsert ab,
      // zeigt der Datensatz noch auf eine Datei, die es gibt.
      if (vorher && vorher.fileName !== fileName) {
        await entferneDatei(vorher.fileName);
      }
    } catch (fehler) {
      logger.warn('Transcript konnte nicht abgelegt werden', {
        ticketId,
        audience,
        grund: fehler instanceof Error ? fehler.message : 'unbekannt',
      });
    }
  }
}

/**
 * Ein Transcript ausliefern.
 *
 * Zuerst die abgelegte Datei, sonst frisch aus der Datenbank. Der Aufrufer
 * hat den Zugriff bereits geprueft - diese Stelle prueft ihn nicht, und
 * genau deshalb darf sie nie ohne Pruefung aufgerufen werden.
 */
export async function loadTranscript(
  ticketId: string,
  audience: TicketTranscriptAudience,
): Promise<TranscriptInhalt> {
  const eintrag = await prisma.ticketTranscript.findUnique({
    where: { ticketId_audience: { ticketId, audience } },
  });

  if (eintrag && NAMENSMUSTER.test(eintrag.fileName)) {
    const ziel = resolve(TRANSCRIPT_DIR, eintrag.fileName);
    if (ziel.startsWith(resolve(TRANSCRIPT_DIR) + '/')) {
      const inhalt = await readFile(ziel, 'utf8').catch(() => null);
      if (inhalt !== null) {
        const ticket = await prisma.ticket.findUnique({
          where: { id: ticketId },
          select: { ticketNumber: true },
        });
        const nummer = String(ticket?.ticketNumber ?? 0).padStart(4, '0');
        return {
          html: inhalt,
          messageCount: eintrag.messageCount,
          downloadName: `ticket-${nummer}${audience === 'STAFF' ? '-intern' : ''}.html`,
        };
      }
    }
  }

  return renderTranscript(ticketId, audience);
}

/**
 * Abgelaufene Transcript-Dateien entfernen.
 *
 * Nur die Dateien - der Verlauf in der Datenbank bleibt. Ohne ausdrueckliche
 * Frist geschieht nichts: eine stillschweigende Voreinstellung, die Daten
 * loescht, waere die falsche Voreinstellung.
 */
export async function purgeExpiredTranscripts(retentionDays: number): Promise<number> {
  if (retentionDays <= 0) {
    return 0;
  }
  const grenze = new Date(Date.now() - retentionDays * 24 * 3600_000);
  const alte = await prisma.ticketTranscript.findMany({
    where: { createdAt: { lt: grenze } },
    select: { id: true, fileName: true },
  });

  for (const eintrag of alte) {
    await entferneDatei(eintrag.fileName);
  }
  if (alte.length > 0) {
    await prisma.ticketTranscript.deleteMany({
      where: { id: { in: alte.map((eintrag) => eintrag.id) } },
    });
    logger.info('Transcripts nach Ablauf entfernt', { anzahl: alte.length, retentionDays });
  }
  return alte.length;
}

async function entferneDatei(fileName: string): Promise<void> {
  if (!NAMENSMUSTER.test(fileName)) {
    return;
  }
  const ziel = resolve(TRANSCRIPT_DIR, fileName);
  if (!ziel.startsWith(resolve(TRANSCRIPT_DIR) + '/')) {
    return;
  }
  await rm(ziel, { force: true }).catch(() => undefined);
}

/** Kurzer Inhaltshash - nur fuer Tests und Protokolle, nie fuer Zugriff. */
export function transcriptFingerprint(html: string): string {
  return createHash('sha256').update(html).digest('hex').slice(0, 12);
}

function escape(text: string): string {
  return text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}
