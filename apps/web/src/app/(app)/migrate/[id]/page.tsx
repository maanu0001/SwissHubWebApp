import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { can } from '@swisshub/auth';
import { migration } from '@swisshub/modules';
import { discord, resolveGuildId } from '@swisshub/discord';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MigrationsAssistent } from '@/modules/migration/components/assistent';
import { csrfTokenFor, requirePagePermission } from '@/server/auth';

export const metadata: Metadata = { title: 'Übertragung' };
export const dynamic = 'force-dynamic';

/**
 * Der Assistent zu einer Übertragung.
 *
 * Der Zustand kommt aus der Datenbank und nicht aus dem Browser: Zuordnung,
 * Probelauf und Bericht überdauern jedes Neuladen und jeden Neustart. Was
 * die Seite hier tut, ist ihn zu zeigen.
 */
export default async function UebertragungPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const context = await requirePagePermission(migration.MIGRATION_PERMISSIONS.view);
  const csrfToken = csrfTokenFor(context);
  const { id } = await params;

  const guildId = await resolveGuildId().catch(() => '');
  const lauf = await migration.holeLauf(id, guildId).catch(() => null);
  if (!lauf) {
    notFound();
  }

  // Rollen und Kanäle des Ziels - dorthin wird zugeordnet. Dazu die eigenen
  // Kanäle, damit in der linken Spalte Namen stehen und keine Zahlen.
  const [zielRollen, zielKanaele, eigeneKanaele] = await Promise.all([
    discord.guild.rolesOf(lauf.targetGuildId).catch(() => []),
    discord.guild.channelsOf(lauf.targetGuildId).catch(() => []),
    discord.channels.list().catch(() => []),
  ]);

  const paket = migration.paketVon(lauf);
  const zuordnung = migration.zuordnungVon(lauf);

  // Beim ersten Öffnen liegt noch keine Zuordnung vor - dann stehen hier die
  // Vorschläge, damit niemand mit einer leeren Liste beginnt.
  const vorschlaege =
    zuordnung.roles.length === 0 && zuordnung.channels.length === 0
      ? {
          roles: migration.schlageRollenVor(paket.roles, zielRollen),
          channels: migration.schlageKanaeleVor(
            migration.kanaeleImPaket(paket).map((kanalId) => ({
              id: kanalId,
              name: eigeneKanaele.find((kanal) => kanal.id === kanalId)?.name ?? kanalId,
            })),
            zielKanaele,
          ),
        }
      : zuordnung;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Quelle und Ziel</CardTitle>
          <CardDescription>
            {paket.sourceGuild.name} ({paket.sourceGuild.id}) → {lauf.targetGuildId}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Das Paket trägt {paket.modules.length} Module, {paket.roles.length} Rollen und{' '}
          {paket.automations.length} Automationen. Zugangsdaten sind nicht darin - die Integrationen stehen
          nur mit ihrem Zustand da.
        </CardContent>
      </Card>

      <MigrationsAssistent
        csrfToken={csrfToken}
        runId={lauf.id}
        status={lauf.status}
        phase={lauf.phase}
        zuordnung={vorschlaege}
        zielRollen={zielRollen.map((rolle) => ({ id: rolle.id, name: rolle.name }))}
        zielKanaele={zielKanaele.map((kanal) => ({ id: kanal.id, name: kanal.name }))}
        plan={migration.planVon(lauf)}
        bericht={lauf.report as unknown as migration.AnwendungsErgebnis | null}
        hatSnapshot={lauf.snapshot !== null}
        darfZuordnen={can(context, migration.MIGRATION_PERMISSIONS.dryRun)}
        darfAnwenden={can(context, migration.MIGRATION_PERMISSIONS.execute)}
        darfZurueck={can(context, migration.MIGRATION_PERMISSIONS.rollback)}
      />
    </div>
  );
}
