// Shared by every sql/migrate-*.js script. Records which migrations have already been applied
// to this database in schema_migrations, so `npm run db:migrate` can run all of them in one
// command and skip whatever's already done — a developer no longer needs to know or remember
// which individual db:migrate-* scripts a given environment still needs.
//
// Each script also keeps its own existing "does this column/table already exist" check as a
// second layer of safety: that's what makes this safe to introduce on a database where some
// migrations were already applied by hand before this tracking table existed — the first run
// finds the change already present, skips making it, and still records the migration as done.

export async function ensureMigrationsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function hasRun(connection, name) {
  const [rows] = await connection.query('SELECT 1 FROM schema_migrations WHERE name = ?', [name]);
  return rows.length > 0;
}

export async function recordMigration(connection, name) {
  await connection.query(
    'INSERT INTO schema_migrations (name) VALUES (?) ON DUPLICATE KEY UPDATE name = name',
    [name]
  );
}
