import 'dotenv/config';
import argon2 from 'argon2';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import { EntityStatus, Prisma, PrismaClient, Role, TransactionType } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
const cookieName = 'taazur_access_token';
const loginWindowMs = 15 * 60 * 1000;
const maxFailedLogins = 5;
const cookieSecure = process.env.COOKIE_SECURE !== 'false';
const allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:3000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));
app.use((req, res, next) => {
  const origin = req.header('origin');
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (unsafe && origin && !allowedOrigins.includes(origin)) return res.status(403).json({ error: 'ORIGIN_DENIED' });
  next();
});
app.use(express.json({ limit: '32kb' }));

type Claims = { sub: string; role: Role; schoolId?: string };
type AuditInput = {
  action: string;
  entity: string;
  entityId: string;
  schoolId?: string | null;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
};

declare global { namespace Express { interface Request { claims?: Claims } } }

const cleanJson = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const scopedSchool = (claims: Claims, schoolId: string) => !claims.schoolId || claims.schoolId === schoolId;
const requestIp = (req: Request) => (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
const requestUserAgent = (req: Request) => req.header('user-agent')?.slice(0, 500);
const cookieToken = (req: Request) => req.header('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
const routeParam = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value ?? '';

async function audit(tx: Prisma.TransactionClient, req: Request, input: AuditInput) {
  await tx.auditLog.create({
    data: {
      userId: req.claims?.sub,
      schoolId: input.schoolId ?? req.claims?.schoolId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      oldValue: input.oldValue,
      newValue: input.newValue,
      ip: requestIp(req),
      userAgent: requestUserAgent(req)
    }
  });
}

const auth = (req: Request, res: Response, next: NextFunction) => {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '') || cookieToken(req);
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  try { req.claims = jwt.verify(token, process.env.JWT_SECRET!) as Claims; next(); }
  catch { return res.status(401).json({ error: 'INVALID_TOKEN' }); }
};

const roles = (...allowed: Role[]) => (req: Request, res: Response, next: NextFunction) =>
  req.claims && allowed.includes(req.claims.role) ? next() : res.status(403).json({ error: 'FORBIDDEN' });

const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(12).max(128) });
app.post('/api/v1/auth/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const email = input.email.toLowerCase();
    const now = new Date();
    const attempt = await prisma.loginAttempt.findUnique({ where: { email } });

    if (attempt?.lockedUntil && attempt.lockedUntil > now) return res.status(429).json({ error: 'LOGIN_LOCKED' });

    const user = await prisma.user.findUnique({ where: { email } });
    const validPassword = !!user && user.status === EntityStatus.ACTIVE && await argon2.verify(user.passwordHash, input.password);

    if (!validPassword || !user) {
      const nextFailedCount = (attempt?.failedCount ?? 0) + 1;
      await prisma.loginAttempt.upsert({
        where: { email },
        create: {
          email,
          failedCount: nextFailedCount,
          lockedUntil: nextFailedCount >= maxFailedLogins ? new Date(Date.now() + loginWindowMs) : null,
          lastAttemptAt: now
        },
        update: {
          failedCount: nextFailedCount,
          lockedUntil: nextFailedCount >= maxFailedLogins ? new Date(Date.now() + loginWindowMs) : null,
          lastAttemptAt: now
        }
      });
      return res.status(nextFailedCount >= maxFailedLogins ? 429 : 401).json({ error: nextFailedCount >= maxFailedLogins ? 'LOGIN_LOCKED' : 'INVALID_CREDENTIALS' });
    }

    await prisma.loginAttempt.deleteMany({ where: { email } });
    const token = jwt.sign({ sub: user.id, role: user.role, schoolId: user.schoolId ?? undefined }, process.env.JWT_SECRET!, { expiresIn: '15m' });
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSecure ? 'none' : 'lax',
      path: '/',
      maxAge: 15 * 60 * 1000
    });
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        schoolId: user.schoolId,
        action: 'AUTH_LOGIN',
        entity: 'User',
        entityId: user.id,
        ip: requestIp(req),
        userAgent: requestUserAgent(req)
      }
    }).catch(() => undefined);
    return res.json({ user: { email: user.email, role: user.role, schoolId: user.schoolId } });
  } catch (error) { next(error); }
});

