import Database from 'better-sqlite3';

const db = new Database('data/cutoff.sqlite', { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all();
console.log(tables.map((table) => table.name).join(', '));
for (const name of ['users', 'income_streams', 'liabilities', 'paycheck_cycles', 'allocations', 'plans']) {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get();
  console.log(`${name}: ${row.count}`);
}
const olas = db
  .prepare("SELECT bank_name, name, total_balance FROM liabilities WHERE category IN ('ONE_TIME_OLA', 'PAST_DUE_OLA')")
  .all();
console.log(olas);
db.close();
