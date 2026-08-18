import 'dotenv/config';
import argon2 from 'argon2';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { randomBytes, randomUUID } from 'node:crypto';
import { CardStatus, EntityStatus, Prisma, PrismaClient, Role, TransactionType } from '@prisma/client';
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
const money = (value: unknown) => Number(value ?? 0);
const asMoney = (value: unknown) => money(value).toFixed(2);
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const maskToken = (token: string) => token.length > 16 ? `${token.slice(0, 12)}…${token.slice(-4)}` : token;
const startOfToday = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};
const daysAgo = (days: number) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
};
const startOfThisMonth = () => {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
};
const parseMonthRange = (month?: unknown) => {
  const text = typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = text.split('-').map(Number);
  const start = new Date(year, monthNumber - 1, 1);
  const end = new Date(year, monthNumber, 1);
  return { text, start, end };
};

function scopedSchoolFromQuery(req: Request) {
  const requested = typeof req.query.schoolId === 'string' && req.query.schoolId ? req.query.schoolId : undefined;
  const schoolId = req.claims!.schoolId ?? requested;
  if (requested && !scopedSchool(req.claims!, requested)) throw new Error('SCHOOL_SCOPE_DENIED');
  return schoolId;
}

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

function sendCsv(res: Response, filename: string, rows: unknown[][]) {
  const csv = rows.map(row => row.map(csvCell).join(',')).join('\n');
  res
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(`\ufeff${csv}`);
}