app.post('/api/v1/auth/logout', (_req, res) => {
  res.clearCookie(cookieName, { httpOnly: true, secure: cookieSecure, sameSite: cookieSecure ? 'none' : 'lax', path: '/' });
  res.json({ ok: true });
});

const schoolSchema = z.object({ schoolCode: z.string().trim().min(3).max(32), name: z.string().trim().min(3).max(150), city: z.string().trim().min(2).max(80), district: z.string().trim().max(80).optional(), address: z.string().trim().max(300).optional() });
app.get('/api/v1/schools', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const where = req.claims!.schoolId ? { id: req.claims!.schoolId } : {};
    const schools = await prisma.school.findMany({ where, orderBy: { name: 'asc' }, select: { id: true, schoolCode: true, name: true, city: true, district: true, status: true, _count: { select: { students: true } } } });
    res.json({ schools });
  } catch (error) { next(error); }
});
app.post('/api/v1/schools', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN), async (req, res, next) => {
  try {
    const school = await prisma.school.create({ data: schoolSchema.parse(req.body) });
    await prisma.auditLog.create({ data: { userId: req.claims!.sub, schoolId: school.id, action: 'SCHOOL_CREATED', entity: 'School', entityId: school.id, newValue: cleanJson(school), ip: requestIp(req), userAgent: requestUserAgent(req) } });
    res.status(201).json({ school });
  } catch (error) { next(error); }
});

const canteenUserSchema = z.object({ email: z.string().trim().email(), password: z.string().min(12).max(128), schoolId: z.string().cuid() });
app.get('/api/v1/canteen-users', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const where = { role: Role.CANTEEN_OPERATOR, status: EntityStatus.ACTIVE, ...(req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {}) };
    const users = await prisma.user.findMany({ where, select: { id: true, email: true, role: true, schoolId: true, school: { select: { name: true, schoolCode: true } }, createdAt: true }, orderBy: { createdAt: 'desc' } });
    res.json({ users });
  } catch (error) { next(error); }
});
app.post('/api/v1/canteen-users', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = canteenUserSchema.parse(req.body);
    if (!scopedSchool(req.claims!, input.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const passwordHash = await argon2.hash(input.password);
    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({ data: { email: input.email.toLowerCase(), passwordHash, role: Role.CANTEEN_OPERATOR, schoolId: input.schoolId }, select: { id: true, email: true, role: true, schoolId: true, school: { select: { name: true, schoolCode: true } }, createdAt: true } });
      await audit(tx, req, { action: 'CANTEEN_USER_CREATED', entity: 'User', entityId: created.id, schoolId: input.schoolId, newValue: { email: created.email, schoolId: created.schoolId } });
      return created;
    });
    res.status(201).json({ user });
  } catch (error) { next(error); }
});

const studentSchema = z.object({ studentCode: z.string().trim().min(3).max(32), fullName: z.string().trim().min(3).max(150), grade: z.string().trim().min(1).max(32), className: z.string().trim().max(32).optional(), schoolId: z.string().cuid(), dailyLimit: z.coerce.number().positive().max(500), weeklyLimit: z.coerce.number().positive().max(2000).optional() });
const studentUpdateSchema = studentSchema.pick({ studentCode: true, fullName: true, grade: true, schoolId: true, dailyLimit: true }).partial();
app.get('/api/v1/students', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId : req.claims!.schoolId;
    if (schoolId && !scopedSchool(req.claims!, schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const students = await prisma.student.findMany({ where: schoolId ? { schoolId } : {}, include: { school: { select: { name: true } }, wallet: { select: { balance: true, currency: true } }, cards: { where: { status: 'ACTIVE' }, select: { id: true, publicToken: true, issuedAt: true } } }, orderBy: { fullName: 'asc' } });
    res.json({ students });
  } catch (error) { next(error); }
});
app.post('/api/v1/students', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = studentSchema.parse(req.body);
    if (!scopedSchool(req.claims!, input.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const student = await prisma.$transaction(async tx => {
      const created = await tx.student.create({ data: input });
      await tx.wallet.create({ data: { studentId: created.id } });
      await tx.card.create({ data: { studentId: created.id, publicToken: `CARD-${randomBytes(32).toString('base64url')}` } });
      await audit(tx, req, { action: 'STUDENT_CREATED', entity: 'Student', entityId: created.id, schoolId: created.schoolId, newValue: cleanJson(input) });
      return created;
    });
    res.status(201).json({ student });
  } catch (error) { next(error); }
});
app.patch('/api/v1/students/:studentId', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = studentUpdateSchema.parse(req.body);
    const current = await prisma.student.findUniqueOrThrow({ where: { id: routeParam(req.params.studentId) }, select: { id: true, studentCode: true, fullName: true, grade: true, dailyLimit: true, schoolId: true } });
    if (!scopedSchool(req.claims!, current.schoolId) || (input.schoolId && !scopedSchool(req.claims!, input.schoolId))) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const student = await prisma.$transaction(async tx => {
      const updated = await tx.student.update({ where: { id: current.id }, data: input });
      await audit(tx, req, { action: 'STUDENT_UPDATED', entity: 'Student', entityId: current.id, schoolId: updated.schoolId, oldValue: cleanJson({ studentCode: current.studentCode, fullName: current.fullName, grade: current.grade, dailyLimit: Number(current.dailyLimit), schoolId: current.schoolId }), newValue: cleanJson(input) });
      return updated;
    });
    res.json({ student });
  } catch (error) { next(error); }
});

