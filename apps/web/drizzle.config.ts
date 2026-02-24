import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/server/db/schema.ts',
  out: './src/lib/server/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://felt:felt@localhost:5432/felt',
  },
  verbose: true,
  strict: true,
});
