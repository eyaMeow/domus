import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createSqliteDatabase, translatePostgresSql } from '../src/database.mjs';

test('translates SQLite parameters, case-insensitive matching, and camel-case aliases', () => {
  const sql = translatePostgresSql(
    'SELECT created_at AS createdAt FROM users WHERE email LIKE ? AND id = ?',
  );

  assert.equal(
    sql,
    'SELECT created_at AS "createdAt" FROM users WHERE email ILIKE $1 AND id = $2',
  );
});

test('translates supported INSERT OR IGNORE conflict targets', () => {
  assert.equal(
    translatePostgresSql('INSERT OR IGNORE INTO favorites (user_id, property_id) VALUES (?, ?)'),
    'INSERT INTO favorites (user_id, property_id) VALUES ($1, $2) ON CONFLICT (user_id, property_id) DO NOTHING',
  );
  assert.equal(
    translatePostgresSql('INSERT OR IGNORE INTO conversations (property_id, buyer_id, owner_id) VALUES (?, ?, ?)'),
    'INSERT INTO conversations (property_id, buyer_id, owner_id) VALUES ($1, $2, $3) ON CONFLICT (property_id, buyer_id) DO NOTHING',
  );
});

test('keeps another SQLite request out of an open async transaction', async () => {
  const db = createSqliteDatabase(':memory:');
  await db.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY)');
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  let finishTransaction;
  const holdTransaction = new Promise((resolve) => { finishTransaction = resolve; });
  let secondRequestFinished = false;

  const firstRequest = db.runWithRequestContext(async () => {
    await db.exec('BEGIN IMMEDIATE');
    await db.prepare('INSERT INTO entries (id) VALUES (?)').run(1);
    markStarted();
    await holdTransaction;
    await db.exec('COMMIT');
  });
  await started;
  const secondRequest = db.runWithRequestContext(async () => {
    await db.prepare('INSERT INTO entries (id) VALUES (?)').run(2);
    secondRequestFinished = true;
  });

  await delay(10);
  assert.equal(secondRequestFinished, false);
  finishTransaction();
  await Promise.all([firstRequest, secondRequest]);
  assert.deepEqual(
    db.prepare('SELECT id FROM entries ORDER BY id').all().map(({ id }) => id),
    [1, 2],
  );
});