app.post('/api/v1/cards/:cardId/revoke', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const card = await prisma.card.findUniqueOrThrow({ where: { id: routeParam(req.params.cardId) }, include: { student: true } });
    if (!scopedSchool(req.claims!, card.student.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const revoked = await prisma.$transaction(async tx => {
      const updated = await tx.card.update({ where: { id: card.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
      await audit(tx, req, { action: 'CARD_REVOKED', entity: 'Card', entityId: card.id, schoolId: card.student.schoolId, oldValue: { status: card.status }, newValue: { status: 'REVOKED' } });
      return updated;
    });
    res.json({ card: revoked });
  } catch (error) { next(error); }
});
app.post('/api/v1/students/:studentId/cards', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const student = await prisma.student.findUniqueOrThrow({ where: { id: routeParam(req.params.studentId) } });
    if (!scopedSchool(req.claims!, student.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const card = await prisma.$transaction(async tx => {
      await tx.card.updateMany({ where: { studentId: student.id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } });
      const created = await tx.card.create({ data: { studentId: student.id, publicToken: `CARD-${randomBytes(32).toString('base64url')}` } });
      await audit(tx, req, { action: 'CARD_ISSUED', entity: 'Card', entityId: created.id, schoolId: student.schoolId, newValue: { studentId: student.id } });
      return created;
    });
    res.status(201).json({ card });
  } catch (error) { next(error); }
});
app.get('/api/v1/cards', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = req.claims!.schoolId;
    const cards = await prisma.card.findMany({ where: schoolId ? { student: { schoolId } } : {}, include: { student: { select: { id: true, fullName: true, studentCode: true, school: { select: { name: true } } } } }, orderBy: { issuedAt: 'desc' } });
    res.json({ cards });
  } catch (error) { next(error); }
});

const topUpSchema = z.object({ studentId: z.string().cuid(), amount: z.coerce.number().positive().max(10000) });
app.post('/api/v1/wallets/top-up', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = topUpSchema.parse(req.body);
    const student = await prisma.student.findUniqueOrThrow({ where: { id: input.studentId }, include: { wallet: true } });
    if (!student.wallet) throw new Error('WALLET_NOT_FOUND');
    if (!scopedSchool(req.claims!, student.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const transaction = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string; balance: unknown }>>`SELECT id, balance FROM Wallet WHERE id = ${student.wallet!.id} FOR UPDATE`;
      const wallet = rows[0];
      if (!wallet) throw new Error('WALLET_NOT_FOUND');
      const balanceBefore = Number(wallet.balance);
      const balanceAfter = balanceBefore + input.amount;
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
      const created = await tx.walletTransaction.create({ data: { reference: randomUUID(), walletId: wallet.id, studentId: student.id, schoolId: student.schoolId, amount: input.amount, type: TransactionType.CREDIT, balanceBefore, balanceAfter, performedById: req.claims!.sub } });
      await audit(tx, req, { action: 'WALLET_TOP_UP', entity: 'WalletTransaction', entityId: created.id, schoolId: student.schoolId, newValue: cleanJson({ studentId: student.id, amount: input.amount, balanceBefore, balanceAfter }) });
      return created;
    });
    res.status(201).json({ transaction });
  } catch (error) { next(error); }
});
app.get('/api/v1/transactions', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId : req.claims!.schoolId;
    const studentId = typeof req.query.studentId === 'string' ? req.query.studentId : undefined;
    const type = typeof req.query.type === 'string' && Object.values(TransactionType).includes(req.query.type as TransactionType) ? req.query.type as TransactionType : undefined;
    if (schoolId && !scopedSchool(req.claims!, schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const transactions = await prisma.walletTransaction.findMany({ where: { ...(schoolId ? { schoolId } : {}), ...(studentId ? { studentId } : {}), ...(type ? { type } : {}) }, include: { school: { select: { name: true } }, performedBy: { select: { email: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    const totals = await prisma.walletTransaction.groupBy({ by: ['type'], where: { ...(schoolId ? { schoolId } : {}), ...(studentId ? { studentId } : {}) }, _sum: { amount: true } });
    const studentIds = [...new Set(transactions.map(transaction => transaction.studentId))];
    const students = await prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, fullName: true, studentCode: true } });
    const studentMap = new Map(students.map(student => [student.id, student]));
    res.json({ transactions: transactions.map(transaction => ({ ...transaction, student: studentMap.get(transaction.studentId) })), totals });
  } catch (error) { next(error); }
});
app.get('/api/v1/dashboard', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = req.claims!.schoolId;
    const studentWhere = schoolId ? { schoolId } : {};
    const walletWhere = schoolId ? { student: { schoolId } } : {};
    const transactionWhere = schoolId ? { schoolId } : {};
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const [schools, students, walletBalance, todayTransactions, todaySpent, revokedCards] = await Promise.all([
      prisma.school.count({ where: schoolId ? { id: schoolId } : {} }),
      prisma.student.count({ where: studentWhere }),
      prisma.wallet.aggregate({ where: walletWhere, _sum: { balance: true } }),
      prisma.walletTransaction.count({ where: { ...transactionWhere, createdAt: { gte: startOfDay } } }),
      prisma.walletTransaction.aggregate({ where: { ...transactionWhere, type: TransactionType.DEBIT, createdAt: { gte: startOfDay } }, _sum: { amount: true } }),
      prisma.card.count({ where: { status: 'REVOKED', ...(schoolId ? { student: { schoolId } } : {}) } })
    ]);
    res.json({ schools, students, walletBalance: walletBalance._sum.balance ?? 0, todayTransactions, todaySpent: todaySpent._sum.amount ?? 0, revokedCards });
  } catch (error) { next(error); }
});

