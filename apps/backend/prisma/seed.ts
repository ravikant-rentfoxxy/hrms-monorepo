/**
 * Creates (or updates) the platform SUPER_ADMIN from env vars.
 * Run: npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const email = (process.env.SUPERADMIN_EMAIL ?? 'superadmin@hrms.local').toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD ?? 'SuperAdmin@123';
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, role: 'SUPER_ADMIN' },
    update: { role: 'SUPER_ADMIN', isActive: true },
  });
  // eslint-disable-next-line no-console
  console.log(`Super admin ready: ${user.email} (id ${user.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
