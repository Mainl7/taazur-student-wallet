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
const sessionDurationMs = Number(process.env.SESSION_DURATION_HOURS ?? 8) * 60 * 60 * 1000;
const demoEmails = ['admin@taazur.local', 'operator@taazur.local'];
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
app.use(express.json({ limit: '256kb' }));

type Claims = { sub: string; role: Role; schoolId?: string; sid?: string };
type CanteenAccess = { canteenId: string | null; schoolId: string; name: string };
type AuditInput = {
  action: string;
  entity: string;
  entityId: string;
  schoolId?: string | null;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
};

type SystemSettings = {
  organizationName: string;
  lowBalanceThreshold: number;
  alertsEnabled: boolean;
  backupReminderEnabled: boolean;
  supportEmail: string;
  supportPhone: string;
  cashierRequireStudentPreview: boolean;
  cashierSoundEnabled: boolean;
  sessionDurationHours: number;
  reportsDefaultMonth: string;
};

declare global { namespace Express { interface Request { claims?: Claims; requestId?: string } } }

const cleanJson = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const scopedSchool = (claims: Claims, schoolId: string) => !claims.schoolId || claims.schoolId === schoolId;
const requestIp = (req: Request) => (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
const requestUserAgent = (req: Request) => req.header('user-agent')?.slice(0, 500);
const cookieToken = (req: Request) => req.header('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
const clearAuthCookie = (res: Response) => res.clearCookie(cookieName, { httpOnly: true, secure: cookieSecure, sameSite: cookieSecure ? 'none' : 'lax', path: '/' });
const routeParam = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value ?? '';
const money = (value: unknown) => Number(value ?? 0);
const asMoney = (value: unknown) => money(value).toFixed(2);
const csvCell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const maskToken = (token: string) => token.length > 16 ? `${token.slice(0, 12)}…${token.slice(-4)}` : token;
const alertPriority = { danger: 3, warn: 2, info: 1 } as const;
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
const dayMs = 24 * 60 * 60 * 1000;
const parseLocalDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, monthNumber, day] = value.split('-').map(Number);
  const date = new Date(year, monthNumber - 1, day);
  if (Number.isNaN(date.getTime())) return undefined;
  return date;
};
const parseDashboardPeriod = (query: Record<string, unknown>) => {
  const today = startOfToday();
  const week = daysAgo(6);
  const month = startOfThisMonth();
  const period = typeof query.period === 'string' && ['today', 'week', 'month', 'custom'].includes(query.period) ? query.period : 'today';
  if (period === 'custom') {
    const start = parseLocalDate(query.startDate);
    const endDay = parseLocalDate(query.endDate);
    if (start && endDay) {
      const end = new Date(endDay.getTime() + dayMs);
      if (end > start) return { period, start, end };
    }
    return { period: 'today', start: today, end: undefined };
  }
  return { period, start: period === 'month' ? month : period === 'week' ? week : today, end: undefined };
};
const parseMonthRange = (month?: unknown) => {
  const text = typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = text.split('-').map(Number);
  const start = new Date(year, monthNumber - 1, 1);
  const end = new Date(year, monthNumber, 1);
  return { text, start, end };
};
const parseDateRange = (query: Record<string, unknown>) => {
  const start = parseLocalDate(query.startDate);
  const endDay = parseLocalDate(query.endDate);
  const createdAt: Prisma.DateTimeFilter = {};
  if (start) createdAt.gte = start;
  if (endDay) createdAt.lt = new Date(endDay.getTime() + dayMs);
  return Object.keys(createdAt).length ? createdAt : undefined;
};
const transactionTypeLabel = (type: TransactionType | string) => ({
  CREDIT: 'تخصيص فسحة',
  DEBIT: 'صرف مقصف',
  REFUND: 'استرجاع',
  REVERSAL: 'عكس',
  ADJUSTMENT: 'تعديل'
}[type] ?? type);
const envSessionDurationHours = Number(process.env.SESSION_DURATION_HOURS ?? 8);
const defaultSystemSettings: SystemSettings = {
  organizationName: 'جمعية تآزر لرعاية الأيتام بمحافظة الدرب',
  lowBalanceThreshold: 10,
  alertsEnabled: true,
  backupReminderEnabled: true,
  supportEmail: '',
  supportPhone: '',
  cashierRequireStudentPreview: true,
  cashierSoundEnabled: true,
  sessionDurationHours: Number.isFinite(envSessionDurationHours) ? Math.min(72, Math.max(1, envSessionDurationHours)) : 8,
  reportsDefaultMonth: 'current'
};

const settingValue = <K extends keyof SystemSettings>(settings: Partial<SystemSettings>, key: K) => {
  const value = settings[key];
  return value === undefined || value === null ? defaultSystemSettings[key] : value;
};

async function getSystemSettings(client: PrismaClient | Prisma.TransactionClient = prisma): Promise<SystemSettings> {
  const rows = await client.systemSetting.findMany({ where: { key: { in: Object.keys(defaultSystemSettings) } } });
  const values = Object.fromEntries(rows.map(row => [row.key, row.value])) as Partial<SystemSettings>;
  return {
    organizationName: String(settingValue(values, 'organizationName')),
    lowBalanceThreshold: Math.max(0, Number(settingValue(values, 'lowBalanceThreshold')) || defaultSystemSettings.lowBalanceThreshold),
    alertsEnabled: Boolean(settingValue(values, 'alertsEnabled')),
    backupReminderEnabled: Boolean(settingValue(values, 'backupReminderEnabled')),
    supportEmail: String(settingValue(values, 'supportEmail')),
    supportPhone: String(settingValue(values, 'supportPhone')),
    cashierRequireStudentPreview: Boolean(settingValue(values, 'cashierRequireStudentPreview')),
    cashierSoundEnabled: Boolean(settingValue(values, 'cashierSoundEnabled')),
    sessionDurationHours: Math.min(72, Math.max(1, Number(settingValue(values, 'sessionDurationHours')) || defaultSystemSettings.sessionDurationHours)),
    reportsDefaultMonth: ['current', 'previous'].includes(String(settingValue(values, 'reportsDefaultMonth'))) ? String(settingValue(values, 'reportsDefaultMonth')) : defaultSystemSettings.reportsDefaultMonth
  };
}

app.use((req, res, next) => {
  req.requestId = req.header('x-request-id')?.slice(0, 64) || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});

function scopedSchoolFromQuery(req: Request) {
  const requested = typeof req.query.schoolId === 'string' && req.query.schoolId ? req.query.schoolId : undefined;
  const schoolId = req.claims!.schoolId ?? requested;
  if (requested && !scopedSchool(req.claims!, requested)) throw new Error('SCHOOL_SCOPE_DENIED');
  return schoolId;
}

async function resolveCanteenAccess(client: PrismaClient | Prisma.TransactionClient, claims: Claims, canteenId?: string | null): Promise<CanteenAccess> {
  if (claims.role !== Role.CANTEEN_CASHIER && claims.role !== Role.CANTEEN_OPERATOR) throw new Error('FORBIDDEN');
  if (!claims.schoolId) throw new Error('SCHOOL_SCOPE_DENIED');
  if (canteenId) {
    const canteen = await client.canteen.findUnique({ where: { id: canteenId }, select: { id: true, name: true, schoolId: true, status: true } });
    if (!canteen || canteen.status !== EntityStatus.ACTIVE || canteen.schoolId !== claims.schoolId) throw new Error('CANTEEN_SCOPE_DENIED');
    return { canteenId: canteen.id, schoolId: canteen.schoolId, name: canteen.name };
  }
  const schoolCanteens = await client.canteen.findMany({
    where: { schoolId: claims.schoolId, status: EntityStatus.ACTIVE },
    select: { id: true, name: true, schoolId: true },
    take: 2
  });
  if (schoolCanteens.length === 1) {
    const canteen = schoolCanteens[0];
    return { canteenId: canteen.id, schoolId: canteen.schoolId, name: canteen.name };
  }
  if (schoolCanteens.length > 1) throw new Error('CANTEEN_REQUIRED');
  return { canteenId: null, schoolId: claims.schoolId, name: 'المقصف' };
}

async function assertNotCanteenOwner(client: PrismaClient | Prisma.TransactionClient, claims: Claims) {
  if (claims.role === Role.CANTEEN_OWNER) throw new Error('OWNER_CASHIER_DENIED');
  if (claims.role !== Role.CANTEEN_OPERATOR) return;
  if (!claims.schoolId) throw new Error('OWNER_CASHIER_DENIED');
  const ownedCanteens = await client.canteen.count({
    where: { operatorId: claims.sub, status: EntityStatus.ACTIVE, ...(claims.schoolId ? { schoolId: claims.schoolId } : {}) }
  });
  if (ownedCanteens > 0) throw new Error('OWNER_CASHIER_DENIED');
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

const auth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.header('authorization')?.replace(/^Bearer\s+/i, '') || cookieToken(req);
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET!) as Claims;
    if (!claims.sid) return res.status(401).json({ error: 'INVALID_TOKEN' });
    const session = await prisma.userSession.findUnique({
      where: { id: claims.sid },
      select: { userId: true, revokedAt: true, expiresAt: true }
    });
    if (!session || session.userId !== claims.sub || session.revokedAt || session.expiresAt <= new Date()) {
      clearAuthCookie(res);
      return res.status(401).json({ error: 'INVALID_TOKEN' });
    }
    req.claims = claims;
    prisma.userSession.update({ where: { id: claims.sid }, data: { lastSeenAt: new Date(), ip: requestIp(req), userAgent: requestUserAgent(req) } }).catch(() => undefined);
    next();
  }
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
    const loginSettings = await getSystemSettings();
    const loginSessionDurationMs = loginSettings.sessionDurationHours * 60 * 60 * 1000;
    const session = await prisma.userSession.create({
      data: {
        userId: user.id,
        ip: requestIp(req),
        userAgent: requestUserAgent(req),
        expiresAt: new Date(Date.now() + loginSessionDurationMs)
      }
    });
    const token = jwt.sign({ sub: user.id, role: user.role, schoolId: user.schoolId ?? undefined, sid: session.id }, process.env.JWT_SECRET!, { expiresIn: Math.floor(loginSessionDurationMs / 1000) });
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: cookieSecure ? 'none' : 'lax',
      path: '/',
      maxAge: loginSessionDurationMs
    });
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        schoolId: user.schoolId,
        action: 'AUTH_LOGIN',
        entity: 'User',
        entityId: user.id,
        newValue: cleanJson({ sessionId: session.id }),
        ip: requestIp(req),
        userAgent: requestUserAgent(req)
      }
    }).catch(() => undefined);
    return res.json({ user: { email: user.email, role: user.role, schoolId: user.schoolId } });
  } catch (error) { next(error); }
});

app.post('/api/v1/auth/logout', (req, res) => {
  const token = cookieToken(req);
  if (token) {
    try {
      const claims = jwt.verify(token, process.env.JWT_SECRET!) as Claims;
      if (claims.sid) prisma.userSession.update({ where: { id: claims.sid }, data: { revokedAt: new Date() } }).catch(() => undefined);
    } catch { /* ignore invalid logout token */ }
  }
  clearAuthCookie(res);
  res.json({ ok: true });
});

app.get('/api/v1/auth/sessions', auth, async (req, res, next) => {
  try {
    const sessions = await prisma.userSession.findMany({
      where: { userId: req.claims!.sub },
      orderBy: { lastSeenAt: 'desc' },
      take: 25
    });
    res.json({
      currentSessionId: req.claims!.sid,
      sessions: sessions.map(session => ({
        id: session.id,
        ip: session.ip,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
        current: session.id === req.claims!.sid
      }))
    });
  } catch (error) { next(error); }
});

