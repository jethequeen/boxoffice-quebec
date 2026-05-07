// Sanity check for loadReportForm field detection.
// Stubs global fetch with a synthetic /new HTML so we can run offline.
import * as cheerio from 'cheerio';

const FORM_HTML = `<!DOCTYPE html><html><head>
<meta name="csrf-token" content="TEST_CSRF">
</head><body>
<form action="/bricklink/inventory_vendor_reports" method="post">
  <input name="_csrf_token" type="hidden" value="TEST_CSRF">
  <select name="generate_inventory_vendor_report[vendor_id]">
    <option value="97411bf0-2c3c-4c33-8e81-1f1ce5c2b14a">Bino</option>
  </select>
  <input name="generate_inventory_vendor_report[from]" type="date" value="2026-05-01">
  <input name="generate_inventory_vendor_report[to]" type="date" value="2026-05-07">
  <button type="submit">Generate</button>
</form>
</body></html>`;

global.fetch = async (url) => {
    if (url.includes('/new')) {
        return { ok: true, status: 200, statusText: 'OK', text: async () => FORM_HTML, headers: new Map() };
    }
    return { ok: true, status: 200, statusText: 'OK', text: async () => '', headers: new Map() };
};

process.env.CFB_COOKIE = 'fake';

const { loadReportForm } = await import('../netlify/lib/cfb.js');
const result = await loadReportForm();
console.log(JSON.stringify(result, null, 2));
