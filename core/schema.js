// Database schema. Works on SQLite in Node (node:sqlite) and in the browser (sql.js).

export const SCHEMA_VERSION = 1;

const V1 = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS installers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT, email TEXT,
  color TEXT,
  specialties TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'sales',
  pin_hash TEXT, pin_salt TEXT,
  email TEXT, phone TEXT,
  installer_id INTEGER REFERENCES installers(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'residential',
  first_name TEXT, last_name TEXT, company TEXT,
  email TEXT, phone TEXT, phone2 TEXT,
  address TEXT, city TEXT, state TEXT, zip TEXT,
  source TEXT,
  sales_rep_id INTEGER REFERENCES users(id),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS customers_name ON customers(last_name, first_name);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT, phone TEXT, email TEXT,
  account_number TEXT, address TEXT, notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  sku TEXT,
  category TEXT NOT NULL,
  vendor_id INTEGER REFERENCES vendors(id),
  manufacturer TEXT,
  style TEXT NOT NULL,
  color TEXT,
  description TEXT,
  unit TEXT NOT NULL DEFAULT 'SF',
  stock_type TEXT NOT NULL DEFAULT 'none',
  roll_width_ft REAL,
  coverage_per_box REAL,
  cost REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 1,
  reorder_point REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_cat ON products(category);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  sales_rep_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft',
  quote_date TEXT NOT NULL,
  title TEXT,
  job_address TEXT, job_city TEXT, job_state TEXT, job_zip TEXT,
  valid_until TEXT,
  notes TEXT, internal_notes TEXT,
  discount REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  cost_total REAL NOT NULL DEFAULT 0,
  signed_name TEXT, signature TEXT, signed_at TEXT,
  order_id INTEGER,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS quotes_customer ON quotes(customer_id);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  quote_id INTEGER,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  sales_rep_id INTEGER REFERENCES users(id),
  stage TEXT NOT NULL DEFAULT 'new',
  order_date TEXT NOT NULL,
  title TEXT,
  job_address TEXT, job_city TEXT, job_state TEXT, job_zip TEXT,
  customer_po TEXT,
  notes TEXT, internal_notes TEXT, install_notes TEXT,
  discount REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  cost_total REAL NOT NULL DEFAULT 0,
  paid_total REAL NOT NULL DEFAULT 0,
  invoice_number TEXT, invoiced_at TEXT, due_date TEXT,
  closed_at TEXT, cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS orders_stage ON orders(stage);

CREATE TABLE IF NOT EXISTS lines (
  id INTEGER PRIMARY KEY,
  doc_type TEXT NOT NULL,
  doc_id INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  product_id INTEGER REFERENCES products(id),
  kind TEXT NOT NULL DEFAULT 'material',
  description TEXT NOT NULL,
  area TEXT,
  unit TEXT NOT NULL DEFAULT 'EA',
  qty REAL NOT NULL DEFAULT 0,
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  taxable INTEGER NOT NULL DEFAULT 1,
  total REAL NOT NULL DEFAULT 0,
  material_status TEXT NOT NULL DEFAULT 'none',
  notes TEXT
);
CREATE INDEX IF NOT EXISTS lines_doc ON lines(doc_type, doc_id);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  doc_type TEXT NOT NULL,
  doc_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  length_ft REAL NOT NULL DEFAULT 0,
  width_ft REAL NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS rooms_doc ON rooms(doc_type, doc_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'card',
  reference TEXT, note TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  status TEXT NOT NULL DEFAULT 'draft',
  expected_date TEXT,
  notes TEXT,
  total REAL NOT NULL DEFAULT 0,
  sent_at TEXT, received_at TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS po_lines (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  product_id INTEGER REFERENCES products(id),
  description TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'EA',
  qty REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  received_qty REAL NOT NULL DEFAULT 0,
  order_id INTEGER,
  order_line_id INTEGER,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS po_lines_po ON po_lines(po_id);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL,
  tag TEXT,
  dye_lot TEXT,
  location TEXT,
  width_ft REAL,
  length_ft REAL,
  qty REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  is_remnant INTEGER NOT NULL DEFAULT 0,
  po_id INTEGER,
  received_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_product ON inventory(product_id);

CREATE TABLE IF NOT EXISTS inventory_tx (
  id INTEGER PRIMARY KEY,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id),
  type TEXT NOT NULL,
  qty REAL NOT NULL,
  order_id INTEGER,
  line_id INTEGER,
  ref_id INTEGER,
  note TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inventory_tx_item ON inventory_tx(inventory_id);
CREATE INDEX IF NOT EXISTS inventory_tx_line ON inventory_tx(line_id);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'install',
  status TEXT NOT NULL DEFAULT 'scheduled',
  order_id INTEGER,
  customer_id INTEGER,
  installer_id INTEGER,
  date TEXT NOT NULL,
  end_date TEXT,
  start_time TEXT,
  duration_hours REAL,
  title TEXT,
  address TEXT,
  notes TEXT,
  completed_at TEXT,
  completion_notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS appointments_date ON appointments(date);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  user_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notes_entity ON notes(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_entity ON activity(entity_type, entity_id);
`;

export const DEFAULT_SETTINGS = {
  store_name: 'Permanent Floors Carpet One',
  store_address: '',
  store_city: '',
  store_state: '',
  store_zip: '',
  store_phone: '',
  store_email: '',
  store_website: '',
  tax_rate: '8',
  deposit_percent: '50',
  quote_valid_days: '30',
  invoice_due_days: '0',
  remnant_max_ft: '20',
  quote_terms:
    'Prices include the materials and labor listed. Moving furniture, removing old flooring and subfloor repair are only included when listed. A deposit is due when the order is placed and the balance is due when installation is complete.',
  invoice_terms: 'Balance due on completion. Thank you for your business.',
};

export function migrate(db) {
  const row = db.get('PRAGMA user_version');
  const version = row ? Number(Object.values(row)[0]) : 0;
  if (version < 1) {
    db.exec(V1);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, value);
  }
  for (const [name, value] of [['quote', 1001], ['order', 2001], ['po', 501]]) {
    db.run('INSERT OR IGNORE INTO counters (name, value) VALUES (?, ?)', name, value);
  }
}

// Remove every record and put settings and numbering back to their defaults.
export function wipeAll(db) {
  const tables = ['activity', 'notes', 'appointments', 'inventory_tx', 'inventory', 'po_lines', 'purchase_orders', 'payments',
    'rooms', 'lines', 'orders', 'quotes', 'products', 'vendors', 'customers', 'sessions', 'users', 'installers', 'counters', 'settings'];
  for (const t of tables) db.exec(`DELETE FROM ${t}`);
  migrate(db);
}