app.post('/api/v1/auth/logout-all', auth, async (req, res, next) => {
  try {
    await prisma.$transaction(async tx => {
      await tx.userSession.updateMany({
        where: { userId: req.claims!.sub, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      await audit(tx, req, { action: 'AUTH_LOGOUT_ALL', entity: 'User', entityId: req.claims!.sub, newValue: cleanJson({ keepCurrent: false }) });
    });
    clearAuthCookie(res);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.delete('/api/v1/auth/sessions/:sessionId', auth, async (req, res, next) => {
  try {
    const sessionId = routeParam(req.params.sessionId);
    const session = await prisma.userSession.findUnique({ where: { id: sessionId }, select: { userId: true } });
    if (!session || session.userId !== req.claims!.sub) return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    await prisma.$transaction(async tx => {
      await tx.userSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
      await audit(tx, req, { action: 'AUTH_SESSION_REVOKED', entity: 'UserSession', entityId: sessionId, newValue: cleanJson({ current: sessionId === req.claims!.sid }) });
    });
    if (sessionId === req.claims!.sid) clearAuthCookie(res);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/v1/auth/change-password', auth, async (req, res, next) => {
  try {
    const input = z.object({
      currentPassword: z.string().min(12).max(128),
      newPassword: z.string().min(16).max(128)
    }).parse(req.body);
    if (input.currentPassword === input.newPassword) return res.status(400).json({ error: 'PASSWORD_UNCHANGED' });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.claims!.sub }, select: { id: true, passwordHash: true, status: true } });
    if (user.status !== EntityStatus.ACTIVE) return res.status(401).json({ error: 'INVALID_TOKEN' });
    const validPassword = await argon2.verify(user.passwordHash, input.currentPassword);
    if (!validPassword) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    const passwordHash = await argon2.hash(input.newPassword);
    await prisma.$transaction(async tx => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.userSession.updateMany({
        where: { userId: user.id, id: { not: req.claims!.sid }, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      await audit(tx, req, { action: 'AUTH_PASSWORD_CHANGED', entity: 'User', entityId: user.id, newValue: cleanJson({ otherSessionsRevoked: true }) });
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
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
const schoolManagerSchema = z.object({ email: z.string().trim().email(), password: z.string().min(12).max(128), schoolId: z.string().cuid() });
const userPasswordResetSchema = z.object({ password: z.string().min(12).max(128) });
app.get('/api/v1/schools', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const where = req.claims!.schoolId ? { id: req.claims!.schoolId } : {};
    const schools = await prisma.school.findMany({ where, orderBy: { name: 'asc' }, select: { id: true, schoolCode: true, name: true, city: true, district: true, status: true, _count: { select: { students: true } } } });
    res.json({ schools });
  } catch (error) { next(error); }
});
app.get('/api/v1/schools/:schoolId/details', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = routeParam(req.params.schoolId);
    if (!scopedSchool(req.claims!, schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const today = startOfToday();
    const month = startOfThisMonth();
    const [
      school,
      studentCount,
      activeStudentCount,
      walletBalance,
      todaySpent,
      monthSpent,
      canteens,
      lowBalanceCount,
      revokedCards
    ] = await Promise.all([
      prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { id: true, schoolCode: true, name: true, city: true, district: true, address: true, status: true, createdAt: true } }),
      prisma.student.count({ where: { schoolId } }),
      prisma.student.count({ where: { schoolId, status: EntityStatus.ACTIVE } }),
      prisma.wallet.aggregate({ where: { student: { schoolId } }, _sum: { balance: true } }),
      prisma.walletTransaction.aggregate({ where: { schoolId, type: TransactionType.DEBIT, createdAt: { gte: today } }, _sum: { amount: true }, _count: { id: true } }),
      prisma.walletTransaction.aggregate({ where: { schoolId, type: TransactionType.DEBIT, createdAt: { gte: month } }, _sum: { amount: true }, _count: { id: true } }),
      prisma.canteen.findMany({ where: { schoolId }, select: { id: true, name: true, canteenCode: true, status: true, operator: { select: { email: true } } }, orderBy: { name: 'asc' } }),
      prisma.wallet.count({ where: { balance: { lt: 10 }, student: { schoolId, status: EntityStatus.ACTIVE } } }),
      prisma.card.count({ where: { status: CardStatus.REVOKED, student: { schoolId } } })
    ]);
    res.json({
      school,
      metrics: {
        students: studentCount,
        activeStudents: activeStudentCount,
        walletBalance: asMoney(walletBalance._sum.balance),
        todaySpent: asMoney(todaySpent._sum.amount),
        todayTransactions: todaySpent._count.id,
        monthSpent: asMoney(monthSpent._sum.amount),
        monthTransactions: monthSpent._count.id,
        lowBalanceCount,
        revokedCards
      },
      canteens
    });
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

app.get('/api/v1/school-managers', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN), async (_req, res, next) => {
  try {
    const managers = await prisma.user.findMany({
      where: { role: Role.AUDITOR, schoolId: { not: null }, status: EntityStatus.ACTIVE },
      select: { id: true, email: true, role: true, status: true, createdAt: true, school: { select: { id: true, name: true, schoolCode: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ managers });
  } catch (error) { next(error); }
});

app.post('/api/v1/school-managers', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN), async (req, res, next) => {
  try {
    const input = schoolManagerSchema.parse(req.body);
    const school = await prisma.school.findUniqueOrThrow({ where: { id: input.schoolId }, select: { id: true, status: true } });
    if (school.status !== EntityStatus.ACTIVE) return res.status(409).json({ error: 'SCHOOL_INACTIVE' });
    const passwordHash = await argon2.hash(input.password);
    const manager = await prisma.$transaction(async tx => {
      const created = await tx.user.create({
        data: { email: input.email.toLowerCase(), passwordHash, role: Role.AUDITOR, schoolId: school.id },
        select: { id: true, email: true, role: true, status: true, createdAt: true, school: { select: { id: true, name: true, schoolCode: true } } }
      });
      await audit(tx, req, { action: 'SCHOOL_MANAGER_CREATED', entity: 'User', entityId: created.id, schoolId: school.id, newValue: cleanJson({ email: created.email, role: created.role, schoolId: school.id }) });
      return created;
    });
    res.status(201).json({ manager });
  } catch (error) { next(error); }
});

app.patch('/api/v1/school-managers/:userId/password', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN), async (req, res, next) => {
  try {
    const input = userPasswordResetSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: routeParam(req.params.userId) }, select: { id: true, email: true, role: true, schoolId: true, status: true } });
    if (user.role !== Role.AUDITOR || !user.schoolId || user.status !== EntityStatus.ACTIVE) return res.status(400).json({ error: 'INVALID_SCHOOL_MANAGER' });
    const passwordHash = await argon2.hash(input.password);
    const manager = await prisma.$transaction(async tx => {
      const updated = await tx.user.update({ where: { id: user.id }, data: { passwordHash }, select: { id: true, email: true, role: true, status: true, createdAt: true, school: { select: { id: true, name: true, schoolCode: true } } } });
      await tx.loginAttempt.deleteMany({ where: { email: user.email.toLowerCase() } });
      await audit(tx, req, { action: 'SCHOOL_MANAGER_PASSWORD_RESET', entity: 'User', entityId: user.id, schoolId: user.schoolId, newValue: cleanJson({ email: user.email }) });
      return updated;
    });
    res.json({ manager });
  } catch (error) { next(error); }
});

app.get('/api/v1/school-manager/overview', auth, roles(Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    if (!req.claims!.schoolId) return res.status(403).json({ error: 'SCHOOL_MANAGER_SCOPE_REQUIRED' });
    const schoolId = req.claims!.schoolId;
    const today = startOfToday();
    const week = daysAgo(6);
    const month = startOfThisMonth();
    const settings = await getSystemSettings();
    const [
      school,
      students,
      walletBalance,
      todaySpent,
      weekSpent,
      monthSpent,
      activeCards,
      revokedCards,
      recentTransactions,
      lowWallets,
      dailyDebits,
      dailyRefunds
    ] = await Promise.all([
      prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { id: true, name: true, schoolCode: true, city: true, district: true, status: true } }),
      prisma.student.findMany({ where: { schoolId }, include: { wallet: { select: { balance: true, currency: true } }, cards: { where: { status: CardStatus.ACTIVE }, select: { id: true, issuedAt: true } } }, orderBy: [{ grade: 'asc' }, { fullName: 'asc' }] }),
      prisma.wallet.aggregate({ where: { student: { schoolId } }, _sum: { balance: true } }),
      prisma.walletTransaction.aggregate({ where: { schoolId, type: TransactionType.DEBIT, createdAt: { gte: today } }, _sum: { amount: true }, _count: { id: true } }),
      prisma.walletTransaction.aggregate({ where: { schoolId, type: TransactionType.DEBIT, createdAt: { gte: week } }, _sum: { amount: true }, _count: { id: true } }),
      prisma.walletTransaction.aggregate({ where: { schoolId, type: TransactionType.DEBIT, createdAt: { gte: month } }, _sum: { amount: true }, _count: { id: true } }),
      prisma.card.count({ where: { status: CardStatus.ACTIVE, student: { schoolId } } }),
      prisma.card.count({ where: { status: CardStatus.REVOKED, student: { schoolId } } }),
      prisma.walletTransaction.findMany({ where: { schoolId, type: { in: [TransactionType.DEBIT, TransactionType.REFUND, TransactionType.CREDIT] } }, include: { canteen: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 25 }),
      prisma.wallet.findMany({ where: { balance: { lt: settings.lowBalanceThreshold }, student: { schoolId, status: EntityStatus.ACTIVE } }, include: { student: { select: { id: true, fullName: true, studentCode: true } } }, orderBy: { balance: 'asc' }, take: 20 }),
      prisma.walletTransaction.findMany({ where: { schoolId, type: TransactionType.DEBIT, createdAt: { gte: today } }, select: { studentId: true, amount: true } }),
      prisma.walletTransaction.findMany({ where: { schoolId, type: TransactionType.REFUND, createdAt: { gte: today } }, select: { studentId: true, amount: true, reference: true } })
    ]);

    const todayUsage = new Map<string, { debit: number; refund: number }>();
    for (const debit of dailyDebits) todayUsage.set(debit.studentId, { ...(todayUsage.get(debit.studentId) ?? { debit: 0, refund: 0 }), debit: (todayUsage.get(debit.studentId)?.debit ?? 0) + money(debit.amount) });
    for (const refund of dailyRefunds.filter(item => item.reference.startsWith('REFUND-'))) todayUsage.set(refund.studentId, { ...(todayUsage.get(refund.studentId) ?? { debit: 0, refund: 0 }), refund: (todayUsage.get(refund.studentId)?.refund ?? 0) + money(refund.amount) });
    const studentMap = new Map(students.map(student => [student.id, student]));
    const limitReached = [...todayUsage.entries()]
      .map(([studentId, totals]) => ({ student: studentMap.get(studentId), spent: Math.max(0, totals.debit - totals.refund) }))
      .filter(item => item.student && item.spent >= money(item.student.dailyLimit))
      .map(item => ({ studentId: item.student!.id, fullName: item.student!.fullName, studentCode: item.student!.studentCode, spentToday: asMoney(item.spent), dailyLimit: asMoney(item.student!.dailyLimit) }));

    res.json({
      school,
      summary: {
        students: students.length,
        activeStudents: students.filter(student => student.status === EntityStatus.ACTIVE).length,
        walletBalance: asMoney(walletBalance._sum.balance),
        todaySpent: asMoney(todaySpent._sum.amount),
        todayTransactions: todaySpent._count.id,
        weekSpent: asMoney(weekSpent._sum.amount),
        monthSpent: asMoney(monthSpent._sum.amount),
        activeCards,
        revokedCards,
        lowBalanceCount: lowWallets.length,
        dailyLimitReachedCount: limitReached.length
      },
      alerts: {
        lowBalances: lowWallets.map(wallet => ({ studentId: wallet.student.id, fullName: wallet.student.fullName, studentCode: wallet.student.studentCode, balance: asMoney(wallet.balance) })),
        dailyLimitReached: limitReached
      },
      students: students.map(student => ({
        id: student.id,
        studentCode: student.studentCode,
        fullName: student.fullName,
        grade: student.grade,
        className: student.className,
        status: student.status,
        dailyLimit: asMoney(student.dailyLimit),
        balance: asMoney(student.wallet?.balance),
        currency: student.wallet?.currency ?? 'SAR',
        hasActiveCard: student.cards.length > 0
      })),
      recentTransactions: recentTransactions.map(transaction => ({
        id: transaction.id,
        type: transaction.type,
        amount: asMoney(transaction.amount),
        balanceAfter: asMoney(transaction.balanceAfter),
        createdAt: transaction.createdAt,
        reference: transaction.reference,
        studentId: transaction.studentId,
        studentName: studentMap.get(transaction.studentId)?.fullName ?? '—',
        studentCode: studentMap.get(transaction.studentId)?.studentCode ?? '—',
        canteenName: transaction.canteen?.name ?? '—'
      }))
    });
  } catch (error) { next(error); }
});

const canteenUserSchema = z.object({ email: z.string().trim().email(), password: z.string().min(12).max(128), schoolId: z.string().cuid().optional(), role: z.enum(['CANTEEN_CASHIER', 'CANTEEN_OWNER', 'AUDITOR']).optional() });
const canteenPasswordResetSchema = z.object({ password: z.string().min(12).max(128) });
app.get('/api/v1/canteen-users', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const where: Prisma.UserWhereInput = {
      role: { in: [Role.CANTEEN_OPERATOR, Role.CANTEEN_CASHIER, Role.CANTEEN_OWNER, Role.AUDITOR] },
      status: EntityStatus.ACTIVE,
      ...(req.claims!.schoolId ? { OR: [{ schoolId: req.claims!.schoolId }, { operatedCanteens: { some: { schoolId: req.claims!.schoolId } } }, { role: Role.AUDITOR, schoolId: req.claims!.schoolId }] } : {})
    };
    const users = await prisma.user.findMany({ where, select: { id: true, email: true, role: true, schoolId: true, school: { select: { name: true, schoolCode: true } }, operatedCanteens: { where: req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {}, select: { id: true, name: true, canteenCode: true, status: true, school: { select: { name: true, schoolCode: true } } }, orderBy: { name: 'asc' } }, createdAt: true }, orderBy: { createdAt: 'desc' } });
    res.json({ users });
  } catch (error) { next(error); }
});
app.post('/api/v1/canteen-users', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = canteenUserSchema.parse(req.body);
    const requestedRole = input.role ? Role[input.role] : undefined;
    const schoolId = requestedRole === Role.CANTEEN_OWNER ? null : req.claims!.schoolId ?? input.schoolId ?? null;
    if (schoolId && !scopedSchool(req.claims!, schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const role = requestedRole ?? (schoolId ? Role.CANTEEN_CASHIER : Role.CANTEEN_OWNER);
    if (role === Role.CANTEEN_CASHIER && !schoolId) return res.status(400).json({ error: 'SCHOOL_REQUIRED' });
    const passwordHash = await argon2.hash(input.password);
    const user = await prisma.$transaction(async tx => {
      const created = await tx.user.create({ data: { email: input.email.toLowerCase(), passwordHash, role, schoolId }, select: { id: true, email: true, role: true, schoolId: true, school: { select: { name: true, schoolCode: true } }, createdAt: true } });
      await audit(tx, req, { action: role === Role.AUDITOR ? 'AUDITOR_USER_CREATED' : 'CANTEEN_USER_CREATED', entity: 'User', entityId: created.id, schoolId, newValue: { email: created.email, role: created.role, schoolId: created.schoolId } });
      return created;
    });
    res.status(201).json({ user });
  } catch (error) { next(error); }
});

app.patch('/api/v1/canteen-users/:userId/password', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = canteenPasswordResetSchema.parse(req.body);
    const userId = routeParam(req.params.userId);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
        schoolId: true,
        operatedCanteens: { select: { schoolId: true } }
      }
    });

    if (!((user.role === Role.CANTEEN_OPERATOR || user.role === Role.CANTEEN_CASHIER || user.role === Role.CANTEEN_OWNER || user.role === Role.AUDITOR) && user.status === EntityStatus.ACTIVE)) return res.status(400).json({ error: 'INVALID_USER' });
    const visibleSchoolIds = [user.schoolId, ...user.operatedCanteens.map(canteen => canteen.schoolId)].filter(Boolean) as string[];
    if (req.claims!.schoolId && !visibleSchoolIds.includes(req.claims!.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });

    const passwordHash = await argon2.hash(input.password);
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
        select: { id: true, email: true, role: true, schoolId: true, createdAt: true }
      });
      await tx.loginAttempt.deleteMany({ where: { email: user.email.toLowerCase() } });
      await audit(tx, req, {
        action: 'CANTEEN_USER_PASSWORD_RESET',
        entity: 'User',
        entityId: user.id,
        schoolId: req.claims!.schoolId ?? user.schoolId ?? user.operatedCanteens[0]?.schoolId ?? null,
        newValue: { email: user.email, resetBy: req.claims!.sub }
      });
      return result;
    });

    res.json({ user: updated });
  } catch (error) { next(error); }
});

