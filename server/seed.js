// Load sample data into an empty database: npm run seed
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApi } from '../core/api/index.js';
import { seedDemo } from '../core/seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = openDb(path.join(DATA_DIR, 'store.db'));
const api = createApi(db);

const users = db.get('SELECT COUNT(*) AS n FROM users').n;
if (users > 0) {
  console.log('This database already has accounts, so sample data was not added.');
  console.log('To try the sample data, set DATA_DIR to an empty folder, e.g. DATA_DIR=./demo-data npm run seed');
  process.exit(1);
}
const { users: demoUsers } = await seedDemo(api, { storeName: 'Permanent Floors Carpet One' });
console.log('Sample data added. Sign in with:');
for (const u of demoUsers) console.log(`  ${u.name.padEnd(16)} ${u.role.padEnd(10)} PIN ${u.pin}`);
db.close();
