CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  username TEXT,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username COLLATE NOCASE) WHERE username IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS used_challenges (
  id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
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
  due_day INTEGER,
  borrowed_on TEXT,
  PRIMARY KEY (user_id, id)
);
