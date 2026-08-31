import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function safeJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2);
}

async function counts() {
  const [
    users,
    schools,
    students,
    cards,
    wallets,
    transactions,
    canteens,
    settlements,
    auditLogs,
    errorLogs
  ] = await Promise.all([
    prisma.user.count(),
    prisma.school.count(),
    prisma.student.count(),
    prisma.card.count(),
    prisma.wallet.count(),
    prisma.walletTransaction.count(),
    prisma.canteen.count(),
    prisma.canteenSettlement.count(),
    prisma.auditLog.count(),
    prisma.errorLog.count()
  ]);
  return { users, schools, students, cards, wallets, transactions, canteens, settlements, auditLogs, errorLogs };
}

async function createBackup() {
  const backupData = {
    exportedAt: new Date().toISOString(),
    note: 'Taazur operational JSON backup. Password hashes are intentionally excluded.',
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
      auditLogs: await prisma.auditLog.findMany({ orderBy: { timestamp: 'asc' } }),
      errorLogs: await prisma.errorLog.findMany({ orderBy: { createdAt: 'asc' } }),
      systemSettings: await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } })
    }
  };
  const backupDir = join(process.cwd(), '..', 'outputs', 'backups');
  await mkdir(backupDir, { recursive: true });
  const fileName = `taazur-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const backupPath = join(backupDir, fileName);
  await writeFile(backupPath, safeJson(backupData), 'utf8');
  console.log('Backup written:', backupPath);
  console.log('Counts:', backupData.counts);
}

createBackup()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