function sendExcelHtml(res: Response, filename: string, title: string, rows: unknown[][]) {
  const htmlRows = rows.map((row, index) => `<tr>${row.map(cell => `<${index === 0 ? 'th' : 'td'}>${String(cell ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))}</${index === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('');
  res
    .header('content-type', 'application/vnd.ms-excel; charset=utf-8')
    .header('content-disposition', `attachment; filename="${filename}"`)
    .send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>body{font-family:Tahoma,Arial}table{border-collapse:collapse;width:100%}th,td{border:1px solid #777;padding:8px;text-align:right}th{background:#eaf5ef}</style></head><body><h1>${title}</h1><table>${htmlRows}</table></body></html>`);
}

function sendPrintableReport(res: Response, title: string, rows: unknown[][]) {
  const htmlRows = rows.map((row, index) => `<tr>${row.map(cell => `<${index === 0 ? 'th' : 'td'}>${String(cell ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!))}</${index === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('');
  res
    .header('content-type', 'text/html; charset=utf-8')
    .send(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>@page{size:A4;margin:14mm}body{font-family:Tahoma,Arial;color:#14342a;background:#fff}.toolbar{margin:0 0 16px}@media print{.toolbar{display:none}}button{background:#0b5a42;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:700}h1{margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #b7c8bf;padding:8px;text-align:right;font-size:12px}th{background:#eaf5ef}</style></head><body><div class="toolbar"><button onclick="window.print()">طباعة / حفظ PDF</button></div><h1>${title}</h1><p>تقرير جاهز للطباعة والحفظ كملف PDF من المتصفح.</p><table>${htmlRows}</table></body></html>`);
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

app.get('/api/v1/auth/me', auth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.claims!.sub },
      select: { email: true, role: true, schoolId: true, status: true }
    });
    if (user.status !== EntityStatus.ACTIVE) return res.status(401).json({ error: 'INVALID_TOKEN' });
    res.json({ user });
  } catch (error) { next(error); }
});

const schoolSchema = z.object({ schoolCode: z.string().trim().min(3).max(32), name: z.string().trim().min(3).max(150), city: z.string().trim().min(2).max(80), district: z.string().trim().max(80).optional(), address: z.string().trim().max(300).optional() });
const schoolUpdateSchema = schoolSchema.extend({ status: z.nativeEnum(EntityStatus).optional() }).partial();
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
app.patch('/api/v1/schools/:schoolId', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = schoolUpdateSchema.parse(req.body);
    const current = await prisma.school.findUniqueOrThrow({ where: { id: routeParam(req.params.schoolId) } });
    if (!scopedSchool(req.claims!, current.id)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const school = await prisma.$transaction(async tx => {
      const updated = await tx.school.update({ where: { id: current.id }, data: input });
      await audit(tx, req, { action: 'SCHOOL_UPDATED', entity: 'School', entityId: current.id, schoolId: current.id, oldValue: cleanJson(current), newValue: cleanJson(input) });
      return updated;
    });
    res.json({ school });
  } catch (error) { next(error); }
});
app.delete('/api/v1/schools/:schoolId', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN), async (req, res, next) => {
  try {
    const schoolId = routeParam(req.params.schoolId);
    if (!scopedSchool(req.claims!, schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const [school, activeStudents] = await Promise.all([
      prisma.school.findUniqueOrThrow({ where: { id: schoolId } }),
      prisma.student.count({ where: { schoolId, status: EntityStatus.ACTIVE } })
    ]);
    if (activeStudents > 0) return res.status(409).json({ error: 'SCHOOL_HAS_ACTIVE_STUDENTS' });
    const updated = await prisma.$transaction(async tx => {
      const deleted = await tx.school.update({ where: { id: schoolId }, data: { status: EntityStatus.INACTIVE } });
      await tx.user.updateMany({ where: { schoolId }, data: { status: EntityStatus.INACTIVE } });
      await audit(tx, req, { action: 'SCHOOL_DEACTIVATED', entity: 'School', entityId: schoolId, schoolId, oldValue: cleanJson({ status: school.status }), newValue: { status: EntityStatus.INACTIVE } });
      return deleted;
    });
    res.json({ school: updated });
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
    if (input.schoolId) {
      const targetSchool = await prisma.school.findUniqueOrThrow({ where: { id: input.schoolId }, select: { status: true } });
      if (targetSchool.status !== EntityStatus.ACTIVE) return res.status(409).json({ error: 'SCHOOL_INACTIVE' });
    }
    const student = await prisma.$transaction(async tx => {
      const updated = await tx.student.update({ where: { id: current.id }, data: input });
      const moved = input.schoolId && input.schoolId !== current.schoolId;
      if (moved) {
        await tx.walletTransaction.updateMany({ where: { studentId: current.id }, data: { schoolId: input.schoolId } });
      }
      await audit(tx, req, { action: moved ? 'STUDENT_TRANSFERRED' : 'STUDENT_UPDATED', entity: 'Student', entityId: current.id, schoolId: updated.schoolId, oldValue: cleanJson({ studentCode: current.studentCode, fullName: current.fullName, grade: current.grade, dailyLimit: Number(current.dailyLimit), schoolId: current.schoolId }), newValue: cleanJson({ ...input, transferredTransactions: moved ? true : undefined }) });
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

async function monthlyExpenseRows(req: Request) {
  const schoolId = scopedSchoolFromQuery(req);
  const { text, start, end } = parseMonthRange(req.query.month);
  const where = { ...(schoolId ? { schoolId } : {}), createdAt: { gte: start, lt: end } };
  const transactions = await prisma.walletTransaction.findMany({
    where,
    include: { school: { select: { name: true } }, performedBy: { select: { email: true } } },
    orderBy: [{ schoolId: 'asc' }, { createdAt: 'asc' }]
  });
  const studentIds = [...new Set(transactions.map(transaction => transaction.studentId))];
  const students = await prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, fullName: true, studentCode: true, grade: true } });
  const studentMap = new Map(students.map(student => [student.id, student]));
  const rows = [
    ['الشهر', 'التاريخ', 'المدرسة', 'رمز الطالب', 'اسم الطالب', 'الصف', 'نوع العملية', 'المبلغ', 'الرصيد قبل', 'الرصيد بعد', 'منفذ العملية', 'رقم العملية'],
    ...transactions.map(transaction => {
      const student = studentMap.get(transaction.studentId);
      return [
        text,
        transaction.createdAt.toLocaleString('ar-SA'),
        transaction.school.name,
        student?.studentCode ?? transaction.studentId,
        student?.fullName ?? '—',
        student?.grade ?? '—',
        transaction.type,
        asMoney(transaction.amount),
        asMoney(transaction.balanceBefore),
        asMoney(transaction.balanceAfter),
        transaction.performedBy.email,
        transaction.reference
      ];
    })
  ];
  return { rows, month: text };
}

app.get('/api/v1/reports/summary', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = scopedSchoolFromQuery(req);
    const schoolWhere = schoolId ? { id: schoolId } : {};
    const studentSchoolWhere = schoolId ? { schoolId } : {};
    const transactionSchoolWhere = schoolId ? { schoolId } : {};
    const today = startOfToday();
    const week = daysAgo(6);
    const month = startOfThisMonth();
    const { start: reportStart, end: reportEnd } = parseMonthRange(req.query.month);

    const [
      schools,
      dailyBySchool,
      weeklyBySchool,
      monthlyBySchool,
      reportTransactions,
      activeStudents,
      studentDailyUsage,
      studentWeeklyUsage,
      studentMonthlyUsage
    ] = await Promise.all([
      prisma.school.findMany({ where: schoolWhere, select: { id: true, name: true, schoolCode: true }, orderBy: { name: 'asc' } }),
      prisma.walletTransaction.groupBy({ by: ['schoolId'], where: { ...transactionSchoolWhere, type: TransactionType.DEBIT, createdAt: { gte: today } }, _sum: { amount: true }, _count: { id: true } }),
      prisma.walletTransaction.groupBy({ by: ['schoolId'], where: { ...transactionSchoolWhere, type: TransactionType.DEBIT, createdAt: { gte: week } }, _sum: { amount: true }, _count: { id: true } }),
      prisma.walletTransaction.groupBy({ by: ['schoolId'], where: { ...transactionSchoolWhere, type: TransactionType.DEBIT, createdAt: { gte: month } }, _sum: { amount: true }, _count: { id: true } }),
      prisma.walletTransaction.findMany({ where: { ...transactionSchoolWhere, type: { in: [TransactionType.DEBIT, TransactionType.REFUND] }, createdAt: { gte: reportStart, lt: reportEnd } }, select: { studentId: true, schoolId: true, amount: true, type: true, createdAt: true } }),
      prisma.student.findMany({ where: { ...studentSchoolWhere, status: EntityStatus.ACTIVE }, select: { id: true, fullName: true, studentCode: true, schoolId: true, school: { select: { name: true } } } }),
      prisma.walletTransaction.groupBy({ by: ['studentId'], where: { ...transactionSchoolWhere, type: TransactionType.DEBIT, createdAt: { gte: today } }, _sum: { amount: true }, _count: { id: true } }),
      prisma.walletTransaction.groupBy({ by: ['studentId'], where: { ...transactionSchoolWhere, type: TransactionType.DEBIT, createdAt: { gte: week } }, _sum: { amount: true }, _count: { id: true } }),
      prisma.walletTransaction.groupBy({ by: ['studentId'], where: { ...transactionSchoolWhere, type: TransactionType.DEBIT, createdAt: { gte: month } }, _sum: { amount: true }, _count: { id: true } })
    ]);

    const schoolMap = new Map(schools.map(school => [school.id, school]));
    const schoolMetricMap = (rows: typeof dailyBySchool) => new Map(rows.map(row => [row.schoolId, { amount: asMoney(row._sum.amount), count: row._count.id }]));
    const dailyMap = schoolMetricMap(dailyBySchool);
    const weeklyMap = schoolMetricMap(weeklyBySchool);
    const monthlyMap = schoolMetricMap(monthlyBySchool);
    const usageByStudent = new Map(activeStudents.map(student => [student.id, { student, day: { count: 0, amount: 0 }, week: { count: 0, amount: 0 }, month: { count: 0, amount: 0 } }]));

    for (const row of studentDailyUsage) {
      const item = usageByStudent.get(row.studentId);
      if (item) item.day = { count: row._count.id, amount: money(row._sum.amount) };
    }
    for (const row of studentWeeklyUsage) {
      const item = usageByStudent.get(row.studentId);
      if (item) item.week = { count: row._count.id, amount: money(row._sum.amount) };
    }
    for (const row of studentMonthlyUsage) {
      const item = usageByStudent.get(row.studentId);
      if (item) item.month = { count: row._count.id, amount: money(row._sum.amount) };
    }

    const byDay = new Map<string, { date: string; debit: number; refund: number; net: number; count: number }>();
    const schoolActivity = new Map<string, { schoolId: string; schoolName: string; amount: number; count: number }>();
    const studentActivity = new Map<string, { studentId: string; schoolName: string; fullName: string; studentCode: string; amount: number; count: number }>();
    const monthlyUsedStudents = new Set<string>();

    for (const transaction of reportTransactions) {
      const isDebit = transaction.type === TransactionType.DEBIT;
      const date = transaction.createdAt.toISOString().slice(0, 10);
      const day = byDay.get(date) ?? { date, debit: 0, refund: 0, net: 0, count: 0 };
      if (isDebit) {
        day.debit += money(transaction.amount);
        day.count += 1;
        monthlyUsedStudents.add(transaction.studentId);
      } else {
        day.refund += money(transaction.amount);
      }
      day.net = Math.max(0, day.debit - day.refund);
      byDay.set(date, day);

      if (isDebit) {
        const school = schoolMap.get(transaction.schoolId);
        const schoolItem = schoolActivity.get(transaction.schoolId) ?? { schoolId: transaction.schoolId, schoolName: school?.name ?? transaction.schoolId, amount: 0, count: 0 };
        schoolItem.amount += money(transaction.amount);
        schoolItem.count += 1;
        schoolActivity.set(transaction.schoolId, schoolItem);
      }
    }

    for (const item of usageByStudent.values()) {
      studentActivity.set(item.student.id, {
        studentId: item.student.id,
        schoolName: item.student.school.name,
        fullName: item.student.fullName,
        studentCode: item.student.studentCode,
        amount: item.month.amount,
        count: item.month.count
      });
    }

    res.json({
      spendingBySchool: schools.map(school => ({
        schoolId: school.id,
        schoolName: school.name,
        schoolCode: school.schoolCode,
        daily: dailyMap.get(school.id) ?? { amount: '0.00', count: 0 },
        weekly: weeklyMap.get(school.id) ?? { amount: '0.00', count: 0 },
        monthly: monthlyMap.get(school.id) ?? { amount: '0.00', count: 0 }
      })),
      topStudents: [...studentActivity.values()].filter(item => item.count > 0).sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, 10).map(item => ({ ...item, amount: asMoney(item.amount) })),
      topSchools: [...schoolActivity.values()].sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, 10).map(item => ({ ...item, amount: asMoney(item.amount) })),
      canteenByDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map(item => ({ ...item, debit: asMoney(item.debit), refund: asMoney(item.refund), net: asMoney(item.net) })),
      inactiveStudents: activeStudents.filter(student => !monthlyUsedStudents.has(student.id)).map(student => ({ id: student.id, fullName: student.fullName, studentCode: student.studentCode, schoolName: student.school.name })),
      studentUsage: [...usageByStudent.values()].map(item => ({
        studentId: item.student.id,
        fullName: item.student.fullName,
        studentCode: item.student.studentCode,
        schoolName: item.student.school.name,
        dailyCount: item.day.count,
        weeklyCount: item.week.count,
        monthlyCount: item.month.count,
        monthlyAmount: asMoney(item.month.amount)
      })).sort((a, b) => a.schoolName.localeCompare(b.schoolName, 'ar') || a.fullName.localeCompare(b.fullName, 'ar'))
    });
  } catch (error) { next(error); }
});

