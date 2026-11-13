import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const backendDirectory = fileURLToPath(new URL('../', import.meta.url));
const databasePath = join(tmpdir(), `domus-test-${process.pid}.sqlite`);
const uploadsPath = join(tmpdir(), `domus-uploads-test-${process.pid}`);
let server;
let smtpServer;
let baseUrl;
let smtpPort;
let serverOutput = '';
const smtpMessages = [];

async function unusedPort() {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function startSmtpMock() {
  smtpServer = createServer((socket) => {
    let buffered = '';
    let collectingMessage = false;
    let messageLines = [];
    socket.on('error', () => {});
    socket.write('220 domus-test SMTP\r\n');
    socket.on('data', (chunk) => {
      buffered += chunk.toString();
      let newline;
      while ((newline = buffered.indexOf('\n')) !== -1) {
        const line = buffered.slice(0, newline).replace(/\r$/, '');
        buffered = buffered.slice(newline + 1);
        if (collectingMessage) {
          if (line === '.') {
            collectingMessage = false;
            smtpMessages.push(messageLines.join('\n'));
            messageLines = [];
            socket.write('250 Message accepted\r\n');
          } else {
            messageLines.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }
        const command = line.split(' ')[0].toUpperCase();
        if (command === 'EHLO' || command === 'HELO') socket.write('250-domus-test\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (command === 'AUTH') socket.write('235 Authentication successful\r\n');
        else if (command === 'DATA') {
          collectingMessage = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise((resolve) => smtpServer.listen(0, '127.0.0.1', resolve));
  smtpPort = smtpServer.address().port;
}

async function request(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}

before(async () => {
  await startSmtpMock();
  const port = await unusedPort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['src/server.mjs'], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      DATABASE_PATH: databasePath,
      UPLOADS_PATH: uploadsPath,
      DOMUS_JWT_SECRET: 'domus-integration-test-secret-0123456789',
      DOMUS_ADMIN_EMAIL: 'admin@domus.test',
      DOMUS_ADMIN_PASSWORD: 'DomusTestAdminPassword123',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpPort),
      SMTP_USER: 'test-user',
      SMTP_PASSWORD: 'test-password',
      SMTP_FROM: 'no-reply@domus.test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });
  server.stderr.setEncoding('utf8').on('data', (chunk) => { serverOutput += chunk; });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`API process exited with ${server.exitCode}: ${serverOutput}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`API did not start in time: ${serverOutput}`);
});

after(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
  }
  if (smtpServer) await new Promise((resolve) => smtpServer.close(resolve));
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${databasePath}${suffix}`, { force: true });
  rmSync(uploadsPath, { recursive: true, force: true });
});

test('supports the main account, listings, favorites, chat, and deletion flows', async () => {
  const login = await request('/auth/login', {
    method: 'POST',
    body: { email: 'demo@domus.tn', password: 'Domus2026' },
  });
  assert.equal(login.status, 200);
  const token = login.data.token;
  assert.equal((await request('/admin/users')).status, 403);
  assert.equal((await request('/admin/login', {
    method: 'POST',
    body: { email: 'admin@domus.test', password: 'wrong-password' },
  })).status, 401);
  const adminLogin = await request('/auth/login', {
    method: 'POST',
    body: {
      email: 'admin@domus.test',
      password: 'DomusTestAdminPassword123',
    },
  });
  assert.equal(adminLogin.status, 200);
  assert.equal(adminLogin.data.user.role, 'admin');
  const adminToken = adminLogin.data.token;
  const adminSession = await request('/auth/me', { token: adminToken });
  assert.equal(adminSession.status, 200);
  assert.deepEqual(adminSession.data, adminLogin.data.user);
  const adminUsers = await request('/admin/users', { token: adminToken });
  assert.equal(adminUsers.status, 200);
  assert.ok(adminUsers.data.items.length >= 2);
  assert.equal((await request(`/admin/users/${login.data.user.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { phone: '+216 55 555 555' },
  })).status, 404);
  assert.equal((await request('/devices', {
    method: 'POST',
    body: { token: 'ExponentPushToken[test-device-token-123456]', platform: 'expo' },
  })).status, 401);
  const registeredDevice = await request('/devices', {
    method: 'POST',
    token,
    body: { token: 'ExponentPushToken[test-device-token-123456]', platform: 'expo' },
  });
  assert.equal(registeredDevice.status, 201);
  assert.equal(registeredDevice.data.registered, true);
  assert.equal((await request('/devices', {
    method: 'POST',
    token,
    body: { token: 'bad-token', platform: 'expo' },
  })).status, 400);
  assert.equal((await request('/devices/ExponentPushToken%5Btest-device-token-123456%5D', {
    method: 'DELETE',
    token,
  })).data.deleted, true);
  assert.equal((await request('/auth/verify-email', {
    method: 'POST',
    body: { token: '0'.repeat(64) },
  })).status, 400);
  assert.equal((await request('/auth/forgot-password', {
    method: 'POST',
    body: { email: 'demo@domus.tn' },
  })).status, 404);
  assert.equal((await request('/auth/verification/resend', {
    method: 'POST',
    body: { email: 'demo@domus.tn' },
  })).status, 404);

  const anonymousUpload = await request('/uploads', {
    method: 'POST',
    body: { mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' },
  });
  assert.equal(anonymousUpload.status, 401);
  const uploaded = await request('/uploads', {
    method: 'POST',
    token,
    body: { mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB' },
  });
  assert.equal(uploaded.status, 201, `${JSON.stringify(uploaded.data)} ${serverOutput}`);
  const photo = await fetch(`${baseUrl}${uploaded.data.url}`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/png');

  const listings = await request('/properties');
  assert.equal(listings.status, 200);
  assert.ok(listings.data.items.length >= 4);

  const filtered = await request('/properties?transaction=Location');
  assert.equal(filtered.status, 200);
  assert.ok(filtered.data.items.every((item) => item.transaction === 'Location'));

  const favorite = await request('/favorites/1', { method: 'PUT', token });
  assert.equal(favorite.status, 200);
  assert.equal((await request('/favorites', { token })).data.items[0].id, 1);

  const published = await request('/properties', {
    method: 'POST',
    token,
    body: {
      title: 'Maison familiale avec jardin',
      description: 'Maison lumineuse dans un quartier calme.',
      price: 520000,
      transaction: 'Vente',
      type: 'Maison',
      city: 'Sousse',
      latitude: 35.8256,
      longitude: 10.6084,
      surface: 145,
      bedrooms: 3,
      bathrooms: 2,
      imageUrl: `${baseUrl}${uploaded.data.url}`,
      photos: [`${baseUrl}${uploaded.data.url}`],
    },
  });
  assert.equal(published.status, 201);
  assert.equal(published.data.ownerName, 'Eya Chihi');
  assert.equal(published.data.latitude, 35.8256);
  assert.equal(published.data.longitude, 10.6084);
  assert.deepEqual(published.data.photos, [`${baseUrl}${uploaded.data.url}`]);
  const invalidCoordinates = await request('/properties', {
    method: 'POST',
    token,
    body: {
      title: 'Maison sans coordonnées valides',
      city: 'Sousse',
      price: 520000,
      latitude: 91,
      longitude: 10.6,
    },
  });
  assert.equal(invalidCoordinates.status, 400);
  const updated = await request(`/my/properties/${published.data.id}`, {
    method: 'PUT',
    token,
    body: {
      title: 'Maison familiale rénovée',
      description: 'Maison lumineuse récemment rénovée.',
      price: 525000,
      transaction: 'Vente',
      type: 'Maison',
      city: 'Sousse',
      latitude: 35.83,
      longitude: 10.62,
      surface: 145,
      bedrooms: 3,
      bathrooms: 2,
      imageUrl: `${baseUrl}${uploaded.data.url}`,
      photos: [`${baseUrl}${uploaded.data.url}`],
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.price, 525000);
  assert.equal(updated.data.latitude, 35.83);
  assert.equal(updated.data.longitude, 10.62);

  const conversation = await request('/conversations', {
    method: 'POST',
    token,
    body: { propertyId: 1 },
  });
  assert.equal(conversation.status, 200);
  const ownerLogin = await request('/auth/login', {
    method: 'POST',
    body: { email: 'sami@domus.tn', password: 'Domus2026' },
  });
  const report = await request(`/properties/${published.data.id}/reports`, {
    method: 'POST',
    token: ownerLogin.data.token,
    body: { reason: 'The listing contains misleading information.' },
  });
  assert.equal(report.status, 201);
  const duplicateReport = await request(`/properties/${published.data.id}/reports`, {
    method: 'POST',
    token: ownerLogin.data.token,
    body: { reason: 'Another report for the same listing.' },
  });
  assert.equal(duplicateReport.status, 409, `${JSON.stringify(duplicateReport.data)} ${serverOutput}`);
  assert.equal((await request(`/properties/${published.data.id}/reports`, {
    method: 'POST',
    token,
    body: { reason: 'Owner cannot report own listing.' },
  })).status, 400);
  const adminReports = await request('/admin/reports', { token: adminToken });
  assert.equal(adminReports.status, 200);
  assert.ok(adminReports.data.items.some((item) => item.id === report.data.id));
  const adminProperties = await request('/admin/properties', { token: adminToken });
  assert.equal(adminProperties.status, 200);
  const reportedProperty = adminProperties.data.items.find(
    (item) => item.id === published.data.id,
  );
  assert.equal(reportedProperty.title, 'Maison familiale rénovée');
  assert.equal(reportedProperty.description, 'Maison lumineuse récemment rénovée.');
  assert.equal(reportedProperty.ownerName, 'Eya Chihi');
  assert.equal(reportedProperty.photos[0], `${baseUrl}${uploaded.data.url}`);
  assert.equal((await request(`/admin/reports/${report.data.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { status: 'resolved' },
  })).data.status, 'resolved');
  const adminUpdate = await request(`/admin/properties/${published.data.id}`, {
    method: 'PATCH',
    token: adminToken,
    body: { title: 'Admin reviewed listing', price: 530000 },
  });
  assert.equal(adminUpdate.status, 404);
  const ownerDelete = await request(`/my/properties/${published.data.id}`, {
    method: 'DELETE',
    token,
  });
  assert.equal(ownerDelete.status, 200);
  assert.equal((await request(`/properties/${published.data.id}`)).status, 404);
  assert.equal((await request(`/admin/properties/${published.data.id}`, {
    method: 'DELETE',
    token: adminToken,
  })).status, 404);
  assert.ok((await request('/admin/reports', { token: adminToken })).data.items
    .some((item) => item.id === report.data.id && item.propertyTitle === null));
  assert.equal((await request('/admin/properties/4', {
    method: 'DELETE',
    token: adminToken,
  })).status, 200);
  assert.equal((await request('/devices', {
    method: 'POST',
    token: ownerLogin.data.token,
    body: { token: 'fcm-test-device-token-123456789', platform: 'fcm' },
  })).status, 201);
  const sentMessage = await request(`/conversations/${conversation.data.id}/messages`, {
    method: 'POST',
    token,
    body: { body: 'Bonjour, le bien est-il toujours disponible ?' },
  });
  assert.equal(sentMessage.status, 201);
  for (let attempt = 0; attempt < 20 && !serverOutput.includes('FCM delivery failed'); attempt += 1) await delay(10);
  assert.ok(serverOutput.includes('FCM delivery failed (code: not_configured).'));

  const unauthorizedUpdate = await request(`/my/properties/${published.data.id}`, {
    method: 'PUT',
    token: ownerLogin.data.token,
    body: { title: 'Hijacked listing', city: 'Tunis', price: 1 },
  });
  assert.equal(unauthorizedUpdate.status, 404);
  const notifications = await request('/notifications', { token: ownerLogin.data.token });
  assert.equal(notifications.status, 200);
  assert.equal(notifications.data.items[0].title, 'Nouveau message');

  const banned = await request(`/admin/users/${ownerLogin.data.user.id}`, {
    method: 'DELETE',
    token: adminToken,
  });
  assert.equal(banned.status, 200);
  assert.equal(banned.data.banned, true);
  assert.equal((await request('/auth/me', { token: ownerLogin.data.token })).status, 403);
  assert.equal((await request('/auth/login', {
    method: 'POST',
    body: { email: 'sami@domus.tn', password: 'Domus2026' },
  })).data.error, 'Votre compte a été définitivement banni.');

  const deletion = await request('/account', { method: 'DELETE', token });
  assert.equal(deletion.data.deleted, true);
  assert.equal((await request('/auth/me', { token })).status, 401);
  assert.equal((await fetch(`${baseUrl}${uploaded.data.url}`)).status, 404);

  const rejectedRegistration = await request('/auth/register', {
    method: 'POST',
    body: { name: 'Test Account', email: 'test@domus.tn', password: 'Password123' },
  });
  assert.equal(rejectedRegistration.status, 400);
  const registration = await request('/auth/register', {
    method: 'POST',
    body: {
      name: 'Test Account',
      email: 'test@domus.tn',
      password: 'Password123',
      acceptedTerms: true,
    },
  });
  assert.equal(registration.status, 201);
  assert.ok(registration.data.token);
});

test('requires email verification when configured and keeps removed recovery endpoints disabled', async () => {
  const productionDatabase = join(tmpdir(), `domus-production-test-${process.pid}.sqlite`);
  const productionUploads = join(tmpdir(), `domus-production-uploads-${process.pid}`);
  const port = await unusedPort();
  const output = { value: '' };
  const productionServer = spawn(process.execPath, ['src/server.mjs'], {
    cwd: backendDirectory,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      DOMUS_REQUIRE_EMAIL_VERIFICATION: 'true',
      DATABASE_PATH: productionDatabase,
      UPLOADS_PATH: productionUploads,
      DOMUS_JWT_SECRET: 'domus-production-test-secret-0123456789',
      DOMUS_ADMIN_EMAIL: 'admin@domus.test',
      DOMUS_ADMIN_PASSWORD: 'DomusTestAdminPassword123',
      CORS_ORIGIN: 'https://domus.test',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpPort),
      SMTP_USER: 'test-user',
      SMTP_PASSWORD: 'test-password',
      SMTP_FROM: 'no-reply@domus.test',
      FIREBASE_SERVICE_ACCOUNT_PATH: '',
      FIREBASE_SERVICE_ACCOUNT_JSON: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  productionServer.stdout.setEncoding('utf8').on('data', (chunk) => { output.value += chunk; });
  productionServer.stderr.setEncoding('utf8').on('data', (chunk) => { output.value += chunk; });
  const productionUrl = `http://127.0.0.1:${port}`;
  const productionRequest = async (path, body) => {
    const response = await fetch(`${productionUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (productionServer.exitCode !== null) throw new Error(`Production API exited: ${output.value}`);
      try {
        if ((await fetch(`${productionUrl}/health`)).ok) {
          ready = true;
          break;
        }
      } catch {
        await delay(100);
      }
    }
    assert.ok(ready, `Production API did not start: ${output.value}`);
    const previousMessageCount = smtpMessages.length;
    const registration = await productionRequest('/auth/register', {
      name: 'Verified Account',
      email: 'verified@domus.test',
      password: 'Password123',
      acceptedTerms: true,
    });
    assert.equal(registration.status, 201);
    assert.equal(registration.data.verificationRequired, true);
    assert.equal(registration.data.token, undefined);
    assert.equal((await productionRequest('/auth/login', {
      email: 'verified@domus.test',
      password: 'Password123',
    })).status, 403);
    for (let attempt = 0; attempt < 40 && smtpMessages.length <= previousMessageCount; attempt += 1) await delay(25);
    const originalVerificationToken = smtpMessages.at(-1)?.match(/\n([a-f0-9]{64})\n/i)?.[1];
    assert.ok(originalVerificationToken, 'verification email should contain a one-time token');
    assert.equal((await productionRequest('/auth/verification/resend', {
      email: 'verified@domus.test',
    })).status, 404);
    assert.equal((await productionRequest('/auth/forgot-password', {
      email: 'verified@domus.test',
    })).status, 404);
    assert.equal((await productionRequest('/auth/verify-email', {
      token: originalVerificationToken,
    })).status, 200);
    assert.equal((await productionRequest('/auth/verify-email', {
      token: originalVerificationToken,
    })).status, 400);
    assert.equal((await productionRequest('/auth/login', {
      email: 'verified@domus.test',
      password: 'Password123',
    })).status, 200);
  } finally {
    if (productionServer.exitCode === null && productionServer.signalCode === null) {
      productionServer.kill();
      await new Promise((resolve) => productionServer.once('exit', resolve));
    }
    for (const suffix of ['', '-shm', '-wal']) rmSync(`${productionDatabase}${suffix}`, { force: true });
    rmSync(productionUploads, { recursive: true, force: true });
  }
});
