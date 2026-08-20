import { connectGuild, syncDiscord } from '@swisshub/modules';

async function main(): Promise<void> {
  await connectGuild({ guildId: '000000000000000000' });
  const summary = await syncDiscord({ trigger: 'manual' });
  process.stdout.write(`Rollen: ${summary.roles}, Channels: ${summary.channels}\n`);
  process.exit(0);
}
void main();