app.get('/api/v1/alerts', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = scopedSchoolFromQuery(req);
    const schoolWhere = schoolId ? { schoolId } : {};
    const today = startOfToday();
    const recent = daysAgo(7);
    const [lowWallets, students, todayDebits, todayRefunds, revokedAttempts, loginAttempts, refundGroups] = await Promise.all([
      prisma.wallet.findMany({ where: { balance: { lt: 10 }, student: schoolWhere }, include: { student: { select: { fullName: true, studentCode: true, dailyLimit: true, school: { select: { name: true } } } } }, take: 100, orderBy: { balance: 'asc' } }),
      prisma.student.findMany({ where: { ...schoolWhere, status: EntityStatus.ACTIVE }, select: { id: true, fullName: true, studentCode: true, dailyLimit: true, school: { select: { name: true } } } }),
      prisma.walletTransaction.findMany({ where: { ...(schoolId ? { schoolId } : {}), type: TransactionType.DEBIT, createdAt: { gte: today } }, select: { id: true, studentId: true, amount: true } }),
      prisma.walletTransaction.findMany({ where: { ...(schoolId ? { schoolId } : {}), type: TransactionType.REFUND, createdAt: { gte: today } }, select: { reference: true, studentId: true, amount: true } }),
      prisma.auditLog.findMany({ where: { ...(schoolId ? { schoolId } : {}), action: 'CARD_REVOKED_USED', timestamp: { gte: recent } }, include: { user: { select: { email: true } }, school: { select: { name: true } } }, orderBy: { timestamp: 'desc' }, take: 20 }),
      prisma.loginAttempt.findMany({ where: { failedCount: { gte: 3 } }, orderBy: { updatedAt: 'desc' }, take: 20 }),
      prisma.walletTransaction.groupBy({ by: ['performedById', 'schoolId'], where: { ...(schoolId ? { schoolId } : {}), type: TransactionType.REFUND, createdAt: { gte: recent } }, _count: { id: true }, _sum: { amount: true } })
    ]);

    const studentMap = new Map(students.map(student => [student.id, student]));
    const debitByStudent = new Map<string, { debit: number; refund: number }>();
    for (const debit of todayDebits) {
      const current = debitByStudent.get(debit.studentId) ?? { debit: 0, refund: 0 };
      current.debit += money(debit.amount);
      debitByStudent.set(debit.studentId, current);
    }
    for (const refund of todayRefunds.filter(refund => refund.reference.startsWith('REFUND-'))) {
      const current = debitByStudent.get(refund.studentId) ?? { debit: 0, refund: 0 };
      current.refund += money(refund.amount);
      debitByStudent.set(refund.studentId, current);
    }

    const refundUserIds = [...new Set(refundGroups.map(group => group.performedById))];
    const refundSchoolIds = [...new Set(refundGroups.map(group => group.schoolId))];
    const [refundUsers, refundSchools] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: refundUserIds } }, select: { id: true, email: true } }),
      prisma.school.findMany({ where: { id: { in: refundSchoolIds } }, select: { id: true, name: true } })
    ]);
    const refundUserMap = new Map(refundUsers.map(user => [user.id, user.email]));
    const refundSchoolMap = new Map(refundSchools.map(school => [school.id, school.name]));

    res.json({
      lowBalances: lowWallets.map(wallet => ({ studentName: wallet.student.fullName, studentCode: wallet.student.studentCode, schoolName: wallet.student.school.name, balance: asMoney(wallet.balance) })),
      dailyLimitReached: [...debitByStudent.entries()].map(([studentId, totals]) => ({ student: studentMap.get(studentId), net: Math.max(0, totals.debit - totals.refund) })).filter(item => item.student && item.net >= money(item.student.dailyLimit)).map(item => ({ studentName: item.student!.fullName, studentCode: item.student!.studentCode, schoolName: item.student!.school.name, dailyLimit: asMoney(item.student!.dailyLimit), spentToday: asMoney(item.net) })),
      revokedCardAttempts: revokedAttempts.map(log => ({ at: log.timestamp, schoolName: log.school?.name ?? '—', userEmail: log.user?.email ?? '—', token: typeof log.newValue === 'object' && log.newValue && 'cardToken' in log.newValue ? String(log.newValue.cardToken) : '—' })),
      failedLogins: loginAttempts.map(attempt => ({ email: attempt.email, failedCount: attempt.failedCount, lockedUntil: attempt.lockedUntil, lastAttemptAt: attempt.lastAttemptAt })),
      repeatedRefunds: refundGroups.filter(group => group._count.id >= 3).map(group => ({ userEmail: refundUserMap.get(group.performedById) ?? group.performedById, schoolName: refundSchoolMap.get(group.schoolId) ?? group.schoolId, count: group._count.id, amount: asMoney(group._sum.amount) }))
    });
  } catch (error) { next(error); }
});

