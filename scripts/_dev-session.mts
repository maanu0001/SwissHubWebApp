import { prisma } from '@swisshub/database';
import { createSession } from '@swisshub/auth';
import { setModuleEnabled } from '@swisshub/modules';

const DISCORD_ID = process.env.SWISSHUB_OWNER_DISCORD_ID ?? '100000000000000001';
const user = await prisma.user.upsert({
  where: { discordId: DISCORD_ID },
  create: { discordId: DISCORD_ID, username: 'manu', appRole: 'ADMIN' },
  update: { appRole: 'ADMIN' },
});
await setModuleEnabled('level', true, 'dev');
const { token } = await createSession(user.id);
process.stdout.write(`${token}\n`);
await prisma.$disconnect();
