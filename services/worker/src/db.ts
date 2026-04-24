import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { Redis } from 'ioredis';

export const pool = new pg.Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://felt:felt@localhost:5432/felt',
  max: 5,
});

export const db = drizzle(pool);

export const connection = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