app.get('/api/v1/exports/students.csv', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = scopedSchoolFromQuery(req);
    const students = await prisma.student.findMany({ where: schoolId ? { schoolId } : {}, include: { school: { select: { name: true } }, wallet: { select: { balance: true, currency: true } }, cards: { where: { status: CardStatus.ACTIVE }, select: { publicToken: true } } }, orderBy: [{ schoolId: 'asc' }, { fullName: 'asc' }] });
    sendCsv(res, 'taazur-students.csv', [
      ['المدرسة', 'رمز الطالب', 'اسم الطالب', 'الصف', 'الحد اليومي', 'الرصيد', 'العملة', 'رمز البطاقة النشطة'],
      ...students.map(student => [student.school.name, student.studentCode, student.fullName, student.grade, asMoney(student.dailyLimit), asMoney(student.wallet?.balance), student.wallet?.currency ?? 'SAR', student.cards[0]?.publicToken ?? '—'])
    ]);
  } catch (error) { next(error); }
});

app.get('/api/v1/exports/transactions.csv', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const { rows } = await monthlyExpenseRows(req);
    sendCsv(res, 'taazur-transactions.csv', rows);
  } catch (error) { next(error); }
});

app.get('/api/v1/exports/monthly-expenses.xls', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const { rows, month } = await monthlyExpenseRows(req);
    sendExcelHtml(res, `taazur-monthly-${month}.xls`, `تقرير مصروفات الطلاب الشهري ${month}`, rows);
  } catch (error) { next(error); }
});

