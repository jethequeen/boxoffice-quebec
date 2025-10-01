// netlify/lib/db.js
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.NETLIFY_DATABASE_URL ?? process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL (or NETLIFY_DATABASE_URL) is missing');

export const sql = neon(DATABASE_URL);
