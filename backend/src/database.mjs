import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import pg from 'pg';

const requestContext = new AsyncLocalStorage();
const { Pool } = pg;

export function translatePostgresSql(sql) {
  const ignore = /^\s*INSERT OR IGNORE INTO (favorites|conversations)\b/i.exec(sql);
  let translated = sql.replace(/^\s*INSERT OR IGNORE INTO/i, 'INSERT INTO');
  let placeholder = 0;
  translated = translated.replace(/\?/g, () => `$${++placeholder}`);
  translated = translated.replace(/\bAS ([A-Za-z][A-Za-z0-9]*)\b/g, (_, alias) =>
    /^[a-z_][a-z0-9_]*$/.test(alias) ? `AS ${alias}` : `AS "${alias}"`,
  );
  translated = translated.replace(/\bLIKE\s+\$(\d+)/g, (_, index) => `ILIKE $${index}`);
  if (ignore?.[1] === 'favorites') {
    translated += ' ON CONFLICT (user_id, property_id) DO NOTHING';
  } else if (ignore?.[1] === 'conversations') {
    translated += ' ON CONFLICT (property_id, buyer_id) DO NOTHING';
  }
  return translated;
}

export function createSqliteDatabase(path) {
  const connection = new DatabaseSync(path);
  const contextlessTransaction = Symbol('contextless transaction');
  let transactionOwner = null;
  const transactionWaiters = [];

  function wakeNextTransactionWaiter() {
    transactionOwner = null;
    transactionWaiters.shift()?.();
  }

  async function waitForTransaction(context) {
    while (transactionOwner && transactionOwner !== context) {
      await new Promise((resolve) => transactionWaiters.push(resolve));
    }
  }

  function runStatement(statement, method, params) {
    const context = requestContext.getStore() ?? contextlessTransaction;
    if (!transactionOwner || transactionOwner === context) return statement[method](...params);
    return waitForTransaction(context).then(() => statement[method](...params));
  }

  return {
    async exec(sql) {
      const command = sql.trim().toUpperCase();
      const context = requestContext.getStore();
      if (command === 'BEGIN IMMEDIATE' || command === 'BEGIN') {
        const owner = context ?? contextlessTransaction;
        await waitForTransaction(owner);
        transactionOwner = owner;
        try {
          connection.exec(sql);
        } catch (error) {
          wakeNextTransactionWaiter();
          throw error;
        }
        return;
      }
      if (command === 'COMMIT' || command === 'ROLLBACK') {
        const owner = context ?? contextlessTransaction;
        if (transactionOwner !== owner) throw new Error('No database transaction is active.');
        try {
          connection.exec(sql);
        } finally {
          wakeNextTransactionWaiter();
        }
        return;
      }
      if (transactionOwner && transactionOwner !== (context ?? contextlessTransaction)) {
        await waitForTransaction(context ?? contextlessTransaction);
      }
      connection.exec(sql);
    },
    prepare(sql) {
      const statement = connection.prepare(sql);
      return {
        all: (...params) => runStatement(statement, 'all', params),
        get: (...params) => runStatement(statement, 'get', params),
        run: (...params) => runStatement(statement, 'run', params),
      };
    },
    runWithRequestContext: (callback) => requestContext.run({}, callback),
  };
}

export function createPostgresDatabase(connectionString) {
  const pool = new Pool({ connectionString, max: 5 });

  async function query(sql, params = []) {
    const client = requestContext.getStore()?.client;
    const result = await (client ?? pool).query(sql, params);
    return result;
  }

  function normalizeRow(row) {
    if (!row) return row;
    for (const [key, value] of Object.entries(row)) {
      if (
        typeof value === 'string' &&
        /^(?:\d+|[-+]?\d+\.\d+)$/.test(value) &&
        (key === 'count' || key.endsWith('Count'))
      ) {
        row[key] = Number(value);
      }
    }
    return row;
  }

  return {
    async exec(sql) {
      const command = sql.trim().toUpperCase();
      const state = requestContext.getStore();
      if (command === 'BEGIN IMMEDIATE' || command === 'BEGIN') {
        if (!state) throw new Error('Database transactions require a request context.');
        if (state.client) throw new Error('Nested database transactions are not supported.');
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          state.client = client;
        } catch (error) {
          client.release(error);
          throw error;
        }
        return;
      }
      if (command === 'COMMIT' || command === 'ROLLBACK') {
        const client = state?.client;
        if (!client) throw new Error('No database transaction is active.');
        try {
          await client.query(command);
          client.release();
        } catch (error) {
          client.release(error);
          throw error;
        } finally {
          state.client = null;
        }
        return;
      }
      await query(sql);
    },
    prepare(sql) {
      const translated = translatePostgresSql(sql);
      return {
        async all(...params) {
          const result = await query(translated, params);
          return result.rows.map(normalizeRow);
        },
        async get(...params) {
          const result = await query(translated, params);
          return normalizeRow(result.rows[0]);
        },
        async run(...params) {
          const returnsId = /^\s*INSERT INTO (users|properties|property_reports|messages|notifications)\b/i.test(translated);
          const statement = returnsId ? `${translated} RETURNING id` : translated;
          const result = await query(statement, params);
          return {
            changes: result.rowCount,
            lastInsertRowid: result.rows[0]?.id,
          };
        },
      };
    },
    runWithRequestContext(callback) {
      return requestContext.run({ client: null }, callback);
    },
    async close() {
      await pool.end();
    },
  };
}
