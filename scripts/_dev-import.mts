import { readFile } from 'node:fs/promises';
import { prisma } from '@swisshub/database';
import { level } from '@swisshub/modules';

const ACTOR = { discordId: '100000000000000001', username: 'manu' };
const FILE = process.argv[2]!;

const data = new Uint8Array(await readFile(FILE));
const t0 = Date.now();
const analysis = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });
process.stdout.write(
  `ANALYSE (${Date.now() - t0} ms)\n` +
    `  sha256      ${analysis.fileSha256.slice(0, 16)}…\n` +
    `  Zeilen      ${analysis.counts.total}\n` +
    `  übernehmbar ${analysis.counts.importable}\n` +
    `  Duplikate   ${analysis.counts.duplicate}\n` +
    `  leer        ${analysis.counts.empty}\n` +
    `  unbrauchbar ${analysis.counts.invalid}\n` +
    `  XP-Summe    ${analysis.totalXp}\n` +
    `  höchstes Lv ${analysis.highestLevel}\n`,
);
for (const row of analysis.rows.filter((r) => r.kind !== 'PROFILE' && r.kind !== 'GAME_STATS')) {
  process.stdout.write(`  [${row.action}] ${row.kind}: ${row.label}${row.note ? ` — ${row.note}` : ''}\n`);
}

const t1 = Date.now();
const result = await level.executeLevelImport(ACTOR, analysis.importId, { legacyBotStopped: true });
process.stdout.write(
  `\nÜBERNAHME (${Date.now() - t1} ms)\n` +
    `  übernommen  ${result.imported}\n` +
    `  fehlerhaft  ${result.failed}\n` +
    `  XP          ${result.totalXp}\n` +
    `  Einstellungen ${result.settingsChanged.join(', ') || '—'}${result.settingsError ? ` (Fehler: ${result.settingsError})` : ''}\n`,
);

const profiles = await prisma.levelProfile.count();
const sum = await prisma.levelProfile.aggregate({ _sum: { xp: true, messages: true, voiceMinutes: true } });
const ledger = await prisma.xpTransaction.aggregate({ _sum: { delta: true }, _count: { _all: true } });
process.stdout.write(
  `\nDATENBANK\n  Profile ${profiles}\n  XP ${sum._sum.xp}\n  Nachrichten ${sum._sum.messages}\n  Voice-Min ${sum._sum.voiceMinutes}\n  Journalzeilen ${ledger._count._all}, Summe ${ledger._sum.delta}\n`,
);

const top = await prisma.levelProfile.findMany({ orderBy: { xp: 'desc' }, take: 5 });
process.stdout.write('\nTOP 5\n');
for (const p of top) {
  process.stdout.write(`  ${p.discordId}  ${p.xp} XP  Level ${level.levelFromXp(p.xp)}\n`);
}

// Zweiter Lauf: darf nichts mehr addieren.
const second = await level.analyseLevelImport(ACTOR, { name: 'levels.db', data });
process.stdout.write(
  `\nZWEITER LAUF\n  übernehmbar ${second.counts.importable}\n  Duplikate ${second.counts.duplicate}\n`,
);
const after = await prisma.levelProfile.aggregate({ _sum: { xp: true } });
process.stdout.write(`  XP unverändert: ${after._sum.xp === sum._sum.xp}\n`);

await prisma.$disconnect();