const canteenSchema = z.object({ name: z.string().trim().min(2).max(120), canteenCode: z.string().trim().min(2).max(64).optional(), schoolId: z.string().cuid(), operatorId: z.string().cuid() });
app.get('/api/v1/canteens', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR, Role.CANTEEN_OPERATOR, Role.CANTEEN_CASHIER, Role.CANTEEN_OWNER), async (req, res, next) => {
  try {
    const where = req.claims!.role === Role.CANTEEN_OWNER || (req.claims!.role === Role.CANTEEN_OPERATOR && !req.claims!.schoolId)
      ? { operatorId: req.claims!.sub, status: EntityStatus.ACTIVE, ...(req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {}) }
      : req.claims!.role === Role.CANTEEN_CASHIER || (req.claims!.role === Role.CANTEEN_OPERATOR && req.claims!.schoolId)
      ? { schoolId: req.claims!.schoolId, status: EntityStatus.ACTIVE }
      : { ...(req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {}) };
    const canteens = await prisma.canteen.findMany({
      where,
      include: { school: { select: { name: true, schoolCode: true } }, operator: { select: { id: true, email: true } } },
      orderBy: [{ schoolId: 'asc' }, { name: 'asc' }]
    });
    res.json({ canteens });
  } catch (error) { next(error); }
});

app.get('/api/v1/canteens/:canteenId/details', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR, Role.CANTEEN_OWNER, Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    const canteenId = routeParam(req.params.canteenId);
    const summary = await canteenDueByCanteen(canteenId, req.claims!);
    const canteenSchoolId = summary.canteen.schoolId;
    const [lastSettlement, legacySettlement, activeSchoolCanteens] = await Promise.all([
      prisma.canteenSettlement.findFirst({ where: { canteenId }, orderBy: { periodEnd: 'desc' } }),
      prisma.canteenSettlement.findFirst({ where: { canteenId: null, schoolId: canteenSchoolId }, orderBy: { periodEnd: 'desc' } }),
      prisma.canteen.count({ where: { schoolId: canteenSchoolId, status: EntityStatus.ACTIVE } })
    ]);
    const legacyPeriodStart = new Date(Math.max(
      lastSettlement?.periodEnd.getTime() ?? 0,
      legacySettlement?.periodEnd.getTime() ?? 0
    ));
    const transactionWhere: Prisma.WalletTransactionWhereInput = {
      OR: [
        { canteenId },
        ...(activeSchoolCanteens === 1 ? [{ canteenId: null, schoolId: canteenSchoolId, createdAt: { gt: legacyPeriodStart } }] : [])
      ]
    };
    const [transactions, settlements] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: transactionWhere,
        include: { school: { select: { name: true, schoolCode: true } }, performedBy: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100
      }),
      prisma.canteenSettlement.findMany({
        where: { canteenId },
        include: { settledBy: { select: { email: true } }, school: { select: { name: true, schoolCode: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50
      })
    ]);
    const studentIds = [...new Set(transactions.map(transaction => transaction.studentId))];
    const students = await prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, fullName: true, studentCode: true } });
    const studentMap = new Map(students.map(student => [student.id, student]));
    res.json({ summary, transactions: transactions.map(transaction => ({ ...transaction, student: studentMap.get(transaction.studentId) })), settlements });
  } catch (error) { next(error); }
});

app.post('/api/v1/canteens', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = canteenSchema.parse(req.body);
    if (!scopedSchool(req.claims!, input.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });

    const operator = await prisma.user.findUniqueOrThrow({ where: { id: input.operatorId }, select: { id: true, role: true, status: true, schoolId: true } });
    if (!((operator.role === Role.CANTEEN_OWNER || operator.role === Role.CANTEEN_OPERATOR) && operator.status === EntityStatus.ACTIVE)) return res.status(400).json({ error: 'INVALID_CANTEEN_OPERATOR' });
    if (operator.schoolId && operator.schoolId !== input.schoolId) return res.status(403).json({ error: 'OPERATOR_SCHOOL_SCOPE_DENIED' });

    const canteen = await prisma.$transaction(async tx => {
      const created = await tx.canteen.create({ data: { ...input, canteenCode: input.canteenCode || undefined }, include: { school: { select: { name: true, schoolCode: true } }, operator: { select: { id: true, email: true } } } });
      await audit(tx, req, { action: 'CANTEEN_CREATED', entity: 'Canteen', entityId: created.id, schoolId: created.schoolId, newValue: cleanJson({ name: created.name, canteenCode: created.canteenCode, schoolId: created.schoolId, operatorId: created.operatorId }) });
      return created;
    });

    res.status(201).json({ canteen });
  } catch (error) { next(error); }
});

const studentSchema = z.object({ studentCode: z.string().trim().min(3).max(32), fullName: z.string().trim().min(3).max(150), grade: z.string().trim().min(1).max(32), className: z.string().trim().max(32).optional(), schoolId: z.string().cuid(), dailyLimit: z.coerce.number().positive().max(500), weeklyLimit: z.coerce.number().positive().max(2000).optional() });
const studentUpdateSchema = studentSchema.extend({ status: z.nativeEnum(EntityStatus).optional() }).partial();
const studentImportSchema = z.object({
  defaultSchoolId: z.string().cuid().optional(),
  rows: z.array(z.object({
    studentCode: z.string().trim().min(3).max(32),
    fullName: z.string().trim().min(3).max(150),
    grade: z.string().trim().min(1).max(32),
    className: z.string().trim().max(32).optional(),
    dailyLimit: z.coerce.number().positive().max(500),
    schoolId: z.string().cuid().optional(),
    schoolCode: z.string().trim().max(64).optional()
  })).min(1).max(500)
});
app.get('/api/v1/students', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId : req.claims!.schoolId;
    if (schoolId && !scopedSchool(req.claims!, schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const students = await prisma.student.findMany({ where: schoolId ? { schoolId } : {}, include: { school: { select: { name: true } }, wallet: { select: { balance: true, currency: true } }, cards: { where: { status: 'ACTIVE' }, select: { id: true, publicToken: true, issuedAt: true } } }, orderBy: { fullName: 'asc' } });
    res.json({ students });
  } catch (error) { next(error); }
});

