import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { config } from '../config.js';
import * as schema from './schema.js';

// Vercel runs short-lived functions behind Supabase's pooler: one connection each, no prepared statements.
const serverless = Boolean(process.env.VERCEL);
export const sql = postgres(config.DATABASE_URL, { max: serverless ? 1 : 10, prepare: !serverless });
export const db = drizzle(sql, { schema });
export type DB = typeof db;
