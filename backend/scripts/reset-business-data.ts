import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();
const confirmation = process.argv.includes('--confirm') ? process.argv[process.argv.indexOf('--confirm') + 1] : '';
const requiredConfirmation = 'RESET_TAAZUR_BUSINESS_DATA';
const removableUserRoles = [Role.SCHOOL_ADMIN, Role.CANTEEN_OPERATOR, Role.CANTEEN_CASHIER, Role.CANTEEN_OWNER];

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
}

async function counts() {
  const [
    schools,
    students,
    cards,
    wallets,
    transactions,
    canteens,
    settlements,
    auditLogs,
    canteenAndSchoolUsers
  ] = await Promise.all([
    prisma.school.count(),
    prisma.student.count(),
    prisma.card.count(),
    prisma.wallet.count(),
    prisma.walletTransaction.count(),
    prisma.canteen.count(),
    prisma.canteenSettlement.count(),
    prisma.auditLog.count(),
    prisma.user.count({ where: { role: { in: removableUserRoles } } })
  ]);
  return { schools, students, cards, wallets, transactions, canteens, settlements, auditLogs, canteenAndSchoolUsers };
}

async function backup() {
  const backupData = {
    exportedAt: new Date().toISOString(),
    note: 'Backup before resetting Taazur business data. User password hashes are intentionally excluded.',
    counts: await counts(),
    data: {
      users: await prisma.user.findMany({
        orderBy: { createdAt: 'asc' },
        select: { id: true, email: true, role: true, status: true, schoolId: true, createdAt: true, updatedAt: true }
      }),
      schools: await prisma.school.findMany({ orderBy: { createdAt: 'asc' } }),
      students: await prisma.student.findMany({ orderBy: { createdAt: 'asc' } }),
      cards: await prisma.card.findMany({ orderBy: { issuedAt: 'asc' } }),
      wallets: await prisma.wallet.findMany(),
      transactions: await prisma.walletTransaction.findMany({ orderBy: { createdAt: 'asc' } }),
      canteens: await prisma.canteen.findMany({ orderBy: { createdAt: 'asc' } }),
      settlements: await prisma.canteenSettlement.findMany({ orderBy: { createdAt: 'asc' } }),
      auditLogs: await prisma.auditLog.findMany({ orderBy: { timestamp: 'asc' } })
    }
  };
  const backupDir = join(process.cwd(), '..', 'outputs', 'backups');
  await mkdir(backupDir, { recursive: true });
  const fileName = `taazur-business-reset-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const backupPath = join(backupDir, fileName);
  await writeFile(backupPath, safeJson(backupData), 'utf8');
  return backupPath;
}

async function resetBusinessData() {
  const users = await prisma.user.findMany({ where: { role: { in: removableUserRoles } }, select: { id: true } });
  const removableUserIds = users.map(user => user.id);

  await prisma.$transaction(async tx => {
    await tx.auditLog.deleteMany();
    await tx.canteenSettlement.deleteMany();
    await tx.walletTransaction.deleteMany();
    await tx.card.deleteMany();
    await tx.wallet.deleteMany();
    await tx.canteen.deleteMany();
    await tx.student.deleteMany();
    if (removableUserIds.length) {
      await tx.userSession.deleteMany({ where: { userId: { in: removableUserIds } } });
      await tx.user.deleteMany({ where: { id: { in: removableUserIds } } });
    }
    await tx.loginAttempt.deleteMany();
    await tx.school.deleteMany();
  });
}

async function main() {
  if (confirmation !== requiredConfirmation) {
    console.error(`Refusing to reset data. Run with: --confirm ${requiredConfirmation}`);
    process.exitCode = 1;
    return;
  }

  const before = await counts();
  console.log('Before reset:', before);
  const backupPath = await backup();
  console.log('Backup written:', backupPath);
  await resetBusinessData();
  const after = await counts();
  console.log('After reset:', after);
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