app.get('/api/v1/exports/monthly-expenses-print', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const { rows, month } = await monthlyExpenseRows(req);
    sendPrintableReport(res, `تقرير مصروفات الطلاب الشهري ${month}`, rows);
  } catch (error) { next(error); }
});

const debitSchema = z.object({ cardToken: z.string().min(20).max(128), amount: z.coerce.number().positive().max(1000) });

app.get('/api/v1/cards/lookup', auth, roles(Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    const cardToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (cardToken.length < 20) return res.status(400).json({ error: 'CARD_TOKEN_REQUIRED' });
    const card = await prisma.card.findUnique({
      where: { publicToken: cardToken },
      include: { student: { include: { wallet: true, school: { select: { name: true } } } } }
    });
    if (!card) return res.status(404).json({ error: 'CARD_NOT_FOUND' });
    if (req.claims!.schoolId && req.claims!.schoolId !== card.student.schoolId) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    if (card.status === CardStatus.REVOKED) {
      await prisma.auditLog.create({ data: { userId: req.claims!.sub, schoolId: card.student.schoolId, action: 'CARD_REVOKED_USED', entity: 'Card', entityId: card.id, newValue: { cardToken: maskToken(cardToken), source: 'lookup' }, ip: requestIp(req), userAgent: requestUserAgent(req) } }).catch(() => undefined);
      return res.status(409).json({ error: 'CARD_REVOKED' });
    }
    if (card.status !== CardStatus.ACTIVE) return res.status(409).json({ error: 'CARD_NOT_ACTIVE' });
    if (card.student.status !== EntityStatus.ACTIVE) return res.status(409).json({ error: 'STUDENT_INACTIVE' });
    const todaySpent = await prisma.$transaction(tx => getTodayNetDebit(tx, card.studentId));
    const dailyLimit = money(card.student.dailyLimit);
    res.json({
      student: {
        id: card.student.id,
        fullName: card.student.fullName,
        studentCode: card.student.studentCode,
        grade: card.student.grade,
        schoolName: card.student.school.name,
        balance: asMoney(card.student.wallet?.balance),
        dailyLimit: asMoney(dailyLimit),
        todaySpent: asMoney(todaySpent),
        todayRemaining: asMoney(Math.max(0, dailyLimit - todaySpent))
      }
    });
  } catch (error) { next(error); }
});

