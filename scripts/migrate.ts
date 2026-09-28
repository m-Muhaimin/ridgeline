import { Client } from '@neondatabase/serverless';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL is not set in environment!');
  process.exit(1);
}

async function runMigration() {
  console.log('Connecting to Neon Lakebase Postgres...');
  const client = new Client({ connectionString });
  await client.connect();

  try {
    // Create app schema, functions, and tenant role if not already present
    await client.query('CREATE SCHEMA IF NOT EXISTS app;');
    await client.query(`
      CREATE OR REPLACE FUNCTION app.current_organization_id() RETURNS UUID AS $$
      BEGIN
        RETURN NULLIF(current_setting('app.current_organization_id', true), '')::UUID;
      EXCEPTION
        WHEN OTHERS THEN RETURN NULL;
      END;
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

      CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS UUID AS $$
      BEGIN
        RETURN NULLIF(current_setting('app.current_user_id', true), '')::UUID;
      EXCEPTION
        WHEN OTHERS THEN RETURN NULL;
      END;
      $$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

      DO $$ BEGIN
        CREATE ROLE ridgeline_app WITH NOLOGIN;
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Applied-migration tracking. Without it this script is a fresh-install
    // script: re-running the init file fails with 42710 duplicate_object
    // because it adds foreign keys unconditionally.
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.resolve(process.cwd(), 'supabase/migrations');
    const migrationFiles = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

    if (migrationFiles.length === 0) {
        throw new Error(`No .sql migration files found in ${migrationsDir}`);
    }

    // Databases created before tracking existed have no rows, so bootstrap the
    // init file as already applied when its tables are actually present.
    const legacy = await client.query(
        `SELECT to_regclass('public.job_bookings') IS NOT NULL AS present`,
    );
    if (legacy.rows[0].present) {
        await client.query(
            `INSERT INTO public.schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
            [migrationFiles[0]],
        );
    }

    for (const file of migrationFiles) {
        const done = await client.query(
            'SELECT 1 FROM public.schema_migrations WHERE filename = $1',
            [file],
        );
        if (done.rows.length > 0) {
            console.log(`Skipping ${file} (already applied)`);
            continue;
        }

        const migrationContent = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        console.log(`Applying ${file}...`);
        // One transaction per migration: either the whole file lands and gets
        // recorded, or nothing changes.
        await client.query('BEGIN');
        try {
            await client.query(migrationContent);
            await client.query(
                'INSERT INTO public.schema_migrations (filename) VALUES ($1)',
                [file],
            );
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw new Error(`Migration ${file} failed and was rolled back: ${(err as Error).message}`);
        }
        console.log(`Applied ${file}`);
    }
    console.log('All migrations applied to Neon Lakebase Postgres!');

    // Verify tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log('Created tables:', tablesRes.rows.map((r: any) => r.table_name));

    const orgCount = await client.query('SELECT count(*) FROM public.organizations;');
    console.log('Organizations count:', orgCount.rows[0].count);

    const bookingsCount = await client.query('SELECT count(*) FROM public.job_bookings;');
    console.log('Bookings count:', bookingsCount.rows[0].count);
  } finally {
    await client.end();
  }
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
