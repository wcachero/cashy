import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, readPlan, replacePlan } from '../server/db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDatabase(path.join(root, 'data', 'cutoff.sqlite'));
const userId = 'clearcheck0000000000000000000001';
const token = 'clear-check-token';

const filled = {
  version: 1,
  revision: 1,
  notificationsEnabled: false,
  incomeStreams: [
    { id: 'inc-1', name: 'Salary (10th Cutoff)', amount: 49000, dayOfMonth: 10, cutoffType: '10TH_CUTOFF' },
  ],
  liabilities: [
    {
      id: 'debt-anapolis',
      name: 'Anapolis',
      category: 'FIXED_LOAN',
      totalBalance: 11461,
      monthlyAmortization: 11461,
      dueDayOfMonth: 10,
      assignedCutoff: '10TH_CUTOFF',
      startDate: '2026-10-10',
      status: 'ACTIVE',
    },
    {
      id: 'debt-bpi',
      name: 'BPI Personal Loan',
      category: 'FIXED_LOAN',
      totalBalance: 3013,
      monthlyAmortization: 3013,
      dueDayOfMonth: 15,
      assignedCutoff: '10TH_CUTOFF',
      startDate: '2026-10-15',
      status: 'ACTIVE',
    },
  ],
  paycheckCycles: [],
  bankSavings: [],
  receivables: [],
};

function setup() {
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM plans WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  db.prepare('INSERT INTO users (id, name, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    userId,
    'Clear Check',
    'clear-check@example.com',
    'clearcheck',
    'unused:hash',
    new Date().toISOString(),
  );
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  replacePlan(db, userId, filled);
  console.log(JSON.stringify({ token }));
}

function report() {
  const plan = readPlan(db, userId);
  console.log(
    JSON.stringify({
      revision: plan?.revision ?? null,
      income: (plan?.incomeStreams ?? []).map((item) => item.name),
      debts: (plan?.liabilities ?? []).map((item) => item.name),
      cycles: plan?.paycheckCycles?.length ?? null,
      savings: plan?.bankSavings?.length ?? null,
      owed: (plan?.receivables ?? []).map((item) => item.name),
    }),
  );
}

function cleanup() {
  for (const table of ['sessions', 'plans', 'income_streams', 'liabilities', 'paycheck_cycles', 'allocations', 'bank_savings', 'receivables']) {
    db.prepare(`DELETE FROM ${table} WHERE ${table === 'sessions' || table === 'plans' ? 'user_id' : 'user_id'} = ?`).run(userId);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  console.log('deleted');
}

const action = process.argv[2] ?? 'setup';
if (action === 'setup') setup();
else if (action === 'report') report();
else if (action === 'cleanup') cleanup();
else throw new Error(`Unknown action ${action}`);