app.get('/api/v1/students/:studentId/details', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const studentId = routeParam(req.params.studentId);
    const student = await prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      include: {
        school: { select: { id: true, name: true, schoolCode: true, city: true } },
        wallet: { select: { id: true, balance: true, currency: true, status: true, updatedAt: true } },
        cards: { orderBy: { issuedAt: 'desc' } }
      }
    });
    if (!scopedSchool(req.claims!, student.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const transactions = await prisma.walletTransaction.findMany({
      where: { studentId },
      include: { school: { select: { name: true, schoolCode: true } }, canteen: { select: { name: true, canteenCode: true } }, performedBy: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 150
    });
    const totals = transactions.reduce((sum, transaction) => {
      sum[transaction.type] = (sum[transaction.type] ?? 0) + money(transaction.amount);
      return sum;
    }, {} as Record<string, number>);
    res.json({ student, transactions, totals: Object.fromEntries(Object.entries(totals).map(([type, amount]) => [type, asMoney(amount)])) });
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
app.post('/api/v1/students/import', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = studentImportSchema.parse(req.body);
    if (input.defaultSchoolId && !scopedSchool(req.claims!, input.defaultSchoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });

    const schoolCodes = [...new Set(input.rows.map(row => row.schoolCode).filter(Boolean) as string[])];
    const schoolsByCodeRows = schoolCodes.length ? await prisma.school.findMany({ where: { schoolCode: { in: schoolCodes } }, select: { id: true, schoolCode: true, status: true } }) : [];
    const schoolByCode = new Map(schoolsByCodeRows.map(school => [school.schoolCode, school]));
    const existingCodes = await prisma.student.findMany({ where: { studentCode: { in: input.rows.map(row => row.studentCode) } }, select: { studentCode: true } });
    const existingCodeSet = new Set(existingCodes.map(student => student.studentCode));

    const results: Array<{ row: number; studentCode: string; status: 'created' | 'skipped' | 'failed'; message: string }> = [];
    let createdCount = 0;

    await prisma.$transaction(async tx => {
      for (const [index, row] of input.rows.entries()) {
        if (existingCodeSet.has(row.studentCode)) {
          results.push({ row: index + 1, studentCode: row.studentCode, status: 'skipped', message: 'رمز الطالب موجود مسبقًا' });
          continue;
        }

        const resolvedSchoolId = row.schoolId || input.defaultSchoolId || (row.schoolCode ? schoolByCode.get(row.schoolCode)?.id : undefined);
        if (!resolvedSchoolId) {
          results.push({ row: index + 1, studentCode: row.studentCode, status: 'failed', message: 'لم يتم تحديد المدرسة' });
          continue;
        }
        if (!scopedSchool(req.claims!, resolvedSchoolId)) {
          results.push({ row: index + 1, studentCode: row.studentCode, status: 'failed', message: 'المدرسة خارج صلاحيتك' });
          continue;
        }

        const school = await tx.school.findUnique({ where: { id: resolvedSchoolId }, select: { status: true } });
        if (!school || school.status !== EntityStatus.ACTIVE) {
          results.push({ row: index + 1, studentCode: row.studentCode, status: 'failed', message: 'المدرسة غير موجودة أو غير نشطة' });
          continue;
        }

        const created = await tx.student.create({
          data: {
            studentCode: row.studentCode,
            fullName: row.fullName,
            grade: row.grade,
            className: row.className || undefined,
            dailyLimit: row.dailyLimit,
            schoolId: resolvedSchoolId
          }
        });
        await tx.wallet.create({ data: { studentId: created.id } });
        await tx.card.create({ data: { studentId: created.id, publicToken: `CARD-${randomBytes(32).toString('base64url')}` } });
        existingCodeSet.add(row.studentCode);
        createdCount += 1;
        results.push({ row: index + 1, studentCode: row.studentCode, status: 'created', message: 'تمت الإضافة' });
      }
      await audit(tx, req, { action: 'STUDENTS_IMPORTED', entity: 'Student', entityId: 'bulk-import', schoolId: input.defaultSchoolId ?? req.claims?.schoolId, newValue: cleanJson({ totalRows: input.rows.length, createdCount }) });
    });

    res.status(201).json({ createdCount, totalRows: input.rows.length, results });
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

const cardDecisionSchema = z.object({ reason: z.string().trim().min(3).max(200).optional() });
const cardDeliverySchema = z.object({
  printed: z.boolean().optional(),
  delivered: z.boolean().optional(),
  deliveredByName: z.string().trim().min(2).max(120).optional(),
  deliveryNote: z.string().trim().max(300).optional()
});
app.post('/api/v1/cards/:cardId/revoke', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = cardDecisionSchema.parse(req.body ?? {});
    const card = await prisma.card.findUniqueOrThrow({ where: { id: routeParam(req.params.cardId) }, include: { student: true } });
    if (!scopedSchool(req.claims!, card.student.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const revoked = await prisma.$transaction(async tx => {
      const updated = await tx.card.update({ where: { id: card.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
      await audit(tx, req, { action: 'CARD_REVOKED', entity: 'Card', entityId: card.id, schoolId: card.student.schoolId, oldValue: { status: card.status }, newValue: cleanJson({ status: 'REVOKED', reason: input.reason }) });
      return updated;
    });
    res.json({ card: revoked });
  } catch (error) { next(error); }
});
app.post('/api/v1/students/:studentId/cards', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = cardDecisionSchema.parse(req.body ?? {});
    const student = await prisma.student.findUniqueOrThrow({ where: { id: routeParam(req.params.studentId) } });
    if (!scopedSchool(req.claims!, student.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const card = await prisma.$transaction(async tx => {
      await tx.card.updateMany({ where: { studentId: student.id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } });
      const created = await tx.card.create({ data: { studentId: student.id, publicToken: `CARD-${randomBytes(32).toString('base64url')}` } });
      await audit(tx, req, { action: 'CARD_ISSUED', entity: 'Card', entityId: created.id, schoolId: student.schoolId, newValue: cleanJson({ studentId: student.id, reason: input.reason }) });
      return created;
    });
    res.status(201).json({ card });
  } catch (error) { next(error); }
});
app.patch('/api/v1/cards/:cardId/delivery', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = cardDeliverySchema.parse(req.body);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: routeParam(req.params.cardId) }, include: { student: true } });
    if (!scopedSchool(req.claims!, card.student.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
    const now = new Date();
    const updated = await prisma.$transaction(async tx => {
      const nextCard = await tx.card.update({
        where: { id: card.id },
        data: {
          printedAt: input.printed && !card.printedAt ? now : undefined,
          deliveredAt: input.delivered ? now : undefined,
          deliveredByName: input.deliveredByName || undefined,
          deliveryNote: input.deliveryNote || undefined
        }
      });
      await audit(tx, req, { action: 'CARD_DELIVERY_UPDATED', entity: 'Card', entityId: card.id, schoolId: card.student.schoolId, oldValue: cleanJson({ printedAt: card.printedAt, deliveredAt: card.deliveredAt }), newValue: cleanJson(input) });
      return nextCard;
    });
    res.json({ card: updated });
  } catch (error) { next(error); }
});
app.get('/api/v1/cards', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = req.claims!.schoolId;
    const cards = await prisma.card.findMany({ where: schoolId ? { student: { schoolId } } : {}, include: { student: { select: { id: true, fullName: true, studentCode: true, grade: true, school: { select: { id: true, name: true } } } } }, orderBy: { issuedAt: 'desc' } });
    res.json({ cards });
  } catch (error) { next(error); }
});

const topUpSchema = z.object({ studentId: z.string().cuid(), amount: z.coerce.number().positive().max(10000), reason: z.string().trim().max(80).optional() });
const bulkTopUpSchema = z.object({
  schoolId: z.string().cuid(),
  amount: z.coerce.number().positive().max(10000),
  grade: z.string().trim().max(32).optional(),
  studentIds: z.array(z.string().cuid()).max(500).optional(),
  reason: z.string().trim().max(80).optional()
});
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
      await audit(tx, req, { action: 'WALLET_TOP_UP', entity: 'WalletTransaction', entityId: created.id, schoolId: student.schoolId, newValue: cleanJson({ studentId: student.id, amount: input.amount, reason: input.reason, balanceBefore, balanceAfter }) });
      return created;
    });
    res.status(201).json({ transaction });
  } catch (error) { next(error); }
});
app.post('/api/v1/wallets/bulk-top-up', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = bulkTopUpSchema.parse(req.body);
    if (!scopedSchool(req.claims!, input.schoolId)) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });

    const school = await prisma.school.findUniqueOrThrow({ where: { id: input.schoolId }, select: { id: true, name: true, status: true } });
    if (school.status !== EntityStatus.ACTIVE) return res.status(409).json({ error: 'SCHOOL_INACTIVE' });

    const uniqueStudentIds = [...new Set(input.studentIds ?? [])];
    const where = {
      schoolId: input.schoolId,
      status: EntityStatus.ACTIVE,
      ...(input.grade ? { grade: input.grade } : {}),
      ...(uniqueStudentIds.length ? { id: { in: uniqueStudentIds } } : {})
    };

    const students = await prisma.student.findMany({
      where,
      include: { wallet: true },
      orderBy: { fullName: 'asc' }
    });

    if (uniqueStudentIds.length && students.length !== uniqueStudentIds.length) return res.status(400).json({ error: 'INVALID_STUDENT_SELECTION' });
    if (!students.length) return res.status(400).json({ error: 'NO_ACTIVE_STUDENTS' });
    if (students.some(student => !student.wallet)) return res.status(409).json({ error: 'WALLET_NOT_FOUND' });

    const result = await prisma.$transaction(async tx => {
      const transactions = [];

      for (const student of students) {
        const rows = await tx.$queryRaw<Array<{ id: string; balance: unknown }>>`SELECT id, balance FROM Wallet WHERE id = ${student.wallet!.id} FOR UPDATE`;
        const wallet = rows[0];
        if (!wallet) throw new Error('WALLET_NOT_FOUND');

        const balanceBefore = Number(wallet.balance);
        const balanceAfter = balanceBefore + input.amount;
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
        const created = await tx.walletTransaction.create({
          data: {
            reference: randomUUID(),
            walletId: wallet.id,
            studentId: student.id,
            schoolId: student.schoolId,
            amount: input.amount,
            type: TransactionType.CREDIT,
            balanceBefore,
            balanceAfter,
            performedById: req.claims!.sub
          }
        });
        await audit(tx, req, {
          action: 'WALLET_BULK_TOP_UP',
          entity: 'WalletTransaction',
          entityId: created.id,
          schoolId: student.schoolId,
          newValue: cleanJson({ studentId: student.id, amount: input.amount, reason: input.reason, balanceBefore, balanceAfter, schoolId: input.schoolId, grade: input.grade })
        });
        transactions.push(created);
      }

      await audit(tx, req, {
        action: 'WALLET_BULK_TOP_UP_BATCH',
        entity: 'School',
        entityId: school.id,
        schoolId: school.id,
        newValue: cleanJson({
          schoolId: school.id,
          schoolName: school.name,
          mode: uniqueStudentIds.length ? 'SELECTED_STUDENTS' : input.grade ? 'GRADE' : 'WHOLE_SCHOOL',
          reason: input.reason,
          grade: input.grade,
          amountPerStudent: input.amount,
          studentCount: students.length,
          totalAmount: input.amount * students.length
        })
      });

      return {
        count: transactions.length,
        amountPerStudent: input.amount.toFixed(2),
        totalAmount: (input.amount * transactions.length).toFixed(2),
        transactionIds: transactions.map(transaction => transaction.id)
      };
    });

    res.status(201).json({ batch: result });
  } catch (error) { next(error); }
});
app.get('/api/v1/transactions', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = scopedSchoolFromQuery(req);
    const studentId = typeof req.query.studentId === 'string' ? req.query.studentId : undefined;
    const canteenId = typeof req.query.canteenId === 'string' ? req.query.canteenId : undefined;
    const reference = typeof req.query.reference === 'string' ? req.query.reference.trim() : '';
    const type = typeof req.query.type === 'string' && Object.values(TransactionType).includes(req.query.type as TransactionType) ? req.query.type as TransactionType : undefined;
    const createdAt = parseDateRange(req.query as Record<string, unknown>);
    const where: Prisma.WalletTransactionWhereInput = {
      ...(schoolId ? { schoolId } : {}),
      ...(studentId ? { studentId } : {}),
      ...(canteenId ? { canteenId } : {}),
      ...(type ? { type } : {}),
      ...(reference ? { reference: { contains: reference } } : {}),
      ...(createdAt ? { createdAt } : {})
    };
    const transactions = await prisma.walletTransaction.findMany({
      where,
      include: { school: { select: { name: true } }, canteen: { select: { id: true, name: true } }, performedBy: { select: { email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500
    });
    const totals = await prisma.walletTransaction.groupBy({ by: ['type'], where, _sum: { amount: true } });
    const studentIds = [...new Set(transactions.map(transaction => transaction.studentId))];
    const students = await prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, fullName: true, studentCode: true } });
    const studentMap = new Map(students.map(student => [student.id, student]));
    res.json({ transactions: transactions.map(transaction => ({ ...transaction, student: studentMap.get(transaction.studentId) })), totals });
  } catch (error) { next(error); }
});
app.get('/api/v1/dashboard', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const settings = await getSystemSettings();
    const schoolId = scopedSchoolFromQuery(req);
    const studentWhere = schoolId ? { schoolId } : {};
    const walletWhere = schoolId ? { student: { schoolId } } : {};
    const transactionWhere = schoolId ? { schoolId } : {};
    const today = startOfToday();
    const week = daysAgo(6);
    const month = startOfThisMonth();
    const dashboardPeriod = parseDashboardPeriod(req.query as Record<string, unknown>);
    const period = dashboardPeriod.period;
    const periodStart = dashboardPeriod.start;
    const periodDateFilter: Prisma.DateTimeFilter = dashboardPeriod.end ? { gte: periodStart, lt: dashboardPeriod.end } : { gte: periodStart };
    const last7Start = daysAgo(6);
    const last7Days = Array.from({ length: 7 }, (_, index) => {
      const date = daysAgo(6 - index);
      return date.toISOString().slice(0, 10);
    });

    const [
      schools,
      activeStudents,
      walletBalance,
      todayTransactions,
      periodTransactions,
      todaySpent,
      weekSpent,
      monthSpent,
      periodSpent,
      revokedCards,
      lowWallets,
      lowWalletCount,
      activeStudentRows,
      todayDebitRows,
      todayRefundRows,
      revokedAttempts,
      failedLogins,
      refundGroups,
      last7Transactions,
      topStudentGroups,
      topSchoolGroups,
      dashboardCanteens,
      lastBackup,
      zeroWalletCount,
      unfundedStudents,
      recentActivity
    ] = await Promise.all([
      prisma.school.count({ where: schoolId ? { id: schoolId } : {} }),
      prisma.student.count({ where: { ...studentWhere, status: EntityStatus.ACTIVE } }),
      prisma.wallet.aggregate({ where: walletWhere, _sum: { balance: true } }),
      prisma.walletTransaction.count({ where: { ...transactionWhere, createdAt: { gte: today } } }),
      prisma.walletTransaction.count({ where: { ...transactionWhere, type: TransactionType.DEBIT, createdAt: periodDateFilter } }),
      prisma.walletTransaction.aggregate({ where: { ...transactionWhere, type: TransactionType.DEBIT, createdAt: { gte: today } }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { ...transactionWhere, type: TransactionType.DEBIT, createdAt: { gte: week } }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { ...transactionWhere, type: TransactionType.DEBIT, createdAt: { gte: month } }, _sum: { amount: true } }),
      prisma.walletTransaction.aggregate({ where: { ...transactionWhere, type: TransactionType.DEBIT, createdAt: periodDateFilter }, _sum: { amount: true } }),
      prisma.card.count({ where: { status: 'REVOKED', ...(schoolId ? { student: { schoolId } } : {}) } }),
      prisma.wallet.findMany({ where: { balance: { lt: settings.lowBalanceThreshold }, student: { ...studentWhere, status: EntityStatus.ACTIVE } }, include: { student: { select: { id: true, fullName: true, studentCode: true, school: { select: { name: true } } } } }, take: 5, orderBy: { balance: 'asc' } }),
      prisma.wallet.count({ where: { balance: { lt: settings.lowBalanceThreshold }, student: { ...studentWhere, status: EntityStatus.ACTIVE } } }),
      prisma.student.findMany({ where: { ...studentWhere, status: EntityStatus.ACTIVE }, select: { id: true, fullName: true, studentCode: true, dailyLimit: true, school: { select: { name: true } } } }),
      prisma.walletTransaction.findMany({ where: { ...transactionWhere, type: TransactionType.DEBIT, createdAt: { gte: today } }, select: { studentId: true, amount: true } }),
      prisma.walletTransaction.findMany({ where: { ...transactionWhere, type: TransactionType.REFUND, createdAt: { gte: today } }, select: { studentId: true, amount: true, reference: true } }),
      prisma.auditLog.count({ where: { ...(schoolId ? { schoolId } : {}), action: 'CARD_REVOKED_USED', timestamp: { gte: daysAgo(7) } } }),
      prisma.loginAttempt.count({ where: { failedCount: { gte: 3 } } }),
      prisma.walletTransaction.groupBy({ by: ['performedById', 'schoolId'], where: { ...transactionWhere, type: TransactionType.REFUND, createdAt: { gte: daysAgo(7) } }, _count: { id: true } }),
      prisma.walletTransaction.findMany({ where: { ...transactionWhere, type: TransactionType.DEBIT, createdAt: { gte: last7Start } }, select: { amount: true, createdAt: true } }),
      prisma.walletTransaction.groupBy({ by: ['studentId'], where: { ...transactionWhere, type: TransactionType.DEBIT, createdAt: periodDateFilter }, _sum: { amount: true }, _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 5 }),
      prisma.walletTransaction.groupBy({ by: ['schoolId'], where: { ...transactionWhere, type: TransactionType.DEBIT, createdAt: periodDateFilter }, _sum: { amount: true }, _count: { id: true }, orderBy: { _count: { id: 'desc' } }, take: 5 }),
      prisma.canteen.findMany({ where: { status: EntityStatus.ACTIVE, ...(schoolId ? { schoolId } : {}) }, select: { id: true } }),
      prisma.auditLog.findFirst({ where: { action: 'SYSTEM_BACKUP_CREATED' }, orderBy: { timestamp: 'desc' }, select: { timestamp: true } }),
      prisma.wallet.count({ where: { balance: { lte: 0 }, student: { ...studentWhere, status: EntityStatus.ACTIVE } } }),
      prisma.student.findMany({ where: { ...studentWhere, status: EntityStatus.ACTIVE, wallet: { transactions: { none: { type: TransactionType.CREDIT } } } }, select: { id: true, fullName: true, studentCode: true, school: { select: { name: true } } }, take: 5, orderBy: { createdAt: 'desc' } }),
      prisma.auditLog.findMany({
        where: { ...(schoolId ? { schoolId } : {}), action: { in: ['STUDENT_CREATED', 'STUDENTS_IMPORTED', 'STUDENT_UPDATED', 'STUDENT_TRANSFERRED', 'WALLET_TOP_UP', 'BULK_WALLET_TOP_UP', 'CARD_REVOKED', 'CARD_ISSUED', 'CARD_DELIVERY_UPDATED', 'CANTEEN_SETTLED', 'SYSTEM_BACKUP_CREATED', 'AUDITOR_USER_CREATED'] } },
        include: { user: { select: { email: true } }, school: { select: { name: true } } },
        orderBy: { timestamp: 'desc' },
        take: 8
      })
    ]);

    const dailyLimitMap = new Map(activeStudentRows.map(student => [student.id, { student, debit: 0, refund: 0 }]));
    for (const debit of todayDebitRows) {
      const item = dailyLimitMap.get(debit.studentId);
      if (item) item.debit += money(debit.amount);
    }
    for (const refund of todayRefundRows.filter(item => item.reference.startsWith('REFUND-'))) {
      const item = dailyLimitMap.get(refund.studentId);
      if (item) item.refund += money(refund.amount);
    }
    const dailyLimitReached = [...dailyLimitMap.values()].filter(item => Math.max(0, item.debit - item.refund) >= money(item.student.dailyLimit));
    const repeatedRefunds = refundGroups.filter(group => group._count.id >= 3).length;
    const backupAgeHours = lastBackup ? (Date.now() - lastBackup.timestamp.getTime()) / 60 / 60 / 1000 : null;
    const backupAlert = settings.backupReminderEnabled && (!lastBackup || (backupAgeHours ?? 0) > 26);
    const busyStudents = [...dailyLimitMap.values()].filter(item => item.debit >= Math.max(20, money(item.student.dailyLimit) * 2));
    const rawAlertsCount = lowWalletCount + dailyLimitReached.length + revokedAttempts + failedLogins + repeatedRefunds + zeroWalletCount + unfundedStudents.length + busyStudents.length + (backupAlert ? 1 : 0);
    const actionItems = settings.alertsEnabled ? [
      ...unfundedStudents.map(student => ({
        id: `UNFUNDED_STUDENT_${student.id}`,
        type: 'UNFUNDED_STUDENT',
        severity: 'warn' as const,
        title: 'طالب بدون مبلغ فسحة',
        description: `${student.fullName} في ${student.school.name} لم يتم تخصيص مبلغ فسحة له بعد`,
        metric: '0 تخصيص',
        href: `/students/${student.id}`
      })),
      ...(zeroWalletCount ? [{
        id: 'ZERO_BALANCE_STUDENTS',
        type: 'ZERO_BALANCE',
        severity: 'danger' as const,
        title: 'طلاب رصيد الفسحة لديهم صفر',
        description: `${zeroWalletCount} طالب نشط لا يوجد لديه رصيد فسحة متاح`,
        metric: zeroWalletCount,
        href: '/students'
      }] : []),
      ...lowWallets.map(wallet => ({
        id: `LOW_BALANCE_${wallet.student.id}`,
        type: 'LOW_BALANCE',
        severity: 'warn' as const,
        title: 'رصيد فسحة منخفض',
        description: `${wallet.student.fullName} في ${wallet.student.school.name} رصيد الفسحة لديه ${asMoney(wallet.balance)} ر.س`,
        metric: `${asMoney(wallet.balance)} ر.س`,
        href: `/students/${wallet.student.id}`
      })),
      ...dailyLimitReached.slice(0, 5).map(item => ({
        id: `DAILY_LIMIT_${item.student.id}`,
        type: 'DAILY_LIMIT_REACHED',
        severity: 'danger' as const,
        title: 'طالب وصل الحد اليومي',
        description: `${item.student.fullName} صرف ${asMoney(Math.max(0, item.debit - item.refund))} من حد ${asMoney(item.student.dailyLimit)} ر.س`,
        metric: `${asMoney(Math.max(0, item.debit - item.refund))}/${asMoney(item.student.dailyLimit)}`,
        href: `/students/${item.student.id}`
      })),
      ...busyStudents.slice(0, 5).map(item => ({
        id: `ABNORMAL_USAGE_${item.student.id}`,
        type: 'ABNORMAL_USAGE',
        severity: 'warn' as const,
        title: 'استخدام عالي يحتاج مراجعة',
        description: `${item.student.fullName} صرف اليوم ${asMoney(item.debit)} ر.س، أعلى من النمط المتوقع`,
        metric: `${asMoney(item.debit)} ر.س`,
        href: `/students/${item.student.id}`
      })),
      ...(revokedAttempts ? [{
        id: 'REVOKED_CARD_ATTEMPTS',
        type: 'REVOKED_CARD_ATTEMPTS',
        severity: 'danger' as const,
        title: 'محاولات استخدام بطاقة ملغاة',
        description: `${revokedAttempts} محاولة خلال آخر 7 أيام`,
        metric: revokedAttempts,
        href: '/alerts'
      }] : []),
      ...(failedLogins ? [{
        id: 'FAILED_LOGINS',
        type: 'FAILED_LOGINS',
        severity: 'warn' as const,
        title: 'محاولات دخول فاشلة كثيرة',
        description: `${failedLogins} حساب/بريد عليه محاولات فاشلة متكررة`,
        metric: failedLogins,
        href: '/alerts'
      }] : []),
      ...(repeatedRefunds ? [{
        id: 'REPEATED_REFUNDS',
        type: 'REPEATED_REFUNDS',
        severity: 'warn' as const,
        title: 'استرجاعات متكررة',
        description: `${repeatedRefunds} كاشير/مدرسة لديهم 3 استرجاعات أو أكثر خلال آخر 7 أيام`,
        metric: repeatedRefunds,
        href: '/alerts'
      }] : []),
      ...(backupAlert ? [{
        id: 'BACKUP_MISSING_OR_STALE',
        type: 'BACKUP_HEALTH',
        severity: 'danger' as const,
        title: 'فشل أو تأخر النسخ الاحتياطي اليومي',
        description: lastBackup ? `آخر نسخة مسجلة قبل ${Math.floor(backupAgeHours ?? 0)} ساعة.` : 'لم يتم تسجيل نسخة احتياطية من داخل النظام حتى الآن.',
        metric: 'نسخة',
        href: '/system'
      }] : [])
    ].sort((a, b) => alertPriority[b.severity] - alertPriority[a.severity]) : [];

    const spendingByDay = last7Days.map(date => ({ date, amount: 0, count: 0 }));
    const dayMap = new Map(spendingByDay.map(item => [item.date, item]));
    for (const transaction of last7Transactions) {
      const date = transaction.createdAt.toISOString().slice(0, 10);
      const item = dayMap.get(date);
      if (!item) continue;
      item.amount += money(transaction.amount);
      item.count += 1;
    }
    const maxDailySpend = Math.max(1, ...spendingByDay.map(item => item.amount));

    const topStudentIds = topStudentGroups.map(group => group.studentId);
    const topSchoolIds = topSchoolGroups.map(group => group.schoolId);
    const [topStudentsData, topSchoolsData, canteenSummaries] = await Promise.all([
      prisma.student.findMany({ where: { id: { in: topStudentIds } }, select: { id: true, fullName: true, studentCode: true, school: { select: { name: true } } } }),
      prisma.school.findMany({ where: { id: { in: topSchoolIds } }, select: { id: true, name: true, schoolCode: true } }),
      Promise.all(dashboardCanteens.map(canteen => canteenDueByCanteen(canteen.id, req.claims!)))
    ]);
    const topStudentMap = new Map(topStudentsData.map(student => [student.id, student]));
    const topSchoolMap = new Map(topSchoolsData.map(school => [school.id, school]));
    const canteenUnsettledTotal = canteenSummaries.reduce((sum, item) => sum + money(item.net), 0);
    const canteensWithDue = canteenSummaries.filter(item => money(item.net) > 0).length;

    res.json({
      schools,
      students: activeStudents,
      walletBalance: asMoney(walletBalance._sum.balance),
      todayTransactions,
      periodTransactions,
      todaySpent: asMoney(todaySpent._sum.amount),
      weekSpent: asMoney(weekSpent._sum.amount),
      monthSpent: asMoney(monthSpent._sum.amount),
      periodSpent: asMoney(periodSpent._sum.amount),
      revokedCards,
      alertsCount: settings.alertsEnabled ? rawAlertsCount : 0,
      filter: {
        period,
        schoolId: schoolId ?? null,
        startDate: periodStart.toISOString().slice(0, 10),
        endDate: dashboardPeriod.end ? new Date(dashboardPeriod.end.getTime() - 1).toISOString().slice(0, 10) : null
      },
      spendingByDay: spendingByDay.map(item => ({ ...item, amount: asMoney(item.amount), percentage: Math.round((item.amount / maxDailySpend) * 100) })),
      topStudents: topStudentGroups.map(group => {
        const student = topStudentMap.get(group.studentId);
        return { studentId: group.studentId, fullName: student?.fullName ?? group.studentId, studentCode: student?.studentCode ?? '—', schoolName: student?.school.name ?? '—', count: group._count.id, amount: asMoney(group._sum.amount) };
      }),
      topSchools: topSchoolGroups.map(group => {
        const school = topSchoolMap.get(group.schoolId);
        return { schoolId: group.schoolId, schoolName: school?.name ?? group.schoolId, schoolCode: school?.schoolCode ?? '—', count: group._count.id, amount: asMoney(group._sum.amount) };
      }),
      quickAlerts: {
        lowBalances: lowWallets.map(wallet => ({ studentId: wallet.student.id, studentName: wallet.student.fullName, studentCode: wallet.student.studentCode, schoolName: wallet.student.school.name, balance: asMoney(wallet.balance) })),
        dailyLimitReached: dailyLimitReached.slice(0, 5).map(item => ({ studentId: item.student.id, studentName: item.student.fullName, studentCode: item.student.studentCode, schoolName: item.student.school.name, spentToday: asMoney(Math.max(0, item.debit - item.refund)), dailyLimit: asMoney(item.student.dailyLimit) })),
        failedLogins,
        repeatedRefunds,
        revokedAttempts,
        actionItems
      },
      canteen: { unsettledTotal: asMoney(canteenUnsettledTotal), canteensWithDue },
      recentActivity: recentActivity.map(log => ({
        id: log.id,
        action: log.action,
        entity: log.entity,
        entityId: log.entityId,
        schoolName: log.school?.name ?? null,
        userEmail: log.user?.email ?? 'النظام',
        timestamp: log.timestamp
      })),
      settings: {
        organizationName: settings.organizationName,
        lowBalanceThreshold: asMoney(settings.lowBalanceThreshold),
        alertsEnabled: settings.alertsEnabled
      }
    });
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
    ['الشهر', 'التاريخ', 'المدرسة', 'رمز الطالب', 'اسم الطالب', 'الصف', 'نوع العملية', 'المبلغ', 'رصيد الفسحة قبل', 'رصيد الفسحة بعد', 'منفذ العملية', 'رقم العملية'],
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
    const settings = await getSystemSettings();
    const schoolId = scopedSchoolFromQuery(req);
    const schoolWhere = schoolId ? { schoolId } : {};
    const today = startOfToday();
    const recent = daysAgo(7);
    const [lowWallets, zeroWallets, unfundedStudents, students, todayDebits, todayRefunds, revokedAttempts, loginAttempts, refundGroups] = await Promise.all([
      prisma.wallet.findMany({ where: { balance: { lt: settings.lowBalanceThreshold }, student: schoolWhere }, include: { student: { select: { id: true, fullName: true, studentCode: true, dailyLimit: true, school: { select: { name: true } } } } }, take: 100, orderBy: { balance: 'asc' } }),
      prisma.wallet.findMany({ where: { balance: { lte: 0 }, student: { ...schoolWhere, status: EntityStatus.ACTIVE } }, include: { student: { select: { id: true, fullName: true, studentCode: true, school: { select: { name: true } } } } }, take: 100, orderBy: { updatedAt: 'desc' } }),
      prisma.student.findMany({ where: { ...schoolWhere, status: EntityStatus.ACTIVE, wallet: { transactions: { none: { type: TransactionType.CREDIT } } } }, select: { id: true, fullName: true, studentCode: true, school: { select: { name: true } } }, take: 100, orderBy: { createdAt: 'desc' } }),
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
    const lowBalances = lowWallets.map(wallet => ({ studentId: wallet.student.id, studentName: wallet.student.fullName, studentCode: wallet.student.studentCode, schoolName: wallet.student.school.name, balance: asMoney(wallet.balance) }));
    const dailyLimitReached = [...debitByStudent.entries()]
      .map(([studentId, totals]) => ({ student: studentMap.get(studentId), net: Math.max(0, totals.debit - totals.refund) }))
      .filter(item => item.student && item.net >= money(item.student.dailyLimit))
      .map(item => ({ studentId: item.student!.id, studentName: item.student!.fullName, studentCode: item.student!.studentCode, schoolName: item.student!.school.name, dailyLimit: asMoney(item.student!.dailyLimit), spentToday: asMoney(item.net) }));
    const revokedCardAttempts = revokedAttempts.map(log => ({ at: log.timestamp, schoolName: log.school?.name ?? '—', userEmail: log.user?.email ?? '—', token: typeof log.newValue === 'object' && log.newValue && 'cardToken' in log.newValue ? String(log.newValue.cardToken) : '—' }));
    const failedLoginAlerts = loginAttempts.map(attempt => ({ email: attempt.email, failedCount: attempt.failedCount, lockedUntil: attempt.lockedUntil, lastAttemptAt: attempt.lastAttemptAt }));
    const repeatedRefunds = refundGroups.filter(group => group._count.id >= 3).map(group => ({ userEmail: refundUserMap.get(group.performedById) ?? group.performedById, schoolName: refundSchoolMap.get(group.schoolId) ?? group.schoolId, count: group._count.id, amount: asMoney(group._sum.amount) }));
    const zeroBalances = zeroWallets.map(wallet => ({ studentId: wallet.student.id, studentName: wallet.student.fullName, studentCode: wallet.student.studentCode, schoolName: wallet.student.school.name, balance: asMoney(wallet.balance) }));
    const unfunded = unfundedStudents.map(student => ({ studentId: student.id, studentName: student.fullName, studentCode: student.studentCode, schoolName: student.school.name }));
    const busyStudents = [...debitByStudent.entries()]
      .map(([studentId, totals]) => ({ student: studentMap.get(studentId), debit: totals.debit }))
      .filter(item => item.student && item.debit >= Math.max(20, money(item.student.dailyLimit) * 2))
      .map(item => ({ studentId: item.student!.id, studentName: item.student!.fullName, studentCode: item.student!.studentCode, schoolName: item.student!.school.name, spentToday: asMoney(item.debit) }));
    const items = [
      ...unfunded.map(item => ({
        id: `UNFUNDED_${item.studentId}`,
        type: 'UNFUNDED_STUDENT',
        severity: 'warn' as const,
        title: 'طالب بدون مبلغ فسحة',
        description: `${item.studentName} — ${item.schoolName} لم يتم تخصيص مبلغ فسحة له بعد`,
        metric: '0 تخصيص',
        href: `/students/${item.studentId}`,
        createdAt: today
      })),
      ...zeroBalances.map(item => ({
        id: `ZERO_BALANCE_${item.studentId}`,
        type: 'ZERO_BALANCE',
        severity: 'danger' as const,
        title: 'رصيد فسحة صفر',
        description: `${item.studentName} — ${item.schoolName} لا يوجد لديه رصيد متاح`,
        metric: `${item.balance} ر.س`,
        href: `/students/${item.studentId}`,
        createdAt: today
      })),
      ...dailyLimitReached.map(item => ({
        id: `DAILY_LIMIT_${item.studentId}`,
        type: 'DAILY_LIMIT_REACHED',
        severity: 'danger' as const,
        title: 'طالب وصل الحد اليومي',
        description: `${item.studentName} — ${item.schoolName} — صرف ${item.spentToday} من حد ${item.dailyLimit} ر.س`,
        metric: `${item.spentToday}/${item.dailyLimit}`,
        href: `/students/${item.studentId}`,
        createdAt: today
      })),
      ...revokedCardAttempts.map(item => ({
        id: `REVOKED_${item.at}_${item.token}`,
        type: 'REVOKED_CARD_ATTEMPT',
        severity: 'danger' as const,
        title: 'بطاقة ملغاة تم استخدامها',
        description: `${new Date(item.at).toLocaleString('ar-SA')} — ${item.schoolName} — ${item.userEmail} — ${item.token}`,
        metric: 'بطاقة ملغاة',
        href: '/audit-logs',
        createdAt: item.at
      })),
      ...lowBalances.map(item => ({
        id: `LOW_BALANCE_${item.studentId}`,
        type: 'LOW_BALANCE',
        severity: 'warn' as const,
        title: `رصيد فسحة أقل من ${asMoney(settings.lowBalanceThreshold)} ريال`,
        description: `${item.studentName} — ${item.schoolName} — رصيد الفسحة ${item.balance} ر.س`,
        metric: `${item.balance} ر.س`,
        href: `/students/${item.studentId}`,
        createdAt: today
      })),
      ...failedLoginAlerts.map(item => ({
        id: `FAILED_LOGIN_${item.email}`,
        type: 'FAILED_LOGINS',
        severity: item.lockedUntil ? 'danger' as const : 'warn' as const,
        title: item.lockedUntil ? 'حساب مقفل مؤقتًا' : 'محاولات دخول فاشلة',
        description: `${item.email}: ${item.failedCount} محاولات${item.lockedUntil ? ` — مقفل حتى ${new Date(item.lockedUntil).toLocaleString('ar-SA')}` : ''}`,
        metric: item.failedCount,
        href: '/audit-logs',
        createdAt: item.lastAttemptAt
      })),
      ...repeatedRefunds.map(item => ({
        id: `REPEATED_REFUNDS_${item.userEmail}_${item.schoolName}`,
        type: 'REPEATED_REFUNDS',
        severity: 'warn' as const,
        title: 'استرجاعات متكررة',
        description: `${item.userEmail} — ${item.schoolName}: ${item.count} استرجاعات / ${item.amount} ر.س`,
        metric: item.count,
        href: '/transactions',
        createdAt: recent
      })),
      ...busyStudents.map(item => ({
        id: `ABNORMAL_USAGE_${item.studentId}`,
        type: 'ABNORMAL_USAGE',
        severity: 'warn' as const,
        title: 'استخدام عالي يحتاج مراجعة',
        description: `${item.studentName} — ${item.schoolName} صرف اليوم ${item.spentToday} ر.س`,
        metric: `${item.spentToday} ر.س`,
        href: `/students/${item.studentId}`,
        createdAt: today
      }))
    ].sort((a, b) => alertPriority[b.severity] - alertPriority[a.severity] || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const visibleItems = settings.alertsEnabled ? items : [];

    res.json({
      summary: {
        total: visibleItems.length,
        danger: visibleItems.filter(item => item.severity === 'danger').length,
        warn: visibleItems.filter(item => item.severity === 'warn').length,
        lowBalances: settings.alertsEnabled ? lowBalances.length : 0,
        dailyLimitReached: settings.alertsEnabled ? dailyLimitReached.length : 0,
        revokedCardAttempts: settings.alertsEnabled ? revokedCardAttempts.length : 0,
        failedLogins: settings.alertsEnabled ? failedLoginAlerts.length : 0,
        repeatedRefunds: settings.alertsEnabled ? repeatedRefunds.length : 0
        ,
        zeroBalances: settings.alertsEnabled ? zeroBalances.length : 0,
        unfundedStudents: settings.alertsEnabled ? unfunded.length : 0,
        abnormalUsage: settings.alertsEnabled ? busyStudents.length : 0
      },
      items: visibleItems,
      lowBalances: settings.alertsEnabled ? lowBalances : [],
      dailyLimitReached: settings.alertsEnabled ? dailyLimitReached : [],
      revokedCardAttempts: settings.alertsEnabled ? revokedCardAttempts : [],
      failedLogins: settings.alertsEnabled ? failedLoginAlerts : [],
      repeatedRefunds: settings.alertsEnabled ? repeatedRefunds : [],
      zeroBalances: settings.alertsEnabled ? zeroBalances : [],
      unfundedStudents: settings.alertsEnabled ? unfunded : [],
      abnormalUsage: settings.alertsEnabled ? busyStudents : [],
      settings: {
        lowBalanceThreshold: asMoney(settings.lowBalanceThreshold),
        alertsEnabled: settings.alertsEnabled
      }
    });
  } catch (error) { next(error); }
});

app.get('/api/v1/exports/students.csv', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = scopedSchoolFromQuery(req);
    const students = await prisma.student.findMany({ where: schoolId ? { schoolId } : {}, include: { school: { select: { name: true } }, wallet: { select: { balance: true, currency: true } }, cards: { where: { status: CardStatus.ACTIVE }, select: { publicToken: true } } }, orderBy: [{ schoolId: 'asc' }, { fullName: 'asc' }] });
    sendCsv(res, 'taazur-students.csv', [
      ['المدرسة', 'رمز الطالب', 'اسم الطالب', 'الصف', 'الحد اليومي', 'رصيد الفسحة', 'العملة', 'رمز البطاقة النشطة'],
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

app.get('/api/v1/exports/canteen-accounting.csv', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const schoolId = scopedSchoolFromQuery(req);
    const createdAt = parseDateRange(req.query as Record<string, unknown>);
    const canteens = await prisma.canteen.findMany({
      where: { status: EntityStatus.ACTIVE, ...(schoolId ? { schoolId } : {}) },
      select: { id: true },
      orderBy: { createdAt: 'desc' }
    });
    const summaries = await Promise.all(canteens.map(canteen => canteenDueByCanteen(canteen.id, req.claims!)));
    const settlements = await prisma.canteenSettlement.findMany({
      where: { ...(schoolId ? { schoolId } : {}), ...(createdAt ? { createdAt } : {}) },
      include: { canteen: { select: { name: true, canteenCode: true } }, canteenUser: { select: { email: true } }, school: { select: { name: true } }, settledBy: { select: { email: true } } },
      orderBy: { createdAt: 'desc' }
    });
    sendCsv(res, 'taazur-canteen-accounting.csv', [
      ['القسم', 'المدرسة', 'المقصف', 'المشغل/المالك', 'مصروفات الفسحة', 'الاسترجاعات', 'المستحق الحالي', 'عدد العمليات', 'تاريخ/فترة', 'المسدد بواسطة', 'ملاحظة'],
      ...summaries.map(summary => ['المستحق الحالي', summary.canteen?.school.name ?? summary.canteenUser.school?.name ?? '—', summary.canteen?.name ?? 'مقصف قديم', summary.canteenUser.email, summary.debit, summary.refund, summary.net, summary.transactionCount, `${summary.periodStart.toLocaleDateString('ar-SA')} - ${summary.periodEnd.toLocaleDateString('ar-SA')}`, '', '']),
      ...settlements.map(settlement => ['تسوية مسددة', settlement.school?.name ?? '—', settlement.canteen?.name ?? 'مقصف قديم', settlement.canteenUser.email, '', '', asMoney(settlement.amount), settlement.transactionCount, `${settlement.periodStart.toLocaleDateString('ar-SA')} - ${settlement.periodEnd.toLocaleDateString('ar-SA')}`, settlement.settledBy.email, settlement.note ?? ''])
    ]);
  } catch (error) { next(error); }
});

const debitSchema = z.object({
  cardToken: z.string().min(20).max(128),
  amount: z.coerce.number().positive().max(1000),
  canteenId: z.string().cuid().optional(),
  previewConfirmed: z.preprocess(value => value === true || value === 'true', z.boolean()).optional()
});

app.get('/api/v1/cards/lookup', auth, roles(Role.CANTEEN_CASHIER, Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    await assertNotCanteenOwner(prisma, req.claims!);
    const cardToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    const canteenId = typeof req.query.canteenId === 'string' ? req.query.canteenId : undefined;
    if (cardToken.length < 20) return res.status(400).json({ error: 'CARD_TOKEN_REQUIRED' });
    const canteen = await resolveCanteenAccess(prisma, req.claims!, canteenId);
    const card = await prisma.card.findUnique({
      where: { publicToken: cardToken },
      include: { student: { include: { wallet: true, school: { select: { name: true } } } } }
    });
    if (!card) return res.status(404).json({ error: 'CARD_NOT_FOUND' });
    if (canteen.schoolId !== card.student.schoolId) return res.status(403).json({ error: 'SCHOOL_SCOPE_DENIED' });
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

app.post('/api/v1/transactions/debit', auth, roles(Role.CANTEEN_CASHIER, Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    await assertNotCanteenOwner(prisma, req.claims!);
    const idempotencyKey = req.header('idempotency-key');
    if (!idempotencyKey) return res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    const input = debitSchema.parse(req.body);
    const settings = await getSystemSettings();
    if (settings.cashierRequireStudentPreview && !input.previewConfirmed) return res.status(409).json({ error: 'STUDENT_PREVIEW_REQUIRED' });
    const existing = await prisma.walletTransaction.findUnique({ where: { idempotencyKey } });
    if (existing) return res.status(200).json({ transaction: existing, replayed: true });
    const canteen = await resolveCanteenAccess(prisma, req.claims!, input.canteenId);
    const transaction = await prisma.$transaction(async tx => {
      const card = await tx.card.findUnique({ where: { publicToken: input.cardToken }, include: { student: true } });
      if (!card) throw new Error('CARD_NOT_FOUND');
      if (card.status === CardStatus.REVOKED) {
        await audit(tx, req, { action: 'CARD_REVOKED_USED', entity: 'Card', entityId: card.id, schoolId: card.student.schoolId, newValue: { cardToken: maskToken(input.cardToken), source: 'debit' } });
        throw new Error('CARD_REVOKED');
      }
      if (card.status !== CardStatus.ACTIVE) throw new Error('CARD_NOT_ACTIVE');
      if (card.student.status !== 'ACTIVE') throw new Error('STUDENT_INACTIVE');
      if (canteen.schoolId !== card.student.schoolId) throw new Error('SCHOOL_SCOPE_DENIED');
      const rows = await tx.$queryRaw<Array<{ id: string; balance: number }>>`SELECT id, balance FROM Wallet WHERE studentId = ${card.studentId} FOR UPDATE`;
      const wallet = rows[0];
      const balanceBefore = wallet ? Number(wallet.balance) : 0;
      if (!wallet || balanceBefore < input.amount) throw new Error('INSUFFICIENT_BALANCE');
      const todayNetDebit = await getTodayNetDebit(tx, card.studentId);
      if (todayNetDebit + input.amount > Number(card.student.dailyLimit)) throw new Error('DAILY_LIMIT_EXCEEDED');
      const balanceAfter = balanceBefore - input.amount;
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: balanceAfter } });
      const created = await tx.walletTransaction.create({ data: { reference: randomUUID(), idempotencyKey, walletId: wallet.id, studentId: card.studentId, schoolId: card.student.schoolId, canteenId: canteen.canteenId, amount: input.amount, type: TransactionType.DEBIT, balanceBefore, balanceAfter, performedById: req.claims!.sub } });
      await audit(tx, req, { action: 'CANTEEN_DEBIT', entity: 'WalletTransaction', entityId: created.id, schoolId: card.student.schoolId, newValue: cleanJson({ cardId: card.id, studentId: card.studentId, canteenId: canteen.canteenId, canteenName: canteen.name, amount: input.amount, balanceBefore, balanceAfter }) });
      return { ...created, canteen: { id: canteen.canteenId, name: canteen.name }, student: { fullName: card.student.fullName, studentCode: card.student.studentCode } };
    });
    return res.status(201).json({ transaction });
  } catch (error) { next(error); }
});

