// Ledger SQLite schema (docs/ARCHITECTURE.md, "Data model"). Created only by seed(): an object that
// was never seeded has no tables, which is how admission tells a real sandbox from a fabricated id
// without writing anything. Amounts are INTEGER cents; display strings are rebuilt with formatUsd.
// WITHOUT ROWID on composite-key tables keeps each insert to one b-tree write (rows written, D-7).

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE counters (name TEXT PRIMARY KEY, day TEXT NOT NULL, count INTEGER NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, tax_rate_bps INTEGER NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE meters (id TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL, product TEXT NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, monthly_fee_cents INTEGER NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE plan_tiers (plan_id TEXT NOT NULL, meter_id TEXT NOT NULL, tier_index INTEGER NOT NULL,
     up_to INTEGER, price_cents INTEGER NOT NULL, per_units INTEGER NOT NULL,
     PRIMARY KEY (plan_id, meter_id, tier_index)) WITHOUT ROWID`,
  `CREATE TABLE subscriptions (customer_id TEXT NOT NULL, from_date TEXT NOT NULL, plan_id TEXT NOT NULL,
     to_date TEXT, PRIMARY KEY (customer_id, from_date)) WITHOUT ROWID`,
  `CREATE TABLE usage_daily (customer_id TEXT NOT NULL, meter_id TEXT NOT NULL, date TEXT NOT NULL,
     quantity INTEGER NOT NULL, PRIMARY KEY (customer_id, meter_id, date)) WITHOUT ROWID`,
  `CREATE TABLE invoices (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, period TEXT NOT NULL,
     issued_on TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, credits_cents INTEGER NOT NULL,
     tax_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL) WITHOUT ROWID`,
  `CREATE TABLE invoice_lines (invoice_id TEXT NOT NULL, idx INTEGER NOT NULL, id TEXT NOT NULL,
     kind TEXT NOT NULL, description TEXT NOT NULL, plan_id TEXT, meter_id TEXT, quantity INTEGER,
     amount_cents INTEGER NOT NULL, tiers_json TEXT NOT NULL,
     PRIMARY KEY (invoice_id, idx)) WITHOUT ROWID`,
  // Append-only. credit_request_id is set only on credit entries: money moves once per request.
  `CREATE TABLE ledger_entries (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, at TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('charge', 'payment', 'credit')),
     amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), invoice_id TEXT,
     reference TEXT NOT NULL, description TEXT NOT NULL, credit_request_id TEXT UNIQUE)`,
  `CREATE TABLE credit_requests (id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
     customer_id TEXT NOT NULL, invoice_id TEXT NOT NULL, disputed_ledger_entry_id TEXT,
     customer_reason TEXT NOT NULL, validated_amount_cents INTEGER, status TEXT NOT NULL,
     created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deadline TEXT, decision_json TEXT,
     outcome_reason TEXT, agent_name TEXT)`,
  // request_id UNIQUE: one memo per request. The per-charge reservation check lives in the Ledger.
  `CREATE TABLE credit_memos (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
     disputed_ledger_entry_id TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
     status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'void')))`,
  // Insert only: no UPDATE or DELETE statement on this table exists in the code (except deleting
  // the whole sandbox). customer_id and request_id are filters for the panel and status tool.
  `CREATE TABLE audit_log (seq INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL,
     action TEXT NOT NULL, subject_type TEXT NOT NULL, subject_id TEXT NOT NULL,
     reason TEXT NOT NULL, before_json TEXT, after_json TEXT, customer_id TEXT, request_id TEXT)`,
  // The single alarm's work queue (docs/ARCHITECTURE.md, "One alarm per Durable Object").
  `CREATE TABLE timers (kind TEXT NOT NULL, subject TEXT NOT NULL, due_at INTEGER NOT NULL,
     PRIMARY KEY (kind, subject)) WITHOUT ROWID`
];

/** Tables in deletion order (idle deletion counts rows written per statement). */
export const TABLES = [
  "usage_daily",
  "invoice_lines",
  "invoices",
  "plan_tiers",
  "plans",
  "meters",
  "subscriptions",
  "ledger_entries",
  "credit_memos",
  "credit_requests",
  "audit_log",
  "timers",
  "counters",
  "customers",
  "meta"
] as const;