const debitSchema = z.object({ cardToken: z.string().min(20).max(128), amount: z.coerce.number().positive().max(1000) });
app.post('/api/v1/transactions/debit', auth, roles(Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    const idempotencyKey = req.header('idempotency-key');
    if (!idempotencyKey) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    const input = debitSchema.parse(req.body);
    const existing = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) return res.status(200).json({ transaction: existing, replayed: true });
    const transaction = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<Array<{ id: string; balance: number }>>`
        SELECT w.id, w.balance FROM Wallet w JOIN Card c ON c.studentId = w.studentId
        WHERE c.publicToken = ${input.cardToken} AND c.status = 'ACTIVE' FOR UPDATE`;
      const wallet = rows[0];
      const balanceBefore = wallet ? Number(wallet.balance) : 0;
      if (!wallet || balanceBefore < input.amount) throw new Error('INSUFFICIENT_BALANCE');
      const card = await tx.card.findUniqueOrThrow({ where: { publicToken: input.cardToken }, include: { student: true } });
      if (card.student.status !== 'ACTIVE') throw new Error('STUDENT_INACTIVE');
      if (req.claims!.schoolId && req.claims!.schoolId !== card.student.schoolId) throw new Error('SCHOOL_SCOPE_DENIED');
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const today = await tx.walletTransaction.aggregate({ where: { studentId: card.studentId, type: TransactionType.DEBIT, createdAt: { gte: startOfDay } }, _sum: { amount: true } });
      if (Number(today._sum.amount ?? 0) + input.amount > Number(card.student.dailyLimit)) throw new Error('DAILY_LIMIT_EXCEEDED');
      const balanceAfter = balanceBefore - input.amount;
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
      const created = await tx.walletTransaction.create({ data: { reference: randomUUID(), idempotencyKey, walletId: wallet.id, studentId: card.studentId, schoolId: card.student.schoolId, amount: input.amount, type: TransactionType.DEBIT, balanceBefore, balanceAfter, performedById: req.claims!.sub } });
      await audit(tx, req, { action: 'CANTEEN_DEBIT', entity: 'WalletTransaction', entityId: created.id, schoolId: card.student.schoolId, newValue: cleanJson({ cardId: card.id, studentId: card.studentId, amount: input.amount, balanceBefore, balanceAfter }) });
      return created;
    });
    return res.status(201).json({ transaction });
  } catch (error) { next(error); }
});