async function refundDebit(originalId: string, claims: Claims, req: Request, reason?: string) {
  const original = await prisma.walletTransaction.findUniqueOrThrow({ where: { id: originalId } });
  if (original.type !== TransactionType.DEBIT) throw new Error('REFUND_ONLY_DEBIT');
  if (!scopedSchool(claims, original.schoolId)) throw new Error('SCHOOL_SCOPE_DENIED');
  if ((claims.role === Role.CANTEEN_OPERATOR || claims.role === Role.CANTEEN_CASHIER) && original.performedById !== claims.sub) throw new Error('FORBIDDEN');
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
    const created = await tx.walletTransaction.create({ data: { reference: refundReference, walletId: wallet.id, studentId: original.studentId, schoolId: original.schoolId, canteenId: original.canteenId, amount, type: TransactionType.REFUND, balanceBefore, balanceAfter, performedById: claims.sub } });
    await audit(tx, req, { action: 'TRANSACTION_REFUNDED', entity: 'WalletTransaction', entityId: created.id, schoolId: original.schoolId, oldValue: { originalTransactionId: original.id, amount }, newValue: cleanJson({ refundTransactionId: created.id, balanceBefore, balanceAfter, reason }) });
    return created;
  });
  return { transaction, replayed: false };
}
app.post('/api/v1/transactions/refund-by-reference', auth, roles(Role.CANTEEN_CASHIER, Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    await assertNotCanteenOwner(prisma, req.claims!);
    const input = z.object({ reference: z.string().trim().min(8).max(80), reason: z.string().trim().min(3).max(200).optional() }).parse(req.body);
    const original = await prisma.walletTransaction.findUnique({ where: { reference: input.reference } });
    if (!original) return res.status(404).json({ error: 'TRANSACTION_NOT_FOUND' });
    const result = await refundDebit(original.id, req.claims!, req, input.reason);
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { next(error); }
});
app.post('/api/v1/transactions/:transactionId/refund', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = z.object({ reason: z.string().trim().min(3).max(200).optional() }).parse(req.body ?? {});
    const result = await refundDebit(routeParam(req.params.transactionId), req.claims!, req, input.reason);
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (error) { next(error); }
});

