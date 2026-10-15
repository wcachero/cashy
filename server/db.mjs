import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export const SEED_USER_ID = 'plan-seed';

export function openDatabase(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plans (
      user_id TEXT PRIMARY KEY,
      snapshot_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS income_streams (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      day_of_month INTEGER NOT NULL,
      cutoff_type TEXT NOT NULL,
      remaining_months INTEGER,
      is_one_time INTEGER NOT NULL DEFAULT 0,
      specific_date TEXT,
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS liabilities (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      bank_name TEXT,
      category TEXT NOT NULL,
      total_balance REAL NOT NULL,
      initial_balance REAL,
      monthly_amortization REAL NOT NULL,
      minimum_due REAL,
      due_day INTEGER NOT NULL,
      assigned_cutoff TEXT NOT NULL,
      remaining_terms INTEGER,
      start_date TEXT NOT NULL,
      end_date TEXT,
      status TEXT NOT NULL,
      priority_rank INTEGER NOT NULL,
      notes TEXT,
      original_balance REAL,
      original_terms INTEGER,
      split_across_cutoffs INTEGER NOT NULL DEFAULT 0,
      is_frozen INTEGER NOT NULL DEFAULT 0,
      adjustments_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS paycheck_cycles (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      label TEXT NOT NULL,
      cutoff_date TEXT NOT NULL,
      base_income REAL NOT NULL,
      supplementary_income REAL NOT NULL,
      carry_over REAL NOT NULL,
      sinking_fund REAL NOT NULL,
      sort_order INTEGER NOT NULL,
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS allocations (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      liability_id TEXT NOT NULL,
      name TEXT NOT NULL,
      bank_name TEXT,
      category TEXT NOT NULL,
      due_date TEXT NOT NULL,
      planned_amount REAL NOT NULL,
      actual_paid_amount REAL NOT NULL,
      minimum_due REAL,
      is_paid INTEGER NOT NULL DEFAULT 0,
      payment_note TEXT,
      counts_as_term INTEGER,
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS bank_savings (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      amount REAL NOT NULL,
      notes TEXT,
      PRIMARY KEY (user_id, id)
    );

    CREATE TABLE IF NOT EXISTS receivables (
      user_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      total_debt REAL NOT NULL,
      amount_received REAL NOT NULL,
      payment_amount REAL NOT NULL,
      terms INTEGER NOT NULL,
      notes TEXT,
      PRIMARY KEY (user_id, id)
    );
  `);
  const receivableColumns = db.prepare('PRAGMA table_info(receivables)').all();
  const columnNames = new Set(receivableColumns.map((column) => column.name));
  if (!columnNames.has('due_day')) db.prepare('ALTER TABLE receivables ADD COLUMN due_day INTEGER').run();
  if (!columnNames.has('borrowed_on')) db.prepare('ALTER TABLE receivables ADD COLUMN borrowed_on TEXT').run();

  const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name));
  if (!userColumns.has('username')) db.prepare('ALTER TABLE users ADD COLUMN username TEXT').run();
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username COLLATE NOCASE) WHERE username IS NOT NULL');
}

export function replacePlan(db, userId, snapshot) {
  const current = readPlan(db, userId);
  const incoming = Number(snapshot?.revision ?? 0);
  const stored = Number(current?.revision ?? 0);
  if (incoming < stored) {
    const error = new Error('A newer plan was already saved.');
    error.code = 'STALE_PLAN';
    throw error;
  }
  const now = new Date().toISOString();
  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM income_streams WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM liabilities WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM paycheck_cycles WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM allocations WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM bank_savings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM receivables WHERE user_id = ?').run(userId);
    db.prepare(
      `INSERT INTO plans (user_id, snapshot_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
    ).run(userId, JSON.stringify(snapshot), now);

    const insertIncome = db.prepare(
      `INSERT INTO income_streams
        (user_id, id, name, amount, day_of_month, cutoff_type, remaining_months, is_one_time, specific_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const stream of snapshot.incomeStreams ?? []) {
      insertIncome.run(
        userId,
        stream.id,
        stream.name,
        stream.amount,
        stream.dayOfMonth,
        stream.cutoffType,
        stream.remainingMonths ?? null,
        stream.isOneTime ? 1 : 0,
        stream.specificDate ?? null,
      );
    }

    const insertLiability = db.prepare(
      `INSERT INTO liabilities (
        user_id, id, name, bank_name, category, total_balance, initial_balance, monthly_amortization,
        minimum_due, due_day, assigned_cutoff, remaining_terms, start_date, end_date, status,
        priority_rank, notes, original_balance, original_terms, split_across_cutoffs, is_frozen, adjustments_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of snapshot.liabilities ?? []) {
      insertLiability.run(
        userId,
        item.id,
        item.name,
        item.bankName ?? item.name,
        item.category,
        item.totalBalance,
        item.initialBalance ?? item.totalBalance,
        item.monthlyAmortization,
        item.minimumDue ?? null,
        item.dueDayOfMonth,
        item.assignedCutoff,
        item.remainingTerms ?? null,
        item.startDate,
        item.endDate ?? null,
        item.status,
        item.priorityRank ?? 0,
        item.notes ?? null,
        item.originalBalance ?? item.totalBalance,
        item.originalTerms ?? null,
        item.splitAcrossCutoffs ? 1 : 0,
        item.isFrozenPastDue ? 1 : 0,
        JSON.stringify(item.adjustments ?? []),
      );
    }

    const insertCycle = db.prepare(
      `INSERT INTO paycheck_cycles
        (user_id, id, label, cutoff_date, base_income, supplementary_income, carry_over, sinking_fund, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertAllocation = db.prepare(
      `INSERT INTO allocations (
        user_id, id, cycle_id, liability_id, name, bank_name, category, due_date, planned_amount,
        actual_paid_amount, minimum_due, is_paid, payment_note, counts_as_term
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    (snapshot.paycheckCycles ?? []).forEach((cycle, index) => {
      insertCycle.run(
        userId,
        cycle.id,
        cycle.label,
        cycle.cutoffDate,
        cycle.baseIncome,
        cycle.supplementaryIncome,
        cycle.carryOverFromPrevious,
        cycle.sinkingFundReserved,
        index,
      );
      for (const allocation of cycle.allocations ?? []) {
        const liability = (snapshot.liabilities ?? []).find((item) => item.id === allocation.liabilityId);
        insertAllocation.run(
          userId,
          allocation.id,
          cycle.id,
          allocation.liabilityId,
          allocation.name,
          liability?.bankName ?? null,
          allocation.category,
          allocation.dueDate,
          allocation.plannedAmount,
          allocation.actualPaidAmount ?? 0,
          allocation.minimumDue ?? null,
          allocation.isPaid ? 1 : 0,
          allocation.paymentNote ?? null,
          allocation.countsAsTerm == null ? null : allocation.countsAsTerm ? 1 : 0,
        );
      }
    });

    const insertSaving = db.prepare(
      `INSERT INTO bank_savings (user_id, id, bank_name, account_name, amount, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const saving of snapshot.bankSavings ?? []) {
      insertSaving.run(userId, saving.id, saving.bankName, saving.accountName, saving.amount, saving.notes ?? null);
    }

    const insertReceivable = db.prepare(
      `INSERT INTO receivables (user_id, id, name, total_debt, amount_received, payment_amount, terms, notes, due_day, borrowed_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of snapshot.receivables ?? []) {
      insertReceivable.run(
        userId,
        item.id,
        item.name,
        item.totalDebt,
        item.amountReceived ?? 0,
        item.paymentAmount,
        item.terms,
        item.notes ?? null,
        item.dueDayOfMonth ?? null,
        item.borrowedOn ?? null,
      );
    }
  });
  wipe();
}

export function readPlan(db, userId) {
  const row = db.prepare('SELECT snapshot_json FROM plans WHERE user_id = ?').get(userId);
  if (!row) return null;
  return JSON.parse(row.snapshot_json);
}
