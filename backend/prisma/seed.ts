import argon2 from 'argon2';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient();
async function main() {
  const passwordHash = await argon2.hash('TaazurDemo!2026');
  await prisma.user.upsert({
    where: { email: 'admin@taazur.local' },
    update: { passwordHash, role: Role.ASSOCIATION_ADMIN },
    create: { email: 'admin@taazur.local', passwordHash, role: Role.ASSOCIATION_ADMIN }
  });
  const schools = [
    { schoolCode: 'TAZ-001', name: 'مدرسة الأمل الابتدائية', city: 'الرياض', district: 'الملز' },
    { schoolCode: 'TAZ-002', name: 'مدرسة المستقبل المتوسطة', city: 'الرياض', district: 'النخيل' },
    { schoolCode: 'TAZ-003', name: 'مدرسة النهضة الثانوية', city: 'الرياض', district: 'العليا' }
  ];
  for (const school of schools) await prisma.school.upsert({ where: { schoolCode: school.schoolCode }, update: school, create: school });
  const firstSchool = await prisma.school.findUniqueOrThrow({ where: { schoolCode: 'TAZ-001' } });
  const operatorHash = await argon2.hash('CanteenDemo!2026');
  await prisma.user.upsert({ where: { email: 'operator@taazur.local' }, update: { passwordHash: operatorHash, role: Role.CANTEEN_OPERATOR, schoolId: firstSchool.id }, create: { email: 'operator@taazur.local', passwordHash: operatorHash, role: Role.CANTEEN_OPERATOR, schoolId: firstSchool.id } });
}
main().finally(() => prisma.$disconnect());