async function canteenDueByUser(canteenUserId: string, claims: Claims) {
  const canteenUser = await prisma.user.findUniqueOrThrow({
    where: { id: canteenUserId },
    select: { id: true, email: true, role: true, schoolId: true, school: { select: { name: true, schoolCode: true } } }
  });
  if (!(canteenUser.role === Role.CANTEEN_OPERATOR || canteenUser.role === Role.CANTEEN_OWNER || canteenUser.role === Role.CANTEEN_CASHIER)) throw new Error('FORBIDDEN');
  if (canteenUser.schoolId && !scopedSchool(claims, canteenUser.schoolId)) throw new Error('SCHOOL_SCOPE_DENIED');
  const [lastSettlement, settledAggregate, settlementCount] = await Promise.all([
    prisma.canteenSettlement.findFirst({ where: { canteenUserId }, orderBy: { periodEnd: 'desc' } }),
    prisma.canteenSettlement.aggregate({ where: { canteenUserId }, _sum: { amount: true } }),
    prisma.canteenSettlement.count({ where: { canteenUserId } })
  ]);
  const periodStart = lastSettlement?.periodEnd ?? new Date(0);
  const transactions = await prisma.walletTransaction.findMany({
    where: { performedById: canteenUserId, createdAt: { gt: periodStart }, type: { in: [TransactionType.DEBIT, TransactionType.REFUND] } },
    select: { amount: true, type: true }
  });
  const debit = transactions.filter(transaction => transaction.type === TransactionType.DEBIT).reduce((sum, transaction) => sum + money(transaction.amount), 0);
  const refund = transactions.filter(transaction => transaction.type === TransactionType.REFUND).reduce((sum, transaction) => sum + money(transaction.amount), 0);
  return {
    canteenUser,
    canteen: null,
    periodStart,
    periodEnd: new Date(),
    debit: asMoney(debit),
    refund: asMoney(refund),
    net: asMoney(Math.max(0, debit - refund)),
    transactionCount: transactions.filter(transaction => transaction.type === TransactionType.DEBIT).length,
    settled: asMoney(settledAggregate._sum.amount),
    settlementCount,
    lastSettlementAt: lastSettlement?.createdAt ?? null
  };
}

