import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import nodemailer from 'nodemailer';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { createPostgresDatabase, createSqliteDatabase } from './database.mjs';

const port = Number(process.env.PORT ?? 4000);
const databasePath = resolve(process.env.DATABASE_PATH ?? './data/domus.sqlite');
const uploadsPath = resolve(process.env.UPLOADS_PATH ?? './data/uploads');
const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = String(process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'listing-photos';
const jwtSecret = process.env.DOMUS_JWT_SECRET ?? 'local-development-secret-change-before-deploy';
const adminEmail = String(process.env.DOMUS_ADMIN_EMAIL ?? '').trim().toLowerCase();
const adminPassword = process.env.DOMUS_ADMIN_PASSWORD ?? '';
const adminPasswordSalt = randomBytes(16).toString('hex');
const adminPasswordHash = adminPassword
  ? scryptSync(adminPassword, adminPasswordSalt, 64).toString('hex')
  : null;
const allowedOrigin = process.env.CORS_ORIGIN ?? '*';
const isProduction = process.env.NODE_ENV === 'production';
const requireEmailVerification = isProduction || process.env.DOMUS_REQUIRE_EMAIL_VERIFICATION === 'true';
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 587);
const smtpUser = process.env.SMTP_USER;
const smtpPassword = process.env.SMTP_PASSWORD;
const smtpFrom = process.env.SMTP_FROM;
const firebaseServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
let firebaseServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
if (!firebaseServiceAccountJson && firebaseServiceAccountPath) {
  try {
    firebaseServiceAccountJson = readFileSync(resolve(firebaseServiceAccountPath), 'utf8');
  } catch {
    if (isProduction) {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH must point to a readable service-account JSON file.');
    }
    console.error('Firebase service-account file could not be read; FCM delivery is unavailable.');
  }
}
const mailConfigured = Boolean(
  smtpHost && Number.isInteger(smtpPort) && smtpPort >= 1 && smtpPort <= 65535
  && smtpUser && smtpPassword && smtpFrom,
);
let mailer;
let firebaseMessaging;

if (isProduction) {
  if (!process.env.DOMUS_JWT_SECRET || jwtSecret.length < 32) {
    throw new Error('Set DOMUS_JWT_SECRET to a random value of at least 32 characters in production.');
  }
  if (!databaseUrl) {
    throw new Error('Set DATABASE_URL to the Supabase PostgreSQL connection string in production.');
  }
  if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseBucket) {
    throw new Error('Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_STORAGE_BUCKET in production.');
  }
  let validSupabaseUrl = false;
  try {
    const parsedUrl = new URL(supabaseUrl);
    validSupabaseUrl = parsedUrl.protocol === 'https:' && parsedUrl.origin === supabaseUrl;
  } catch {
    validSupabaseUrl = false;
  }
  if (!validSupabaseUrl) throw new Error('SUPABASE_URL must be an HTTPS project origin.');
  if (!process.env.CORS_ORIGIN || allowedOrigin === '*') {
    throw new Error('Set CORS_ORIGIN to your app origin in production.');
  }
  if (!mailConfigured) {
    throw new Error('Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM in production.');
  }
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)
    || adminPassword.length < 12
  ) {
    throw new Error('Set DOMUS_ADMIN_EMAIL and a DOMUS_ADMIN_PASSWORD of at least 12 characters in production.');
  }
}
if (mailConfigured) {
  mailer = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: smtpUser, pass: smtpPassword },
  });
}
if (firebaseServiceAccountJson) {
  try {
    const serviceAccount = JSON.parse(firebaseServiceAccountJson);
    if (!getApps().length) initializeApp({ credential: cert(serviceAccount) });
    firebaseMessaging = getMessaging();
  } catch {
    if (isProduction) throw new Error('Firebase service-account configuration is not valid.');
    console.error('Firebase Admin initialization failed; FCM delivery is unavailable.');
  }
}

function imageType(bytes, mimeType) {
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  const webp = bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (mimeType === 'image/jpeg' && jpeg) return 'jpg';
  if (mimeType === 'image/png' && png) return 'png';
  if (mimeType === 'image/webp' && webp) return 'webp';
  return null;
}

function referencedUploadFilenames(rows) {
  const filenames = new Set();
  for (const row of rows) {
    const urls = [row.image_url, ...JSON.parse(row.photos ?? '[]')];
    for (const value of urls) {
      if (typeof value !== 'string') continue;
      let pathname;
      try {
        pathname = new URL(value, 'http://domus.local').pathname;
      } catch {
        continue;
      }
      const localMatch = pathname.match(/^\/uploads\/([a-f0-9-]{36}\.(?:jpg|png|webp))$/);
      const storageMatch = pathname.match(new RegExp(
        `/storage/v1/object/public/${supabaseBucket}/([a-f0-9-]{36}\\.(?:jpg|png|webp))$`,
      ));
      if (localMatch) filenames.add(localMatch[1]);
      if (storageMatch) filenames.add(storageMatch[1]);
    }
  }
  return filenames;
}

