import 'dotenv/config';
import argon2 from 'argon2';
import { EntityStatus, PrismaClient, Role } from '@prisma/client';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();
const demoEmails = ['admin@taazur.local', 'operator@taazur.local'];

async function removeOrDisableDemoAccounts() {
  const randomHash = await argon2.hash(randomBytes(48).toString('base64url'));

  for (const email of demoEmails) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { _count: { select: { transactions: true, auditLogs: true } } }
    });

    if (!user) continue;

    if (user._count.transactions === 0 && user._count.auditLogs === 0) {
      await prisma.user.delete({ where: { id: user.id } });
      continue;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        status: EntityStatus.INACTIVE,
        passwordHash: randomHash
      }
    });
  }
}

async function createOfficialAdmin() {
  const email = process.env.OFFICIAL_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.OFFICIAL_ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn('OFFICIAL_ADMIN_EMAIL/OFFICIAL_ADMIN_PASSWORD are not set; skipped official admin creation.');
    return;
  }

  if (password.length < 16) throw new Error('OFFICIAL_ADMIN_PASSWORD must be at least 16 characters.');

  const passwordHash = await argon2.hash(password);
  await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: Role.ASSOCIATION_ADMIN, status: EntityStatus.ACTIVE, schoolId: null },
    create: { email, passwordHash, role: Role.ASSOCIATION_ADMIN, status: EntityStatus.ACTIVE }
  });
}

async function main() {
  await removeOrDisableDemoAccounts();
  await createOfficialAdmin();
}

main().finally(() => prisma.$disconnect());