async function canteenDueByCanteen(canteenId: string, claims: Claims) {
  const canteen = await prisma.canteen.findUniqueOrThrow({
    where: { id: canteenId },
    include: {
      school: { select: { name: true, schoolCode: true } },
      operator: { select: { id: true, email: true, role: true, schoolId: true, school: { select: { name: true, schoolCode: true } } } }
    }
  });
  if (canteen.status !== EntityStatus.ACTIVE) throw new Error('CANTEEN_INACTIVE');
  if ((claims.role === Role.CANTEEN_OPERATOR || claims.role === Role.CANTEEN_OWNER) && canteen.operatorId !== claims.sub) throw new Error('CANTEEN_SCOPE_DENIED');
  if (!scopedSchool(claims, canteen.schoolId)) throw new Error('SCHOOL_SCOPE_DENIED');

  const [lastSettlement, legacySettlement, settledAggregate, settlementCount, activeSchoolCanteens] = await Promise.all([
    prisma.canteenSettlement.findFirst({ where: { canteenId }, orderBy: { periodEnd: 'desc' } }),
    prisma.canteenSettlement.findFirst({ where: { canteenId: null, schoolId: canteen.schoolId }, orderBy: { periodEnd: 'desc' } }),
    prisma.canteenSettlement.aggregate({ where: { canteenId }, _sum: { amount: true } }),
    prisma.canteenSettlement.count({ where: { canteenId } }),
    prisma.canteen.count({ where: { schoolId: canteen.schoolId, status: EntityStatus.ACTIVE } })
  ]);
  const periodStart = lastSettlement?.periodEnd ?? new Date(0);
  const legacyPeriodStart = new Date(Math.max(
    periodStart.getTime(),
    legacySettlement?.periodEnd.getTime() ?? 0
  ));
  const transactionWhere: Prisma.WalletTransactionWhereInput = {
    type: { in: [TransactionType.DEBIT, TransactionType.REFUND] },
    OR: [
      { canteenId, createdAt: { gt: periodStart } },
      ...(activeSchoolCanteens === 1 ? [{ canteenId: null, schoolId: canteen.schoolId, createdAt: { gt: legacyPeriodStart } }] : [])
    ]
  };
  const transactions = await prisma.walletTransaction.findMany({
    where: transactionWhere,
    select: { amount: true, type: true }
  });
  const debit = transactions.filter(transaction => transaction.type === TransactionType.DEBIT).reduce((sum, transaction) => sum + money(transaction.amount), 0);
  const refund = transactions.filter(transaction => transaction.type === TransactionType.REFUND).reduce((sum, transaction) => sum + money(transaction.amount), 0);

  return {
    canteenUser: canteen.operator,
    canteen: { id: canteen.id, name: canteen.name, canteenCode: canteen.canteenCode, schoolId: canteen.schoolId, school: canteen.school },
    periodStart,
    periodEnd: new Date(),
    debit: asMoney(debit),
    refund: asMoney(refund),
    net: asMoney(Math.max(0, debit - refund)),
    transactionCount: transactions.filter(transaction => transaction.type === TransactionType.DEBIT).length,
    settled: asMoney(settledAggregate._sum.amount),
    settlementCount,
    lastSettlementAt: lastSettlement?.createdAt ?? null
  };
}

app.get('/api/v1/canteen/summary', auth, roles(Role.CANTEEN_CASHIER, Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    await assertNotCanteenOwner(prisma, req.claims!);
    const canteenId = typeof req.query.canteenId === 'string' ? req.query.canteenId : undefined;
    const canteen = await resolveCanteenAccess(prisma, req.claims!, canteenId);
    const summary = canteen.canteenId ? await canteenDueByCanteen(canteen.canteenId, req.claims!) : await canteenDueByUser(req.claims!.sub, req.claims!);
    res.json({ summary });
  } catch (error) { next(error); }
});

app.get('/api/v1/canteen/recent-transactions', auth, roles(Role.CANTEEN_CASHIER, Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    await assertNotCanteenOwner(prisma, req.claims!);
    const canteenId = typeof req.query.canteenId === 'string' ? req.query.canteenId : undefined;
    const canteen = await resolveCanteenAccess(prisma, req.claims!, canteenId);
    const transactions = await prisma.walletTransaction.findMany({
      where: {
        schoolId: canteen.schoolId,
        performedById: req.claims!.sub,
        type: { in: [TransactionType.DEBIT, TransactionType.REFUND] },
        ...(canteen.canteenId ? { canteenId: canteen.canteenId } : {})
      },
      include: { canteen: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10
    });
    const studentIds = [...new Set(transactions.map(transaction => transaction.studentId))];
    const students = await prisma.student.findMany({ where: { id: { in: studentIds } }, select: { id: true, fullName: true, studentCode: true } });
    const studentMap = new Map(students.map(student => [student.id, student]));
    res.json({ transactions: transactions.map(transaction => ({ ...transaction, student: studentMap.get(transaction.studentId) })) });
  } catch (error) { next(error); }
});

app.get('/api/v1/canteen/owner-summary', auth, roles(Role.CANTEEN_OWNER, Role.CANTEEN_OPERATOR), async (req, res, next) => {
  try {
    const canteens = await prisma.canteen.findMany({
      where: { operatorId: req.claims!.sub, status: EntityStatus.ACTIVE, ...(req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {}) },
      select: { id: true },
      orderBy: { createdAt: 'desc' }
    });
    const summaries = canteens.length
      ? await Promise.all(canteens.map(canteen => canteenDueByCanteen(canteen.id, req.claims!)))
      : [];
    const settlements = await prisma.canteenSettlement.findMany({
      where: { canteenUserId: req.claims!.sub },
      include: {
        canteen: { select: { name: true, canteenCode: true, school: { select: { name: true, schoolCode: true } } } },
        school: { select: { name: true, schoolCode: true } },
        settledBy: { select: { email: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 25
    });
    const totals = summaries.reduce((total, summary) => ({
      debit: total.debit + money(summary.debit),
      refund: total.refund + money(summary.refund),
      net: total.net + money(summary.net),
      settled: total.settled + money(summary.settled),
      transactionCount: total.transactionCount + summary.transactionCount
    }), { debit: 0, refund: 0, net: 0, settled: 0, transactionCount: 0 });
    res.json({
      summaries,
      settlements,
      totals: {
        debit: asMoney(totals.debit),
        refund: asMoney(totals.refund),
        net: asMoney(totals.net),
        settled: asMoney(totals.settled),
        transactionCount: totals.transactionCount,
        canteenCount: canteens.length
      }
    });
  } catch (error) { next(error); }
});

app.get('/api/v1/canteen/settlements', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const canteens = await prisma.canteen.findMany({
      where: { status: EntityStatus.ACTIVE, ...(req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {}) },
      select: { id: true },
      orderBy: { createdAt: 'desc' }
    });
    const legacyUserWhere = { role: Role.CANTEEN_OPERATOR, status: EntityStatus.ACTIVE, operatedCanteens: { none: {} }, ...(req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {}) };
    const legacyUsers = await prisma.user.findMany({ where: legacyUserWhere, select: { id: true }, orderBy: { createdAt: 'desc' } });
    const summaries = [
      ...await Promise.all(canteens.map(canteen => canteenDueByCanteen(canteen.id, req.claims!))),
      ...await Promise.all(legacyUsers.map(user => canteenDueByUser(user.id, req.claims!)))
    ];
    const settlements = await prisma.canteenSettlement.findMany({
      where: req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {},
      include: { canteen: { select: { name: true, canteenCode: true } }, canteenUser: { select: { email: true } }, settledBy: { select: { email: true } }, school: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json({ summaries, settlements });
  } catch (error) { next(error); }
});

app.post('/api/v1/canteen/settlements', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN), async (req, res, next) => {
  try {
    const input = z.object({ canteenId: z.string().cuid().optional(), canteenUserId: z.string().cuid().optional(), note: z.string().trim().max(200).optional(), receiptNumber: z.string().trim().max(80).optional() }).parse(req.body);
    if (!input.canteenId && !input.canteenUserId) return res.status(400).json({ error: 'CANTEEN_REQUIRED' });
    const due = input.canteenId ? await canteenDueByCanteen(input.canteenId, req.claims!) : await canteenDueByUser(input.canteenUserId!, req.claims!);
    const amount = money(due.net);
    if (amount <= 0) return res.status(409).json({ error: 'NO_UNSETTLED_AMOUNT' });
    const settlement = await prisma.$transaction(async tx => {
      const created = await tx.canteenSettlement.create({
        data: {
          schoolId: due.canteen?.schoolId ?? due.canteenUser.schoolId,
          canteenId: input.canteenId,
          canteenUserId: due.canteenUser.id,
          amount,
          transactionCount: due.transactionCount,
          periodStart: due.periodStart,
          periodEnd: due.periodEnd,
          note: [input.receiptNumber ? `رقم الإيصال/الحوالة: ${input.receiptNumber}` : '', input.note ?? ''].filter(Boolean).join(' — ') || undefined,
          settledById: req.claims!.sub
        },
        include: { canteen: { select: { name: true, canteenCode: true } }, canteenUser: { select: { email: true } }, settledBy: { select: { email: true } }, school: { select: { name: true } } }
      });
      await audit(tx, req, { action: 'CANTEEN_SETTLED', entity: 'CanteenSettlement', entityId: created.id, schoolId: created.schoolId, newValue: cleanJson({ canteenId: created.canteenId, canteenUserId: created.canteenUserId, amount, transactionCount: due.transactionCount, receiptNumber: input.receiptNumber }) });
      return created;
    });
    res.status(201).json({ settlement });
  } catch (error) { next(error); }
});

app.get('/api/v1/audit-logs', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const createdAt = parseDateRange(req.query as Record<string, unknown>);
    const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
    const entity = typeof req.query.entity === 'string' ? req.query.entity.trim() : '';
    const schoolId = scopedSchoolFromQuery(req);
    const logs = await prisma.auditLog.findMany({
      where: {
        ...(schoolId ? { schoolId } : {}),
        ...(createdAt ? { timestamp: createdAt } : {}),
        ...(action ? { action } : {}),
        ...(userId ? { userId } : {}),
        ...(entity ? { entity } : {})
      },
      include: { user: { select: { email: true, schoolId: true } }, school: { select: { name: true, schoolCode: true } } },
      orderBy: { timestamp: 'desc' },
      take: 500
    });
    res.json({ logs });
  } catch (error) { next(error); }
});

app.get('/api/v1/audit-logs.csv', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    const createdAt = parseDateRange(req.query as Record<string, unknown>);
    const action = typeof req.query.action === 'string' ? req.query.action.trim() : '';
    const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
    const entity = typeof req.query.entity === 'string' ? req.query.entity.trim() : '';
    const schoolId = scopedSchoolFromQuery(req);
    const logs = await prisma.auditLog.findMany({
      where: {
        ...(schoolId ? { schoolId } : {}),
        ...(createdAt ? { timestamp: createdAt } : {}),
        ...(action ? { action } : {}),
        ...(userId ? { userId } : {}),
        ...(entity ? { entity } : {})
      },
      include: { user: { select: { email: true } }, school: { select: { name: true, schoolCode: true } } },
      orderBy: { timestamp: 'desc' },
      take: 1000
    });
    sendCsv(res, 'taazur-audit-logs.csv', [
      ['الوقت', 'الإجراء', 'الكيان', 'معرف الكيان', 'المدرسة', 'المستخدم', 'IP', 'قبل', 'بعد'],
      ...logs.map(log => [log.timestamp.toLocaleString('ar-SA'), log.action, log.entity, log.entityId, log.school ? `${log.school.name} — ${log.school.schoolCode}` : '—', log.user?.email ?? 'النظام', log.ip ?? '—', JSON.stringify(log.oldValue ?? ''), JSON.stringify(log.newValue ?? '')])
    ]);
  } catch (error) { next(error); }
});