async function pruneUnreferencedUploads(candidates) {
  if (!candidates.size) return;
  const referenced = referencedUploadFilenames(
    await db.prepare('SELECT image_url, photos FROM properties').all(),
  );
  const unreferenced = [...candidates].filter((filename) => !referenced.has(filename));
  if (isProduction && unreferenced.length) {
    const result = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseBucket)}`, {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${supabaseServiceRoleKey}`,
        apikey: supabaseServiceRoleKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prefixes: unreferenced }),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) throw new Error(`Supabase Storage deletion failed with status ${result.status}.`);
    return;
  }
  for (const filename of unreferenced) {
    try {
      unlinkSync(resolve(uploadsPath, filename));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function uploadImage(filename, bytes, mimeType) {
  if (!isProduction) {
    writeFileSync(resolve(uploadsPath, filename), bytes, { flag: 'wx' });
    return `/uploads/${filename}`;
  }
  const result = await fetch(
    `${supabaseUrl}/storage/v1/object/${encodeURIComponent(supabaseBucket)}/${filename}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${supabaseServiceRoleKey}`,
        apikey: supabaseServiceRoleKey,
        'content-type': mimeType,
        'x-upsert': 'false',
      },
      body: bytes,
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!result.ok) throw new Error(`Supabase Storage upload failed with status ${result.status}.`);
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(supabaseBucket)}/${filename}`;
}

const db = isProduction ? createPostgresDatabase(databaseUrl) : createSqliteDatabase(databasePath);
const authAttempts = new Map();
const limitedRequests = new Map();
if (isProduction) {
  await db.exec(readFileSync(new URL('./schema.postgres.sql', import.meta.url), 'utf8'));
} else {
  mkdirSync(dirname(databasePath), { recursive: true });
  mkdirSync(uploadsPath, { recursive: true });
  await db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    email_verified INTEGER NOT NULL DEFAULT 1,
    phone TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    about TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    banned_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS properties (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price INTEGER NOT NULL CHECK (price > 0),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('Vente', 'Location')),
    type TEXT NOT NULL,
    city TEXT NOT NULL,
    neighborhood TEXT NOT NULL DEFAULT '',
    surface REAL NOT NULL DEFAULT 0,
    bedrooms INTEGER NOT NULL DEFAULT 0,
    bathrooms INTEGER NOT NULL DEFAULT 0,
    latitude REAL,
    longitude REAL,
    features TEXT NOT NULL DEFAULT '[]',
    image_url TEXT NOT NULL DEFAULT '',
    photos TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'paused', 'draft', 'archived')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, property_id)
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (property_id, buyer_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose ON auth_tokens(user_id, purpose);
  CREATE TABLE IF NOT EXISTS device_tokens (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('fcm', 'expo')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, token)
  );
  CREATE TABLE IF NOT EXISTS property_reports (
    id INTEGER PRIMARY KEY,
    property_id INTEGER NOT NULL,
    reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (property_id, reporter_id)
  );
  CREATE INDEX IF NOT EXISTS property_reports_status_created
    ON property_reports(status, created_at DESC);
`);
const propertyColumnNames = new Set(
  db.prepare('PRAGMA table_info(properties)').all().map((column) => column.name),
);
if (!propertyColumnNames.has('latitude')) await db.exec('ALTER TABLE properties ADD COLUMN latitude REAL');
if (!propertyColumnNames.has('longitude')) await db.exec('ALTER TABLE properties ADD COLUMN longitude REAL');
const userColumnsPresent = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
if (!userColumnsPresent.includes('email_verified')) {
  await db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1');
}
if (!userColumnsPresent.includes('banned_at')) {
  await db.exec('ALTER TABLE users ADD COLUMN banned_at TEXT');
}
const propertyColumnsPresent = db.prepare('PRAGMA table_info(properties)').all().map((column) => column.name);
if (!propertyColumnsPresent.includes('photos')) {
  await db.exec("ALTER TABLE properties ADD COLUMN photos TEXT NOT NULL DEFAULT '[]'");
}
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}

