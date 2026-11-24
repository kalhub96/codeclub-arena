import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client.js';

export async function runMigrations() {
  await migrate(db, { migrationsFolder: 'drizzle' });
}

// Allow `npm run db:migrate`
if (process.argv[1]?.endsWith('migrate.ts')) {
  runMigrations()
    .then(() => {
      console.log('Migrations applied');
      return sql.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