async function refundDebit(originalId: string, claims: Claims, req: Request) {
  const original = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: originalId } });
  if (original.type !== TransactionType.DEBIT) throw new Error('REFUND_ONLY_DEBIT');
  if (!scopedSchool(claims, original.schoolId)) throw new Error('SCHOOL_SCOPE_DENIED');
  if (claims.role === Role.CANTEEN_OPERATOR && original.performedById !== claims.sub) throw new Error('FORBIDDEN');
  const refundReference = `REFUND-${original.id}`;
  const existing = await prisma.walletTransaction.findUnique({ where: { reference: refundReference } });
  if (existing) return { transaction: existing, replayed: true };
  const transaction = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string; balance: unknown }>>`SELECT id, balance FROM Wallet WHERE id = ${original.walletId} FOR UPDATE`;
    const wallet = rows[0];
    if (!wallet) throw new Error('WALLET_NOT_FOUND');
    const balanceBefore = Number(wallet.balance);
    const amount = Number(original.amount);
    const balanceAfter = balanceBefore + amount;
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
    const created = await tx.walletTransaction.create({ data: { reference: refundReference, walletId: wallet.id, studentId: original.studentId, schoolId: original.schoolId, amount, type: TransactionType.REFUND, balanceBefore, balanceAfter, performedById: claims.sub } });
    await audit(tx, req, { action: 'TRANSACTION_REFUNDED', entity: 'WalletTransaction', entityId: created.id, schoolId: original.schoolId, oldValue: { originalTransactionId: original.id, amount }, newValue: cleanJson({ refundTransactionId: created.id, balanceBefore, balanceAfter }) });
    return created;
  });
  return { transaction, replayed: false };
}
app.post('/api/v1/transactions/refund-by-reference', auth, roles(Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    const input = z.object({ reference: z.string().trim().min(8).max(80) }).parse(req.body);
    const original = await prisma.walletTransaction.findUnique({ where: { reference: input.reference } });
    if (!original) return res.status(404).json({ error: 'TRANSACTION_NOT_FOUND' });
    const result = await refundDebit(original.id, req.claims!, req);
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { next(error); }
});
app.post('/api/v1/transactions/:transactionId/refund', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const result = await refundDebit(routeParam(req.params.transactionId), req.claims!, req);
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { next(error); }
});
app.get('/api/v1/audit-logs', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {},
      include: { user: { select: { email: true, schoolId: true } }, school: { select: { name: true, schoolCode: true } } },
      orderBy: { timestamp: 'desc' },
      take: 200
    });
    res.json({ logs });
  } catch (error) { next(error); }
});

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const prismaCode = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: string }).code : undefined;
  const message = error instanceof z.ZodError ? 'VALIDATION_ERROR' : prismaCode === 'P2002' ? 'DUPLICATE_RECORD' : error instanceof Error ? error.message : 'INTERNAL_ERROR';
  const status = message === 'FORBIDDEN' || message === 'ORIGIN_DENIED' ? 403 : message === 'LOGIN_LOCKED' ? 429 : ['INSUFFICIENT_BALANCE', 'STUDENT_INACTIVE', 'SCHOOL_SCOPE_DENIED', 'DAILY_LIMIT_EXCEEDED', 'REFUND_ONLY_DEBIT'].includes(message) ? 409 : message === 'DUPLICATE_RECORD' ? 409 : 400;
  res.status(status).json({ error: message });
});
const port = Number(process.env.PORT ?? 4000);
app.listen(port, '0.0.0.0', () => console.log(`API listening on :${port}`));