async function getTodayNetDebit(tx: Prisma.TransactionClient, studentId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayDebits = await tx.walletTransaction.findMany({
    where: { studentId, type: TransactionType.DEBIT, createdAt: { gte: startOfDay } },
    select: { id: true, amount: true }
  });
  const debitTotal = todayDebits.reduce((sum, transaction) => sum + Number(transaction.amount), 0);
  const refundReferences = todayDebits.map(transaction => `REFUND-${transaction.id}`);

  if (!refundReferences.length) return debitTotal;

  const refunds = await tx.walletTransaction.aggregate({
    where: { studentId, type: TransactionType.REFUND, reference: { in: refundReferences } },
    _sum: { amount: true }
  });

  return Math.max(0, debitTotal - Number(refunds._sum.amount ?? 0));
}

app.post('/api/v1/transactions/debit', auth, roles(Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    const idempotencyKey = req.header('idempotency-key');
    if (!idempotencyKey) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    const input = debitSchema.parse(req.body);
    const existing = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) return res.status(200).json({ transaction: existing, replayed: true });
    const transaction = await prisma.$transaction(async tx => {
      const card = await tx.card.findUnique({ where: { publicToken: input.cardToken }, include: { student: true } });
      if (!card) throw new Error('CARD_NOT_FOUND');
      if (card.status === CardStatus.REVOKED) {
        await audit(tx, req, { action: 'CARD_REVOKED_USED', entity: 'Card', entityId: card.id, schoolId: card.student.schoolId, newValue: { cardToken: maskToken(input.cardToken), source: 'debit' } });
        throw new Error('CARD_REVOKED');
      }
      if (card.status !== CardStatus.ACTIVE) throw new Error('CARD_NOT_ACTIVE');
      if (card.student.status !== 'ACTIVE') throw new Error('STUDENT_INACTIVE');
      if (req.claims!.schoolId && req.claims!.schoolId !== card.student.schoolId) throw new Error('SCHOOL_SCOPE_DENIED');
      const rows = await tx.$queryRaw<Array<{ id: string; balance: number }>>`SELECT id, balance FROM Wallet WHERE studentId = ${card.studentId} FOR UPDATE`;
      const wallet = rows[0];
      const balanceBefore = wallet ? Number(wallet.balance) : 0;
      if (!wallet || balanceBefore < input.amount) throw new Error('INSUFFICIENT_BALANCE');
      const todayNetDebit = await getTodayNetDebit(tx, card.studentId);
      if (todayNetDebit + input.amount > Number(card.student.dailyLimit)) throw new Error('DAILY_LIMIT_EXCEEDED');
      const balanceAfter = balanceBefore - input.amount;
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
      const created = await tx.walletTransaction.create({ data: { reference: randomUUID(), idempotencyKey, walletId: wallet.id, studentId: card.studentId, schoolId: card.student.schoolId, amount: input.amount, type: TransactionType.DEBIT, balanceBefore, balanceAfter, performedById: req.claims!.sub } });
      await audit(tx, req, { action: 'CANTEEN_DEBIT', entity: 'WalletTransaction', entityId: created.id, schoolId: card.student.schoolId, newValue: cleanJson({ cardId: card.id, studentId: card.studentId, amount: input.amount, balanceBefore, balanceAfter }) });
      return { ...created, student: { fullName: card.student.fullName, studentCode: card.student.studentCode } };
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

async function canteenDue(canteenUserId: string, claims: Claims) {
  const canteenUser = await prisma.user.findUniqueOrThrow({
    where: { id: canteenUserId },
    select: { id: true, email: true, role: true, schoolId: true, school: { select: { name: true, schoolCode: true } } }
  });
  if (canteenUser.role !== Role.CANTEEN_OPERATOR) throw new Error('FORBIDDEN');
  if (canteenUser.schoolId && !scopedSchool(claims, canteenUser.schoolId)) throw new Error('SCHOOL_SCOPE_DENIED');
  const lastSettlement = await prisma.canteenSettlement.findFirst({ where: { canteenUserId }, orderBy: { periodEnd: 'desc' } });
  const periodStart = lastSettlement?.periodEnd ?? new Date(0);
  const transactions = await prisma.walletTransaction.findMany({
    where: { performedById: canteenUserId, createdAt: { gt: periodStart }, type: { in: [TransactionType.DEBIT, TransactionType.REFUND] } },
    select: { amount: true, type: true }
  });
  const debit = transactions.filter(transaction => transaction.type === TransactionType.DEBIT).reduce((sum, transaction) => sum + money(transaction.amount), 0);
  const refund = transactions.filter(transaction => transaction.type === TransactionType.REFUND).reduce((sum, transaction) => sum + money(transaction.amount), 0);
  return {
    canteenUser,
    periodStart,
    periodEnd: new Date(),
    debit: asMoney(debit),
    refund: asMoney(refund),
    net: asMoney(Math.max(0, debit - refund)),
    transactionCount: transactions.filter(transaction => transaction.type === TransactionType.DEBIT).length
  };
}

app.get('/api/v1/canteen/summary', auth, roles(Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    const summary = await canteenDue(req.claims!.sub, req.claims!);
    res.json({ summary });
  } catch (error) { next(error); }
});

app.get('/api/v1/canteen/settlements', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const where = { role: Role.CANTEEN_OPERATOR, status: EntityStatus.ACTIVE, ...(req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {}) };
    const users = await prisma.user.findMany({ where, select: { id: true }, orderBy: { createdAt: 'desc' } });
    const summaries = await Promise.all(users.map(user => canteenDue(user.id, req.claims!)));
    const settlements = await prisma.canteenSettlement.findMany({
      where: req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {},
      include: { canteenUser: { select: { email: true } }, settledBy: { select: { email: true } }, school: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json({ summaries, settlements });
  } catch (error) { next(error); }
});

app.post('/api/v1/canteen/settlements', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = z.object({ canteenUserId: z.string().cuid(), note: z.string().trim().max(200).optional() }).parse(req.body);
    const due = await canteenDue(input.canteenUserId, req.claims!);
    const amount = money(due.net);
    if (amount <= 0) return res.status(409).json({ error: 'NO_UNSETTLED_AMOUNT' });
    const settlement = await prisma.$transaction(async tx => {
      const created = await tx.canteenSettlement.create({
        data: {
          schoolId: due.canteenUser.schoolId,
          canteenUserId: input.canteenUserId,
          amount,
          transactionCount: due.transactionCount,
          periodStart: due.periodStart,
          periodEnd: due.periodEnd,
          note: input.note,
          settledById: req.claims!.sub
        },
        include: { canteenUser: { select: { email: true } }, settledBy: { select: { email: true } }, school: { select: { name: true } } }
      });
      await audit(tx, req, { action: 'CANTEEN_SETTLED', entity: 'CanteenSettlement', entityId: created.id, schoolId: created.schoolId, newValue: cleanJson({ canteenUserId: input.canteenUserId, amount, transactionCount: due.transactionCount }) });
      return created;
    });
    res.status(201).json({ settlement });
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
  const status = message === 'FORBIDDEN' || message === 'ORIGIN_DENIED' ? 403 : message === 'LOGIN_LOCKED' ? 429 : ['INSUFFICIENT_BALANCE', 'STUDENT_INACTIVE', 'SCHOOL_SCOPE_DENIED', 'DAILY_LIMIT_EXCEEDED', 'REFUND_ONLY_DEBIT', 'CARD_REVOKED', 'CARD_NOT_ACTIVE', 'NO_UNSETTLED_AMOUNT', 'SCHOOL_HAS_ACTIVE_STUDENTS', 'SCHOOL_INACTIVE'].includes(message) ? 409 : message === 'DUPLICATE_RECORD' ? 409 : message === 'CARD_NOT_FOUND' ? 404 : 400;
  res.status(status).json({ error: message });
});
const port = Number(process.env.PORT ?? 4000);
app.listen(port, '0.0.0.0', () => console.log(`API listening on :${port}`));