app.get('/api/v1/system/status', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR), async (req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const officialAdminEmail = process.env.OFFICIAL_ADMIN_EMAIL?.trim().toLowerCase() ?? '';
    const settings = await getSystemSettings();
    const [
      users,
      schools,
      students,
      canteens,
      transactions,
      activeSessions,
      lockedLogins,
      lockedAttempts,
      demoAccounts,
      officialAdmin,
      openErrors,
      recentErrors,
      lastBackup,
      errorsToday,
      lastPurchase
    ] = await Promise.all([
      prisma.user.count(),
      prisma.school.count({ where: req.claims!.schoolId ? { id: req.claims!.schoolId } : {} }),
      prisma.student.count({ where: req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {} }),
      prisma.canteen.count({ where: req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {} }),
      prisma.walletTransaction.count({ where: req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {} }),
      prisma.userSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      prisma.loginAttempt.count({ where: { lockedUntil: { gt: new Date() } } }),
      prisma.loginAttempt.findMany({ where: { lockedUntil: { gt: new Date() } }, orderBy: { lastAttemptAt: 'desc' }, take: 25 }),
      prisma.user.findMany({ where: { email: { in: demoEmails } }, select: { id: true, email: true, role: true, status: true, createdAt: true } }),
      officialAdminEmail ? prisma.user.findUnique({ where: { email: officialAdminEmail }, select: { id: true, email: true, role: true, status: true } }) : Promise.resolve(null),
      prisma.errorLog.count({ where: { resolvedAt: null } }),
      prisma.errorLog.findMany({ where: req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {}, orderBy: { createdAt: 'desc' }, take: 12 }),
      prisma.auditLog.findFirst({ where: { action: 'SYSTEM_BACKUP_CREATED' }, orderBy: { timestamp: 'desc' }, select: { timestamp: true, newValue: true, user: { select: { email: true } } } }),
      prisma.errorLog.count({ where: { ...(req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {}), createdAt: { gte: startOfToday() } } }),
      prisma.walletTransaction.findFirst({
        where: { ...(req.claims!.schoolId ? { schoolId: req.claims!.schoolId } : {}), type: TransactionType.DEBIT },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, amount: true, reference: true, studentId: true, school: { select: { name: true } } }
      })
    ]);
    const backupAgeHours = lastBackup ? (Date.now() - lastBackup.timestamp.getTime()) / 60 / 60 / 1000 : null;
    const backupAlert = settings.backupReminderEnabled && (!lastBackup || (backupAgeHours ?? 0) > 26)
      ? {
        id: 'BACKUP_MISSING_OR_STALE',
        severity: 'danger',
        title: 'فشل أو تأخر النسخ الاحتياطي اليومي',
        description: lastBackup ? `آخر نسخة مسجلة قبل ${Math.floor(backupAgeHours ?? 0)} ساعة.` : 'لا توجد نسخة احتياطية مسجلة من داخل النظام حتى الآن.',
        href: '/system'
      }
      : null;
    res.json({
      database: { ok: true, provider: 'mysql' },
      services: {
        backend: { ok: true, label: 'متصل', checkedAt: new Date().toISOString() },
        frontend: { ok: true, label: process.env.WEB_ORIGIN ? 'مضبوط' : 'لم يتم ضبط WEB_ORIGIN', url: process.env.WEB_ORIGIN ?? null }
      },
      environment: {
        nodeEnv: process.env.NODE_ENV ?? 'development',
        cookieSecure,
        sessionDurationHours: settings.sessionDurationHours,
        officialAdminEmailConfigured: !!officialAdminEmail,
        webOriginConfigured: !!process.env.WEB_ORIGIN
      },
      counts: { users, schools, students, canteens, transactions, activeSessions, lockedLogins, openErrors, errorsToday },
      lockedAttempts,
      demoAccounts,
      officialAdmin,
      settings,
      recentErrors,
      lastBackup: lastBackup ? { timestamp: lastBackup.timestamp, user: lastBackup.user, summary: lastBackup.newValue } : null,
      backupAlert,
      lastPurchase: lastPurchase ? { ...lastPurchase, amount: asMoney(lastPurchase.amount) } : null,
      recommendations: [
        backupAlert ? 'راجع النسخ الاحتياطي الآن: لم تُسجل نسخة حديثة داخل النظام.' : 'النسخ الاحتياطي اليدوي داخل النظام مسجل حديثًا.',
        'أنشئ نسخة JSON قبل أي تعديل كبير أو قبل استيراد بيانات جديدة.',
        'أبقِ COOKIE_SECURE=true في الإنتاج مع HTTPS.',
        'تأكد أن WEB_ORIGIN يطابق رابط الموقع الرسمي فقط.',
        'جرّب كل تحديث في بيئة Staging قبل اعتماده في Production.'
      ].filter(Boolean)
    });
  } catch (error) { next(error); }
});

const systemSettingsSchema = z.object({
  organizationName: z.string().trim().min(2).max(160).optional(),
  lowBalanceThreshold: z.coerce.number().min(0).max(500).optional(),
  alertsEnabled: z.boolean().optional(),
  backupReminderEnabled: z.boolean().optional(),
  supportEmail: z.string().trim().email().or(z.literal('')).optional(),
  supportPhone: z.string().trim().max(40).optional(),
  cashierRequireStudentPreview: z.boolean().optional(),
  cashierSoundEnabled: z.boolean().optional(),
  sessionDurationHours: z.coerce.number().int().min(1).max(72).optional(),
  reportsDefaultMonth: z.enum(['current', 'previous']).optional()
});

app.get('/api/v1/system/settings', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN, Role.SCHOOL_ADMIN, Role.AUDITOR, Role.CANTEEN_CASHIER, Role.CANTEEN_OPERATOR, Role.CANTEEN_OWNER), async (_req, res, next) => {
  try {
    res.json({ settings: await getSystemSettings() });
  } catch (error) { next(error); }
});

app.patch('/api/v1/system/settings', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN), async (req, res, next) => {
  try {
    const input = systemSettingsSchema.parse(req.body);
    const entries = Object.entries(input).filter(([, value]) => value !== undefined);
    await prisma.$transaction(async tx => {
      for (const [key, value] of entries) {
        await tx.systemSetting.upsert({
          where: { key },
          create: { key, value: cleanJson(value) as Prisma.InputJsonValue, updatedById: req.claims!.sub },
          update: { value: cleanJson(value) as Prisma.InputJsonValue, updatedById: req.claims!.sub }
        });
      }
      await audit(tx, req, { action: 'SYSTEM_SETTINGS_UPDATED', entity: 'SystemSetting', entityId: 'system-settings', newValue: cleanJson(input) });
    });
    res.json({ settings: await getSystemSettings() });
  } catch (error) { next(error); }
});

app.post('/api/v1/system/error-logs/:errorLogId/resolve', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN), async (req, res, next) => {
  try {
    const errorLogId = routeParam(req.params.errorLogId);
    await prisma.$transaction(async tx => {
      const updated = await tx.errorLog.update({ where: { id: errorLogId }, data: { resolvedAt: new Date() } });
      await audit(tx, req, { action: 'ERROR_LOG_RESOLVED', entity: 'ErrorLog', entityId: updated.id, newValue: cleanJson({ requestId: updated.requestId }) });
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/v1/system/unlock-login', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN), async (req, res, next) => {
  try {
    const input = z.object({ email: z.string().trim().email() }).parse(req.body);
    await prisma.$transaction(async tx => {
      await tx.loginAttempt.deleteMany({ where: { email: input.email.toLowerCase() } });
      await audit(tx, req, { action: 'LOGIN_UNLOCKED', entity: 'LoginAttempt', entityId: input.email.toLowerCase(), newValue: cleanJson({ email: input.email.toLowerCase() }) });
    });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.post('/api/v1/system/disable-demo-accounts', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN), async (req, res, next) => {
  try {
    const randomHash = await argon2.hash(randomBytes(48).toString('base64url'));
    const result = await prisma.$transaction(async tx => {
      const accounts = await tx.user.findMany({ where: { email: { in: demoEmails } }, select: { id: true, email: true, status: true } });
      if (!accounts.length) return { count: 0, accounts: [] };
      await tx.user.updateMany({
        where: { id: { in: accounts.map(account => account.id) } },
        data: { status: EntityStatus.INACTIVE, passwordHash: randomHash }
      });
      await audit(tx, req, {
        action: 'DEMO_ACCOUNTS_DISABLED',
        entity: 'User',
        entityId: 'demo-accounts',
        newValue: cleanJson({ emails: accounts.map(account => account.email), count: accounts.length })
      });
      return { count: accounts.length, accounts };
    });
    res.json(result);
  } catch (error) { next(error); }
});

async function buildSystemBackup() {
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
    errorLogs,
    systemSettings
  ] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, email: true, role: true, status: true, schoolId: true, createdAt: true, updatedAt: true } }),
    prisma.school.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.student.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.card.findMany({ orderBy: { issuedAt: 'asc' } }),
    prisma.wallet.findMany(),
    prisma.walletTransaction.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.canteen.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.canteenSettlement.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.auditLog.findMany({ orderBy: { timestamp: 'asc' }, take: 5000 }),
    prisma.errorLog.findMany({ orderBy: { createdAt: 'asc' }, take: 5000 }),
    prisma.systemSetting.findMany({ orderBy: { key: 'asc' } })
  ]);
  const summary = {
    users: users.length,
    schools: schools.length,
    students: students.length,
    cards: cards.length,
    wallets: wallets.length,
    transactions: transactions.length,
    canteens: canteens.length,
    settlements: settlements.length,
    auditLogs: auditLogs.length,
    errorLogs: errorLogs.length,
    systemSettings: systemSettings.length
  };
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    note: 'Taazur operational JSON backup. Password hashes are intentionally excluded.',
    summary,
    data: { users, schools, students, cards, wallets, transactions, canteens, settlements, auditLogs, errorLogs, systemSettings }
  };
}

app.get('/api/v1/system/backup.json', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN), async (req, res, next) => {
  try {
    const backup = await buildSystemBackup();
    await prisma.auditLog.create({
      data: {
        userId: req.claims!.sub,
        schoolId: req.claims!.schoolId,
        action: 'SYSTEM_BACKUP_CREATED',
        entity: 'System',
        entityId: 'backup-json',
        newValue: cleanJson({ exportedAt: backup.exportedAt, summary: backup.summary }),
        ip: requestIp(req),
        userAgent: requestUserAgent(req)
      }
    }).catch(() => undefined);
    res
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="taazur-backup-${new Date().toISOString().slice(0, 10)}.json"`)
      .send(JSON.stringify(backup, null, 2));
  } catch (error) { next(error); }
});

app.post('/api/v1/system/backup-now', auth, roles(Role.SUPER_ADMIN, Role.ASSOCIATION_ADMIN), async (req, res, next) => {
  try {
    const backup = await buildSystemBackup();
    await prisma.auditLog.create({
      data: {
        userId: req.claims!.sub,
        schoolId: req.claims!.schoolId,
        action: 'SYSTEM_BACKUP_CREATED',
        entity: 'System',
        entityId: 'backup-json',
        newValue: cleanJson({ exportedAt: backup.exportedAt, summary: backup.summary, source: 'admin-button' }),
        ip: requestIp(req),
        userAgent: requestUserAgent(req)
      }
    }).catch(() => undefined);
    res.json({ ok: true, exportedAt: backup.exportedAt, summary: backup.summary });
  } catch (error) { next(error); }
});

app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const prismaCode = typeof error === 'object' && error !== null && 'code' in error ? (error as { code?: string }).code : undefined;
  const message = error instanceof z.ZodError ? 'VALIDATION_ERROR' : prismaCode === 'P2002' ? 'DUPLICATE_RECORD' : error instanceof Error ? error.message : 'INTERNAL_ERROR';
  const status = ['FORBIDDEN', 'ORIGIN_DENIED', 'OWNER_CASHIER_DENIED', 'CANTEEN_SCOPE_DENIED'].includes(message) ? 403 : message === 'LOGIN_LOCKED' ? 429 : ['INSUFFICIENT_BALANCE', 'STUDENT_INACTIVE', 'SCHOOL_SCOPE_DENIED', 'DAILY_LIMIT_EXCEEDED', 'REFUND_ONLY_DEBIT', 'CARD_REVOKED', 'CARD_NOT_ACTIVE', 'NO_UNSETTLED_AMOUNT', 'SCHOOL_HAS_ACTIVE_STUDENTS', 'SCHOOL_INACTIVE', 'STUDENT_PREVIEW_REQUIRED'].includes(message) ? 409 : message === 'DUPLICATE_RECORD' ? 409 : ['CARD_NOT_FOUND', 'TRANSACTION_NOT_FOUND'].includes(message) ? 404 : message === 'VALIDATION_ERROR' ? 400 : 500;
  if (status >= 500 || ['ORIGIN_DENIED', 'CARD_REVOKED', 'LOGIN_LOCKED'].includes(message)) {
    prisma.errorLog.create({
      data: {
        requestId: req.requestId ?? randomUUID(),
        method: req.method,
        path: req.originalUrl.slice(0, 300),
        statusCode: status,
        error: message.slice(0, 120),
        message: error instanceof Error ? error.message.slice(0, 500) : undefined,
        userId: req.claims?.sub,
        schoolId: req.claims?.schoolId,
        ip: requestIp(req),
        userAgent: requestUserAgent(req)
      }
    }).catch(() => undefined);
  }
  res.status(status).json({ error: message, requestId: req.requestId });
});
const port = Number(process.env.PORT ?? 4000);
app.listen(port, '0.0.0.0', () => console.log(`API listening on :${port}`));