async function seed() {
  const count = Number((await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count);
  if (count > 0) return;
  const demo = hashPassword('Domus2026');
  const ownerResult = await db.prepare(
    'INSERT INTO users (name, email, phone, city, about, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('Sami Ben Ali', 'sami@domus.tn', '+216 20 123 456', 'La Marsa', 'Particulier à La Marsa.', demo.hash, demo.salt);
  const ownerId = Number(ownerResult.lastInsertRowid);
  const buyer = hashPassword('Domus2026');
  await db.prepare(
    'INSERT INTO users (name, email, phone, city, about, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('Eya Chihi', 'demo@domus.tn', '+216 20 123 456', 'Tunis', 'À la recherche de votre prochain chez-vous.', buyer.hash, buyer.salt);
  const insertProperty = db.prepare(`
    INSERT INTO properties
      (owner_id, title, description, price, transaction_type, type, city, neighborhood, surface, bedrooms, bathrooms, features, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  await insertProperty.run(ownerId, 'Appartement S+2 avec terrasse', 'Appartement lumineux avec terrasse, séjour spacieux et cuisine équipée. Dans un quartier calme, proche des commerces et de la plage.', 385000, 'Vente', 'Appartement', 'La Marsa', 'La Marsa Plage', 85, 2, 1, JSON.stringify(['Terrasse', 'Climatisation', 'Parking']), 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=85');
  await insertProperty.run(ownerId, 'Villa avec jardin', 'Villa lumineuse avec jardin arboré, terrasse et stationnement privé.', 445000, 'Vente', 'Villa', 'Carthage', 'Carthage', 160, 3, 2, JSON.stringify(['Jardin', 'Terrasse', 'Parking']), 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=85');
  await insertProperty.run(ownerId, 'Studio meublé', 'Studio meublé, proche des commerces et des transports.', 1200, 'Location', 'Appartement', 'Tunis', 'Lac 2', 42, 1, 1, JSON.stringify(['Meublé', 'Climatisation']), 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=85');
  await insertProperty.run(ownerId, 'Terrain 400 m²', 'Terrain constructible dans un quartier calme.', 210000, 'Vente', 'Terrain', 'Hammamet', 'Hammamet Nord', 400, 0, 0, JSON.stringify([]), 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=85');
  await db.prepare('INSERT INTO favorites (user_id, property_id) VALUES (?, ?)').run(2, 2);
}
if (!isProduction) await seed();

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function tokenFor(subject, role = 'user') {
  const payload = Buffer.from(JSON.stringify({
    sub: subject,
    role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
  })).toString('base64url');
  const signature = createHmac('sha256', jwtSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

async function userFromToken(request) {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer ')) return null;
  const [payload, signature] = value.slice(7).split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', jwtSecret).update(payload).digest();
  let claims;
  try {
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }
  if (claims.exp <= Date.now() / 1000) return null;
  if (
    claims.role === 'admin'
    && claims.sub === 'admin'
    && adminPasswordHash
  ) {
    return {
      id: 'admin',
      name: 'Administration Domus',
      email: adminEmail,
      phone: '',
      city: '',
      about: '',
      role: 'admin',
    };
  }
  if (claims.role && claims.role !== 'user') return null;
  const account = await db.prepare(`
    SELECT id, name, email, phone, city, about, banned_at
    FROM users WHERE id = ?
  `).get(claims.sub);
  if (!account) return null;
  if (account.banned_at) {
    return { id: account.id, role: 'banned', bannedAt: account.banned_at };
  }
  const { banned_at: _, ...safeAccount } = account;
  return { ...safeAccount, role: 'user' };
}

async function bodyOf(request, maxBytes = 1024 * 1024) {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (contentLength > maxBytes) throw new Error('Request body is too large.');
  let content = '';
  for await (const chunk of request) {
    content += chunk;
    if (content.length > maxBytes) throw new Error('Request body is too large.');
  }
  if (!content) return {};
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

const publicProperty = (row) => ({
  ...row,
  features: JSON.parse(row.features),
  photos: JSON.parse(row.photos ?? '[]'),
  favorite: Boolean(row.favorite),
});
const propertyColumns = `
  p.id, p.title, p.description, p.price, p.transaction_type AS "transaction", p.type, p.city,
  p.neighborhood, p.surface, p.bedrooms, p.bathrooms, p.latitude, p.longitude, p.features, p.photos,
  p.image_url AS imageUrl, p.status, p.created_at AS createdAt,
  u.id AS ownerId, u.name AS ownerName, u.phone AS ownerPhone
`;
const propertySelect = `SELECT ${propertyColumns}, EXISTS (
  SELECT 1 FROM favorites f WHERE f.property_id = p.id AND f.user_id = ?
) AS favorite FROM properties p JOIN users u ON u.id = p.owner_id`;

function requireUser(user) {
  if (user?.role === 'banned') {
    const error = new Error('Votre compte a été définitivement banni.');
    error.status = 403;
    throw error;
  }
  if (!user || user.role === 'admin') {
    const error = new Error('Connectez-vous pour continuer.');
    error.status = 401;
    throw error;
  }
  return user;
}

function requireAdmin(user) {
  if (user?.role !== 'admin') {
    const error = new Error('Accès administrateur requis.');
    error.status = 403;
    throw error;
  }
  return user;
}

function isUniqueConstraint(error) {
  return error?.errcode === 2067
    || error?.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE'
    || error?.code === '23505';
}

function allowAuthAttempt(request) {
  const now = Date.now();
  const address = request.socket.remoteAddress ?? 'unknown';
  const entry = authAttempts.get(address);
  if (!entry || now >= entry.resetAt) {
    authAttempts.set(address, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return true;
  }
  if (entry.count >= 20) return false;
  entry.count += 1;
  return true;
}

function allowLimitedRequest(request, bucket, limit, windowMs = 15 * 60 * 1000) {
  const key = `${bucket}:${request.socket.remoteAddress ?? 'unknown'}`;
  const now = Date.now();
  const entry = limitedRequests.get(key);
  if (!entry || now >= entry.resetAt) {
    limitedRequests.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

async function createAuthToken(userId, purpose) {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (purpose === 'verify_email' ? 30 : 60) * 60 * 1000;
  await db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
  await db.prepare('INSERT INTO auth_tokens (token_hash, user_id, purpose, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
    createHash('sha256').update(token).digest('hex'), userId, purpose, expiresAt, Date.now(),
  );
  return token;
}

async function sendAuthEmail(email, token, purpose) {
  if (!mailer) return;
  const verify = purpose === 'verify_email';
  await mailer.sendMail({
    from: smtpFrom,
    to: email,
    subject: verify ? 'Verify your Domus email' : 'Reset your Domus password',
    text: `${verify ? 'Verify your email address' : 'Reset your password'} using this one-time code:\n\n${token}\n\nThis code expires in ${verify ? '30 minutes' : '60 minutes'}.`,
  });
}

async function consumeAuthToken(token, purpose) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const hash = createHash('sha256').update(token).digest('hex');
  await db.exec('BEGIN IMMEDIATE');
  try {
    const stored = await db.prepare(`
      SELECT token_hash, user_id FROM auth_tokens
      WHERE token_hash = ? AND purpose = ? AND expires_at > ?
    `).get(hash, purpose, Date.now());
    if (!stored) {
      await db.exec('ROLLBACK');
      return null;
    }
    await db.prepare('DELETE FROM auth_tokens WHERE token_hash = ?').run(hash);
    await db.exec('COMMIT');
    return stored;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

function logDeliveryError(provider, error) {
  const rawCode = String(error?.code ?? error?.statusCode ?? error?.status ?? 'unknown');
  const code = /^[A-Za-z0-9_.-]{1,40}$/.test(rawCode) ? rawCode : 'provider_error';
  console.error(`${provider} delivery failed (code: ${code}).`);
}

async function sendPushNotifications(userId, title, body) {
  let devices;
  try {
    devices = await db.prepare('SELECT token, platform FROM device_tokens WHERE user_id = ?').all(userId);
  } catch (error) {
    logDeliveryError('Push', error);
    return;
  }
  await Promise.all(devices.map(async ({ token, platform }) => {
    try {
      if (platform === 'fcm') {
        if (!firebaseMessaging) throw Object.assign(new Error('Firebase is not configured.'), { code: 'not_configured' });
        await firebaseMessaging.send({ token, notification: { title, body } });
        return;
      }
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ to: token, title, body, sound: 'default' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw Object.assign(new Error('Expo rejected push request.'), { status: response.status });
      const result = await response.json();
      const ticket = Array.isArray(result.data) ? result.data[0] : result.data;
      if (ticket?.status === 'error') {
        throw Object.assign(new Error('Expo rejected push ticket.'), { code: ticket.details?.error ?? 'expo_error' });
      }
    } catch (error) {
      logDeliveryError(platform === 'fcm' ? 'FCM' : 'Expo', error);
    }
  }));
}

function propertyInput(input) {
  const price = Number(input.price);
  const surface = Number(input.surface ?? 0);
  const bedrooms = Number(input.bedrooms ?? 0);
  const bathrooms = Number(input.bathrooms ?? 0);
  const hasLatitude = input.latitude !== undefined && input.latitude !== null && input.latitude !== '';
  const hasLongitude = input.longitude !== undefined && input.longitude !== null && input.longitude !== '';
  const latitude = hasLatitude ? Number(input.latitude) : null;
  const longitude = hasLongitude ? Number(input.longitude) : null;
  const title = String(input.title ?? '').trim();
  const city = String(input.city ?? '').trim();
  if (
    title.length < 5 || !city || !Number.isFinite(price) || price <= 0
    || !Number.isFinite(surface) || surface < 0
    || !Number.isFinite(bedrooms) || bedrooms < 0
    || !Number.isFinite(bathrooms) || bathrooms < 0
    || hasLatitude !== hasLongitude
    || (hasLatitude && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90))
    || (hasLongitude && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))
  ) {
    const error = new Error('Titre, ville, prix positif et surface valide sont obligatoires.');
    error.status = 400;
    throw error;
  }
  const transaction = input.transaction === 'Location' ? 'Location' : 'Vente';
  const features = Array.isArray(input.features) ? input.features.map(String).slice(0, 20) : [];
  const photos = Array.isArray(input.photos) ? input.photos.map(String).filter(Boolean).slice(0, 10) : [];
  const imageUrl = String(input.imageUrl ?? photos[0] ?? '').slice(0, 1000);
  const imageUrls = photos.length ? photos : imageUrl ? [imageUrl] : [];
  if (imageUrls.some((value) => {
    try {
      return !['http:', 'https:'].includes(new URL(value, 'http://domus.local').protocol);
    } catch {
      return true;
    }
  })) {
    const error = new Error('Les photos doivent utiliser une adresse HTTP ou HTTPS valide.');
    error.status = 400;
    throw error;
  }
  return {
    title, city, price, surface, bedrooms: Math.max(0, Math.floor(bedrooms)),
    bathrooms: Math.max(0, Math.floor(bathrooms)),
    description: String(input.description ?? '').slice(0, 4000),
    transaction, type: String(input.type ?? 'Appartement').slice(0, 40),
    neighborhood: String(input.neighborhood ?? '').slice(0, 120), features,
    latitude, longitude,
    imageUrl, photos: photos.length ? photos : imageUrl ? [imageUrl] : [],
  };
}

async function handle(request, response) {
  if (request.method === 'OPTIONS') {
    json(response, 204, {});
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  let user;
  try {
    user = await userFromToken(request);
    if (request.method === 'GET' && path === '/health') {
      json(response, 200, { ok: true, service: 'domus-api' });
      return;
    }

    if (request.method === 'POST' && path === '/uploads') {
      requireUser(user);
      const input = await bodyOf(request, 4 * 1024 * 1024);
      const mimeType = String(input.mimeType ?? '');
      const encoded = String(input.base64 ?? '');
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
        json(response, 400, { error: 'Le fichier image est invalide.' });
        return;
      }
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length > 3 * 1024 * 1024) {
        json(response, 413, { error: 'La photo doit faire moins de 3 Mo.' });
        return;
      }
      const extension = imageType(bytes, mimeType);
      if (!extension) {
        json(response, 400, { error: 'Formats acceptés : JPEG, PNG et WebP.' });
        return;
      }
      const filename = `${randomUUID()}.${extension}`;
      const imageUrl = await uploadImage(filename, bytes, mimeType);
      json(response, 201, { url: imageUrl });
      return;
    }

    const uploadMatch = path.match(/^\/uploads\/([a-f0-9-]{36})\.(jpg|png|webp)$/);
    if (request.method === 'GET' && uploadMatch) {
      const filename = `${uploadMatch[1]}.${uploadMatch[2]}`;
      try {
        const bytes = readFileSync(resolve(uploadsPath, filename));
        response.writeHead(200, {
          'content-type': uploadMatch[2] === 'jpg' ? 'image/jpeg' : `image/${uploadMatch[2]}`,
          'cache-control': 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
          'access-control-allow-origin': allowedOrigin,
        });
        response.end(bytes);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        json(response, 404, { error: 'Photo introuvable.' });
      }
      return;
    }

    if (
      request.method === 'POST'
      && ['/auth/register', '/auth/login', '/auth/resend-verification', '/admin/login'].includes(path)
      && !allowAuthAttempt(request)
    ) {
      json(response, 429, { error: 'Trop de tentatives. Veuillez réessayer dans quelques minutes.' });
      return;
    }

    if (
      request.method === 'POST'
      && ['/auth/register', '/auth/verify-email', '/auth/resend-verification'].includes(path)
      && !allowLimitedRequest(request, path, path === '/auth/register' ? 5 : 8)
    ) {
      json(response, 429, { error: 'Trop de tentatives. Veuillez réessayer dans quelques minutes.' });
      return;
    }

    if (request.method === 'POST' && path === '/auth/register') {
      const input = await bodyOf(request);
      const name = String(input.name ?? '').trim();
      const email = String(input.email ?? '').trim().toLowerCase();
      const password = String(input.password ?? '');
      if (adminEmail && email === adminEmail) {
        json(response, 409, { error: 'Cette adresse e-mail est réservée.' });
        return;
      }
      if (input.acceptedTerms !== true) {
        json(response, 400, { error: 'Veuillez accepter les conditions d’utilisation et la politique de confidentialité.' });
        return;
      }
      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || !/\d/.test(password)) {
        json(response, 400, { error: 'Saisissez un nom, un e-mail valide et un mot de passe de 8 caractères minimum avec un chiffre.' });
        return;
      }
      const credentials = hashPassword(password);
      try {
        const result = await db.prepare(`
          INSERT INTO users (name, email, phone, password_hash, password_salt, email_verified)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          name.slice(0, 100), email, String(input.phone ?? '').slice(0, 40),
          credentials.hash, credentials.salt, requireEmailVerification ? 0 : 1,
        );
        const account = await db.prepare('SELECT id, name, email, phone, city, about FROM users WHERE id = ?').get(result.lastInsertRowid);
        if (requireEmailVerification) {
          const verificationToken = await createAuthToken(account.id, 'verify_email');
          sendAuthEmail(account.email, verificationToken, 'verify_email').catch((error) => {
            logDeliveryError('SMTP email', error);
          });
          json(response, 201, { verificationRequired: true, user: account });
        } else {
          json(response, 201, { token: tokenFor(account.id), user: account });
        }
      } catch (error) {
        if (isUniqueConstraint(error)) {
          json(response, 409, { error: 'Cette adresse e-mail est déjà utilisée.' });
          return;
        }
        throw error;
      }
      return;
    }

    if (request.method === 'POST' && path === '/auth/resend-verification') {
      const input = await bodyOf(request);
      const email = String(input.email ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        json(response, 400, { error: 'Saisissez une adresse e-mail valide.' });
        return;
      }
      const account = await db.prepare(
        'SELECT id FROM users WHERE email = ? AND email_verified = 0',
      ).get(email);
      if (account) {
        const verificationToken = await createAuthToken(account.id, 'verify_email');
        sendAuthEmail(email, verificationToken, 'verify_email').catch((error) => {
          logDeliveryError('SMTP email', error);
        });
      }
      json(response, 200, {
        message: 'Si un compte correspondant peut être vérifié, un courriel de confirmation a été envoyé.',
      });
      return;
    }

    if (request.method === 'POST' && path === '/auth/verify-email') {
      const input = await bodyOf(request);
      const consumed = await consumeAuthToken(input.token, 'verify_email');
      if (!consumed) {
        json(response, 400, { error: 'Code de vérification invalide ou expiré.' });
        return;
      }
      await db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(consumed.user_id);
      json(response, 200, { verified: true });
      return;
    }

    if (request.method === 'POST' && path === '/admin/login') {
      if (!adminPasswordHash) {
        json(response, 503, { error: 'L’accès administrateur n’est pas configuré.' });
        return;
      }
      const input = await bodyOf(request);
      const email = String(input.email ?? '').trim().toLowerCase();
      const password = String(input.password ?? '');
      const candidate = scryptSync(password, adminPasswordSalt, 64);
      const expected = Buffer.from(adminPasswordHash, 'hex');
      if (
        email !== adminEmail
        || candidate.length !== expected.length
        || !timingSafeEqual(candidate, expected)
      ) {
        json(response, 401, { error: 'Adresse e-mail ou mot de passe incorrect.' });
        return;
      }
      json(response, 200, {
        token: tokenFor('admin', 'admin'),
        admin: { email: adminEmail },
      });
      return;
    }

    if (request.method === 'POST' && path === '/auth/login') {
      const input = await bodyOf(request);
      const email = String(input.email ?? '').trim().toLowerCase();
      const password = String(input.password ?? '');
      if (adminPasswordHash && email === adminEmail) {
        const candidate = scryptSync(password, adminPasswordSalt, 64);
        const expected = Buffer.from(adminPasswordHash, 'hex');
        if (
          candidate.length !== expected.length
          || !timingSafeEqual(candidate, expected)
        ) {
          json(response, 401, { error: 'Adresse e-mail ou mot de passe incorrect.' });
          return;
        }
        json(response, 200, {
          token: tokenFor('admin', 'admin'),
          user: {
            id: 'admin',
            name: 'Administration Domus',
            email: adminEmail,
            phone: '',
            city: '',
            about: '',
            role: 'admin',
          },
        });
        return;
      }
      const account = await db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
      const candidate = account ? hashPassword(password, account.password_salt).hash : '0'.repeat(128);
      const valid = account && timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(account.password_hash, 'hex'));
      if (!valid) {
        json(response, 401, { error: 'Adresse e-mail ou mot de passe incorrect.' });
        return;
      }
      if (account.banned_at) {
        json(response, 403, { error: 'Votre compte a été définitivement banni.' });
        return;
      }
      if (requireEmailVerification && !account.email_verified) {
        json(response, 403, {
          code: 'email_verification_required',
          error: 'Veuillez vérifier votre adresse e-mail avant de vous connecter.',
        });
        return;
      }
      const safeUser = await db.prepare('SELECT id, name, email, phone, city, about FROM users WHERE id = ?').get(account.id);
      json(response, 200, { token: tokenFor(account.id, 'user'), user: safeUser });
      return;
    }

    if (request.method === 'POST' && path === '/devices') {
      const account = requireUser(user);
      if (!allowLimitedRequest(request, 'device-registration', 30)) {
        json(response, 429, { error: 'Trop de tentatives. Veuillez réessayer dans quelques minutes.' });
        return;
      }
      const input = await bodyOf(request);
      const token = typeof input.token === 'string' ? input.token.trim() : '';
      const platform = input.platform;
      const validToken = token.length <= 4096 && (
        (platform === 'expo' && /^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,256}\]$/.test(token))
        || (platform === 'fcm' && /^[A-Za-z0-9:_-]{20,4096}$/.test(token))
      );
      if (!validToken) {
        json(response, 400, { error: 'Jeton ou plateforme de notification invalide.' });
        return;
      }
      await db.prepare(`
        INSERT INTO device_tokens (user_id, token, platform) VALUES (?, ?, ?)
        ON CONFLICT(user_id, token) DO UPDATE SET platform = excluded.platform
      `).run(account.id, token, platform);
      json(response, 201, { registered: true });
      return;
    }

    const deviceMatch = path.match(/^\/devices\/(.+)$/);
    if (request.method === 'DELETE' && deviceMatch) {
      const account = requireUser(user);
      if (!allowLimitedRequest(request, 'device-registration', 30)) {
        json(response, 429, { error: 'Trop de tentatives. Veuillez réessayer dans quelques minutes.' });
        return;
      }
      let token;
      try {
        token = decodeURIComponent(deviceMatch[1]);
      } catch {
        json(response, 400, { error: 'Jeton de notification invalide.' });
        return;
      }
      if (!token || token.length > 4096) {
        json(response, 400, { error: 'Jeton de notification invalide.' });
        return;
      }
      const removed = await db.prepare('DELETE FROM device_tokens WHERE user_id = ? AND token = ?').run(account.id, token);
      json(response, 200, { deleted: Boolean(removed.changes) });
      return;
    }

    if (request.method === 'GET' && path === '/auth/me') {
      if (user?.role === 'banned') {
        json(response, 403, { error: 'Votre compte a été définitivement banni.' });
      } else {
        json(response, user ? 200 : 401, user ?? { error: 'Session invalide.' });
      }
      return;
    }

    if (path.startsWith('/admin/')) {
      const admin = requireAdmin(user);
      if (request.method === 'GET' && path === '/admin/users') {
        const users = await db.prepare(`
          SELECT u.id, u.name, u.email, u.email_verified AS emailVerified,
            u.phone, u.city, u.about, u.banned_at AS bannedAt, u.created_at AS createdAt,
            (SELECT COUNT(*) FROM properties p WHERE p.owner_id = u.id) AS listingCount
          FROM users u ORDER BY u.created_at DESC, u.id DESC LIMIT 500
        `).all();
        json(response, 200, { items: users });
        return;
      }

      const adminUserMatch = path.match(/^\/admin\/users\/(\d+)$/);
      if (request.method === 'DELETE' && adminUserMatch) {
        const targetId = Number(adminUserMatch[1]);
        const result = await db.prepare(`
          UPDATE users SET banned_at = COALESCE(banned_at, CURRENT_TIMESTAMP)
          WHERE id = ?
        `).run(targetId);
        if (!result.changes) {
          json(response, 404, { error: 'Utilisateur introuvable.' });
          return;
        }
        await db.prepare("UPDATE properties SET status = 'archived' WHERE owner_id = ?").run(targetId);
        await db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(targetId);
        await db.prepare('DELETE FROM device_tokens WHERE user_id = ?').run(targetId);
        json(response, 200, {
          banned: true,
          message: 'Le compte a été définitivement banni.',
        });
        return;
      }

      if (request.method === 'GET' && path === '/admin/properties') {
        const rows = await db.prepare(`
          ${propertySelect} ORDER BY p.created_at DESC, p.id DESC LIMIT 500
        `).all(0);
        json(response, 200, { items: rows.map(publicProperty) });
        return;
      }

      const adminPropertyMatch = path.match(/^\/admin\/properties\/(\d+)$/);
      if (request.method === 'DELETE' && adminPropertyMatch) {
        const propertyId = Number(adminPropertyMatch[1]);
        const previous = await db.prepare(
          'SELECT image_url, photos FROM properties WHERE id = ?',
        ).get(propertyId);
        if (!previous) {
          json(response, 404, { error: 'Annonce introuvable.' });
          return;
        }
        await db.prepare('DELETE FROM properties WHERE id = ?').run(propertyId);
        await pruneUnreferencedUploads(referencedUploadFilenames([previous]));
        json(response, 200, { deleted: true });
        return;
      }

      if (request.method === 'GET' && path === '/admin/reports') {
        const reports = await db.prepare(`
          SELECT r.id, r.property_id AS propertyId, r.reporter_id AS reporterId,
            r.reason, r.status, r.created_at AS createdAt,
            reporter.name AS reporterName, reporter.email AS reporterEmail,
            p.title AS propertyTitle, p.city AS propertyCity, p.status AS propertyStatus,
            owner.name AS ownerName, owner.email AS ownerEmail
          FROM property_reports r
          JOIN users reporter ON reporter.id = r.reporter_id
          LEFT JOIN properties p ON p.id = r.property_id
          LEFT JOIN users owner ON owner.id = p.owner_id
          ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
          LIMIT 500
        `).all();
        json(response, 200, { items: reports });
        return;
      }

      const reportMatch = path.match(/^\/admin\/reports\/(\d+)$/);
      if (request.method === 'PATCH' && reportMatch) {
        const input = await bodyOf(request);
        if (!['resolved', 'rejected'].includes(input.status)) {
          json(response, 400, { error: 'Statut de signalement non valide.' });
          return;
        }
        const result = await db.prepare(
          'UPDATE property_reports SET status = ? WHERE id = ?',
        ).run(input.status, Number(reportMatch[1]));
        json(response, result.changes ? 200 : 404, result.changes
          ? { status: input.status }
          : { error: 'Signalement introuvable.' });
        return;
      }

      json(response, 404, { error: 'Route administrateur introuvable.' });
      return;
    }

    if (request.method === 'GET' && path === '/properties') {
      const filters = [];
      const values = [user?.id ?? 0];
      filters.push("p.status = 'online'");
      for (const [parameter, column, convert] of [
        ['transaction', 'p.transaction_type', String], ['type', 'p.type', String],
        ['city', 'p.city', String], ['minPrice', 'p.price >=', Number],
        ['maxPrice', 'p.price <=', Number], ['bedrooms', 'p.bedrooms >=', Number],
      ]) {
        const raw = url.searchParams.get(parameter);
        if (raw !== null && raw !== '') {
          const value = convert(raw);
          if (typeof value === 'number' && !Number.isFinite(value)) continue;
          if (parameter === 'city' || parameter === 'transaction' || parameter === 'type') {
            filters.push(`${column} LIKE ?`);
            values.push(`%${value}%`);
          } else {
            filters.push(`${column} ?`);
            values.push(value);
          }
        }
      }
      const query = url.searchParams.get('q')?.trim();
      if (query) {
        filters.push('(p.title LIKE ? OR p.city LIKE ? OR p.neighborhood LIKE ?)');
        values.push(`%${query}%`, `%${query}%`, `%${query}%`);
      }
      const rows = await db.prepare(`${propertySelect} WHERE ${filters.join(' AND ')} ORDER BY p.created_at DESC, p.id DESC LIMIT 100`).all(...values);
      json(response, 200, { items: rows.map(publicProperty), total: rows.length });
      return;
    }

    if (request.method === 'GET' && path === '/favorites') {
      const account = requireUser(user);
      const rows = await db.prepare(`${propertySelect} JOIN favorites own ON own.property_id = p.id AND own.user_id = ? WHERE p.status = 'online' ORDER BY own.created_at DESC`).all(account.id, account.id);
      json(response, 200, { items: rows.map(publicProperty) });
      return;
    }

    const favoriteMatch = path.match(/^\/favorites\/(\d+)$/);
    if (favoriteMatch && ['PUT', 'DELETE'].includes(request.method)) {
      const account = requireUser(user);
      const propertyId = Number(favoriteMatch[1]);
      if (request.method === 'PUT') {
        await db.prepare('INSERT OR IGNORE INTO favorites (user_id, property_id) VALUES (?, ?)').run(account.id, propertyId);
      } else {
        await db.prepare('DELETE FROM favorites WHERE user_id = ? AND property_id = ?').run(account.id, propertyId);
      }
      json(response, 200, { favorite: request.method === 'PUT' });
      return;
    }

    const propertyMatch = path.match(/^\/properties\/(\d+)$/);
    if (request.method === 'GET' && propertyMatch) {
      const row = await db.prepare(`${propertySelect} WHERE p.id = ? AND p.status = 'online'`).get(user?.id ?? 0, Number(propertyMatch[1]));
      json(response, row ? 200 : 404, row ? publicProperty(row) : { error: 'Annonce introuvable.' });
      return;
    }

    const reportPropertyMatch = path.match(/^\/properties\/(\d+)\/reports$/);
    if (request.method === 'POST' && reportPropertyMatch) {
      const account = requireUser(user);
      const propertyId = Number(reportPropertyMatch[1]);
      const property = await db.prepare(
        "SELECT id, owner_id FROM properties WHERE id = ? AND status = 'online'",
      ).get(propertyId);
      if (!property) {
        json(response, 404, { error: 'Annonce introuvable.' });
        return;
      }
      if (property.owner_id === account.id) {
        json(response, 400, { error: 'Vous ne pouvez pas signaler votre propre annonce.' });
        return;
      }
      const input = await bodyOf(request);
      const reason = String(input.reason ?? '').trim();
      if (reason.length < 5 || reason.length > 1000) {
        json(response, 400, { error: 'Le motif doit contenir entre 5 et 1000 caractères.' });
        return;
      }
      try {
        const report = await db.prepare(`
          INSERT INTO property_reports (property_id, reporter_id, reason)
          VALUES (?, ?, ?)
        `).run(propertyId, account.id, reason);
        json(response, 201, { id: Number(report.lastInsertRowid), submitted: true });
      } catch (error) {
        if (isUniqueConstraint(error)) {
          json(response, 409, { error: 'Vous avez déjà signalé cette annonce.' });
          return;
        }
        throw error;
      }
      return;
    }

    if (request.method === 'POST' && path === '/properties') {
      const account = requireUser(user);
      const input = propertyInput(await bodyOf(request));
      const inserted = await db.prepare(`
        INSERT INTO properties
          (owner_id, title, description, price, transaction_type, type, city, neighborhood, surface, bedrooms, bathrooms, latitude, longitude, features, image_url, photos, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'online')
      `).run(account.id, input.title, input.description, input.price, input.transaction, input.type, input.city, input.neighborhood, input.surface, input.bedrooms, input.bathrooms, input.latitude, input.longitude, JSON.stringify(input.features), input.imageUrl, JSON.stringify(input.photos));
      const row = await db.prepare(`${propertySelect} WHERE p.id = ?`).get(account.id, inserted.lastInsertRowid);
      json(response, 201, publicProperty(row));
      return;
    }

    const managedPropertyMatch = path.match(/^\/my\/properties\/(\d+)$/);
    if (request.method === 'PUT' && managedPropertyMatch) {
      const account = requireUser(user);
      const previous = await db.prepare(`
        SELECT image_url, photos FROM properties WHERE id = ? AND owner_id = ?
      `).get(Number(managedPropertyMatch[1]), account.id);
      if (!previous) {
        json(response, 404, { error: 'Annonce introuvable.' });
        return;
      }
      const input = propertyInput(await bodyOf(request));
      const changed = await db.prepare(`
        UPDATE properties SET title = ?, description = ?, price = ?, transaction_type = ?,
          type = ?, city = ?, neighborhood = ?, surface = ?, bedrooms = ?, bathrooms = ?, latitude = ?, longitude = ?,
          features = ?, image_url = ?, photos = ?
        WHERE id = ? AND owner_id = ?
      `).run(
        input.title, input.description, input.price, input.transaction, input.type,
        input.city, input.neighborhood, input.surface, input.bedrooms, input.bathrooms,
        input.latitude, input.longitude,
        JSON.stringify(input.features), input.imageUrl, JSON.stringify(input.photos), Number(managedPropertyMatch[1]), account.id,
      );
      if (!changed.changes) throw new Error('Owned listing update unexpectedly affected no rows.');
      await pruneUnreferencedUploads(referencedUploadFilenames([previous]));
      const row = await db.prepare(`${propertySelect} WHERE p.id = ?`).get(account.id, Number(managedPropertyMatch[1]));
      json(response, 200, publicProperty(row));
      return;
    }

    if (request.method === 'DELETE' && managedPropertyMatch) {
      const account = requireUser(user);
      const previous = await db.prepare(`
        SELECT image_url, photos FROM properties WHERE id = ? AND owner_id = ?
      `).get(Number(managedPropertyMatch[1]), account.id);
      if (!previous) {
        json(response, 404, { error: 'Annonce introuvable.' });
        return;
      }
      await db.prepare('DELETE FROM properties WHERE id = ? AND owner_id = ?')
        .run(Number(managedPropertyMatch[1]), account.id);
      await pruneUnreferencedUploads(referencedUploadFilenames([previous]));
      json(response, 200, { deleted: true });
      return;
    }

    if (request.method === 'GET' && path === '/my/properties') {
      const account = requireUser(user);
      const rows = await db.prepare(`${propertySelect} WHERE p.owner_id = ? ORDER BY p.created_at DESC`).all(account.id, account.id);
      json(response, 200, { items: rows.map(publicProperty) });
      return;
    }

    const statusMatch = path.match(/^\/my\/properties\/(\d+)\/status$/);
    if (request.method === 'PATCH' && statusMatch) {
      const account = requireUser(user);
      const input = await bodyOf(request);
      const status = ['online', 'paused', 'archived'].includes(input.status) ? input.status : null;
      if (!status) {
        json(response, 400, { error: 'Statut non valide.' });
        return;
      }
      const changed = await db.prepare('UPDATE properties SET status = ? WHERE id = ? AND owner_id = ?').run(status, Number(statusMatch[1]), account.id);
      json(response, changed.changes ? 200 : 404, changed.changes ? { status } : { error: 'Annonce introuvable.' });
      return;
    }

    if (request.method === 'GET' && path === '/conversations') {
      const account = requireUser(user);
      const rows = await db.prepare(`
        SELECT c.id, c.property_id AS propertyId, p.title AS propertyTitle,
          CASE WHEN c.buyer_id = ? THEN owner.name ELSE buyer.name END AS contactName,
          (SELECT body FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS lastMessage,
          (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) AS lastMessageAt
        FROM conversations c
        JOIN properties p ON p.id = c.property_id
        JOIN users buyer ON buyer.id = c.buyer_id
        JOIN users owner ON owner.id = c.owner_id
        WHERE c.buyer_id = ? OR c.owner_id = ?
        ORDER BY COALESCE("lastMessageAt", c.created_at) DESC
      `).all(account.id, account.id, account.id);
      json(response, 200, { items: rows });
      return;
    }

    if (request.method === 'POST' && path === '/conversations') {
      const account = requireUser(user);
      const input = await bodyOf(request);
      const property = await db.prepare("SELECT id, owner_id FROM properties WHERE id = ? AND status = 'online'").get(Number(input.propertyId));
      if (!property) {
        json(response, 404, { error: 'Annonce introuvable.' });
        return;
      }
      if (property.owner_id === account.id) {
        json(response, 400, { error: 'Vous ne pouvez pas contacter votre propre annonce.' });
        return;
      }
      await db.prepare('INSERT OR IGNORE INTO conversations (property_id, buyer_id, owner_id) VALUES (?, ?, ?)').run(property.id, account.id, property.owner_id);
      const conversation = await db.prepare('SELECT id FROM conversations WHERE property_id = ? AND buyer_id = ?').get(property.id, account.id);
      json(response, 200, conversation);
      return;
    }

    const messagesMatch = path.match(/^\/conversations\/(\d+)\/messages$/);
    if (messagesMatch) {
      const account = requireUser(user);
      const conversationId = Number(messagesMatch[1]);
      const conversation = await db.prepare('SELECT id FROM conversations WHERE id = ? AND (buyer_id = ? OR owner_id = ?)').get(conversationId, account.id, account.id);
      if (!conversation) {
        json(response, 404, { error: 'Conversation introuvable.' });
        return;
      }
      if (request.method === 'GET') {
        const messages = await db.prepare(`
          SELECT m.id, m.body, m.created_at AS createdAt, m.sender_id AS senderId, u.name AS senderName
          FROM messages m JOIN users u ON u.id = m.sender_id
          WHERE m.conversation_id = ? ORDER BY m.id ASC LIMIT 200
        `).all(conversationId);
        json(response, 200, { items: messages });
        return;
      }
      if (request.method === 'POST') {
        const input = await bodyOf(request);
        const body = String(input.body ?? '').trim();
        if (!body || body.length > 4000) {
          json(response, 400, { error: 'Le message doit contenir entre 1 et 4000 caractères.' });
          return;
        }
        let message;
        let recipientId;
        await db.exec('BEGIN IMMEDIATE');
        try {
          const result = await db.prepare('INSERT INTO messages (conversation_id, sender_id, body) VALUES (?, ?, ?)').run(conversationId, account.id, body);
          message = await db.prepare('SELECT id, body, created_at AS createdAt, sender_id AS senderId FROM messages WHERE id = ?').get(result.lastInsertRowid);
          recipientId = (await db.prepare(`
            SELECT CASE WHEN buyer_id = ? THEN owner_id ELSE buyer_id END AS recipientId
            FROM conversations WHERE id = ?
          `).get(account.id, conversationId)).recipientId;
          await db.prepare('INSERT INTO notifications (user_id, title, body) VALUES (?, ?, ?)').run(
            recipientId, 'Nouveau message', `${account.name} vous a envoyé un message.`,
          );
          await db.exec('COMMIT');
        } catch (error) {
          await db.exec('ROLLBACK');
          throw error;
        }
        await sendPushNotifications(
          recipientId,
          'Nouveau message',
          `${account.name} vous a envoyé un message.`,
        );
        json(response, 201, message);
        return;
      }
    }

    if (request.method === 'GET' && path === '/notifications') {
      const account = requireUser(user);
      const items = await db.prepare('SELECT id, title, body, read, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(account.id);
      json(response, 200, { items });
      return;
    }

    if (request.method === 'PATCH' && path === '/profile') {
      const account = requireUser(user);
      const input = await bodyOf(request);
      const name = String(input.name ?? account.name).trim();
      if (name.length < 2) {
        json(response, 400, { error: 'Le nom doit contenir au moins 2 caractères.' });
        return;
      }
      await db.prepare('UPDATE users SET name = ?, phone = ?, city = ?, about = ? WHERE id = ?').run(
        name.slice(0, 100), String(input.phone ?? account.phone).slice(0, 40),
        String(input.city ?? account.city).slice(0, 100), String(input.about ?? account.about).slice(0, 1000), account.id,
      );
      json(response, 200, await db.prepare('SELECT id, name, email, phone, city, about FROM users WHERE id = ?').get(account.id));
      return;
    }

    if (request.method === 'DELETE' && path === '/account') {
      const account = requireUser(user);
      const ownedUploads = referencedUploadFilenames(await db.prepare(
        'SELECT image_url, photos FROM properties WHERE owner_id = ?',
      ).all(account.id));
      await db.exec('BEGIN IMMEDIATE');
      try {
        await db.prepare('DELETE FROM properties WHERE owner_id = ?').run(account.id);
        await db.prepare('DELETE FROM conversations WHERE buyer_id = ?').run(account.id);
        await db.prepare('DELETE FROM users WHERE id = ?').run(account.id);
        await db.exec('COMMIT');
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
      await pruneUnreferencedUploads(ownedUploads);
      json(response, 200, { deleted: true });
      return;
    }

    json(response, 404, { error: 'Route introuvable.' });
  } catch (error) {
    const status = error.status ?? (error.message.includes('Request body') ? 400 : 500);
    if (status >= 500) console.error(error);
    json(response, status, { error: status >= 500 ? 'Une erreur serveur est survenue.' : error.message });
  }
}

createServer((request, response) => {
  db.runWithRequestContext(() => handle(request, response)).catch((error) => {
    console.error(error);
    json(response, 500, { error: 'Une erreur serveur est survenue.' });
  });
}).listen(port, '0.0.0.0', () => {
  console.log(`Domus API listening on http://0.0.0.0:${port}`);
  console.log(isProduction ? 'PostgreSQL database: Supabase' : `SQLite database: ${databasePath}`);
});
