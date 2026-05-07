import { readFileSync } from 'node:fs';
import { parseReportRows, aggregateRows, decrementsFromRows } from '../netlify/lib/cfb.js';

const html = readFileSync('Accueil · CFB Mocs.html', 'utf8');

console.log('=== Full parse (no date filter) ===');
const all = parseReportRows(html, null);
console.log('dateRange:', all.dateRange);
console.log('sections:', all.sections);
console.log('row count:', all.rows.length);
console.log('first row:', all.rows[0]);
console.log();

console.log('=== Filtered to 2026-05-06 ===');
const today = parseReportRows(html, '2026-05-06');
console.log('row count:', today.rows.length);
console.log('aggregated totals:', aggregateRows(today.rows));
console.log('decrements:', decrementsFromRows(today.rows));
