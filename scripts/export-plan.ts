import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFinanceExport } from '../src/app/core/finance-export';
import { createSeedSnapshot } from '../src/app/data/seed-data';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = createSeedSnapshot();
const finance = toFinanceExport(snapshot, '2026-10-15');

const exportDir = path.join(root, 'data', 'exports');
mkdirSync(exportDir, { recursive: true });
const exportPath = path.join(exportDir, 'financial-plan-2026-10-15.json');
writeFileSync(exportPath, `${JSON.stringify(finance, null, 2)}\n`);

const debt = snapshot.liabilities
  .filter((item) => item.category !== 'LIVING_EXPENSE')
  .reduce((sum, item) => sum + item.totalBalance, 0);

console.log(`Wrote ${exportPath}`);
console.log(`Liabilities: ${snapshot.liabilities.length}`);
console.log(`Cycles: ${snapshot.paycheckCycles.length}`);
console.log(`Debt balance: ${debt.toFixed(2)}`);
console.log(`OLAs: ${finance.olas.map((item) => `${item.bankName} ${item.totalBalance}`).join(', ')}`);
