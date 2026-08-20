import { prisma } from '@swisshub/database';
import { createSession } from '@swisshub/auth';
async function main(): Promise<void> {
  const user = await prisma.user.upsert({
    where: { discordId: '100000000000000001' },
    create: { discordId: '100000000000000001', username: 'manuel', globalName: 'Manuel', appRole: 'USER' },
    update: {},
  });
  const session = await createSession(user.id, {});
  process.stdout.write(`${session.token}\n`);
  await prisma.$disconnect();
}
void main();
