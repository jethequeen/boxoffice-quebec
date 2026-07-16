/**
 * CFB daily inventory webhook — Apps Script for the "Journal officiel" sheet
 * (Comptabilité Binobrick).
 *
 * Deployment:
 *   1. In the spreadsheet: Extensions → Apps Script.
 *   2. Paste this entire file into the editor (replace any existing Code.gs).
 *   3. Check SHEET_NAME below matches the tab name ("Journal officiel").
 *      Optionally set SECRET_TOKEN.
 *   4. Save, then Deploy → New deployment → Type: Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   5. Copy the deployment URL.
 *   6. In Netlify → Site settings → Environment variables, add:
 *        GSHEET_WEBHOOK_URL_NEW   = <deployment URL>
 *      and, if SECRET_TOKEN is set, GSHEET_WEBHOOK_TOKEN_NEW = <token>.
 *      (The legacy sheet keeps its own GSHEET_WEBHOOK_URL_OLD; both fire in
 *      parallel during the migration — see netlify/lib/sheets.js.)
 *
 * On every successful ingest, the Netlify backend POSTs JSON like:
 *   { token, source, date: "2026-06-15", parts, lots, total, payout, fees }
 * The weekly job POSTs TWICE — once with source "CA" and once with source "US" —
 * because the two do NOT share tax rules: the CA payout is taxable (TPS/TVQ added
 * on top) while US sales are zero-rated exports.
 *
 * This script appends two rows per call to the journal, suffixed by the source:
 *   1) "Ventes - CA"    — catégorie V,  Montant = total (brut, HORS TAXES), + lots/pièces
 *   2) "Frais CFB - CA" — catégorie FT, Montant = -fees
 * (or "… - US" for the US POST). Net of each pair (total - fees) = that source's
 * payout, hors taxes.
 *
 * TAX FORMULAS (columns J/K, owned by the sheet): compute the taxes ON TOP of the
 * CA payout — i.e. 15% (TPS 5% + TVQ 9.975%) of the NET of the CA pair
 * (Ventes - CA + Frais CFB - CA), and 0% for the US rows. Do NOT extract taxes
 * from the Montant: every amount posted here is already hors taxes.
 *
 * IMPORTANT — formula columns are never written:
 *   F  Compte débiteur   (VLOOKUP, only for TF transfers)
 *   G  Description       (manual)
 *   J  TPS / K  TVQ      (auto-calculated taxes)
 *   L  CFB / M  CH / N  CC   (running account balances)
 * The script only sets A:E (Transaction..Date) and H:I (Lots, Pièces), so any
 * fill-down / ARRAYFORMULA in those columns stays intact. Make sure those
 * formula columns are filled down far enough (or are ARRAYFORMULAs) to cover
 * the rows being appended.
 */

const SHEET_NAME = 'Journal officiel';   // <-- tab name in Comptabilité Binobrick
const SECRET_TOKEN = '';                 // <-- optional; leave '' to disable auth

const NOM_VENTES = 'Ventes';
const NOM_FRAIS = 'Frais CFB';
const COMPTE = 'CFB';
const CATEGORIE_VENTES = 'V';
const CATEGORIE_FRAIS = 'FT';

function doPost(e) {
    const lock = LockService.getDocumentLock();
    try {
        lock.waitLock(30000);

        const payload = JSON.parse(e.postData.contents);

        if (SECRET_TOKEN && payload.token !== SECRET_TOKEN) {
            return jsonOut_({ ok: false, error: 'unauthorized' });
        }

        if (!payload.date) {
            return jsonOut_({ ok: false, error: 'missing date' });
        }

        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
        if (!sheet) {
            return jsonOut_({ ok: false, error: 'sheet "' + SHEET_NAME + '" not found' });
        }

        const date = parseYmd_(payload.date);
        const lots = Number(payload.lots || 0);
        const parts = Number(payload.parts || 0);
        const total = round2_(Number(payload.total || 0));
        const fees = round2_(Number(payload.fees || 0));
        // Source suffix so the sheet's tax formulas can tell CA (taxable) from US
        // (zero-rated export) rows apart. Defaults to CA for older callers.
        const source = String(payload.source || 'CA').toUpperCase();
        const nomVentes = NOM_VENTES + ' - ' + source;
        const nomFrais = NOM_FRAIS + ' - ' + source;

        // Pre-compute both target rows in a single scan so they end up
        // consecutive, immediately after the last A-populated row.
        const [vRow, fRow] = nextDataRows_(sheet, 2);
        const ventesRow = appendVentesRow_(sheet, vRow, { date, lots, parts, total, nom: nomVentes });
        let fraisRow = null;
        if (fees > 0) {
            fraisRow = appendFraisRow_(sheet, fRow, { date, fees, nom: nomFrais });
        }

        SpreadsheetApp.flush();
        return jsonOut_({ ok: true, ventesRow, fraisRow, date: payload.date });
    } catch (err) {
        return jsonOut_({ ok: false, error: String(err && err.message || err) });
    } finally {
        try { lock.releaseLock(); } catch (e2) { /* ignore */ }
    }
}

/**
 * Returns `n` consecutive row numbers immediately after the last A-populated
 * row. We scan column A from the BOTTOM up — scanning top-down would slot
 * rows into any historical gap (a blank A cell mid-sheet) instead of
 * appending after the latest transaction. We can't use getLastRow() either
 * because formulas in other columns extend the used range past the data.
 */
function nextDataRows_(sheet, n) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return Array.from({ length: n }, function (_, i) { return 2 + i; });
    const aValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = aValues.length - 1; i >= 0; i--) {
        const v = aValues[i][0];
        if (v !== '' && v !== null) {
            const start = i + 3;  // (i + 2) is the row of the last data; +1 lands on the row below
            return Array.from({ length: n }, function (_, k) { return start + k; });
        }
    }
    return Array.from({ length: n }, function (_, i) { return 2 + i; });
}

function appendVentesRow_(sheet, row, v) {
    // A:E (cols 1..5) — skip F (Compte débiteur) and G (Description), both formula/manual
    sheet.getRange(row, 1, 1, 5).setValues([[
        v.nom || NOM_VENTES,   // A Transaction ("Ventes - CA" / "Ventes - US")
        CATEGORIE_VENTES,      // B Catégorie
        v.total,               // C Montant (brut, hors taxes)
        COMPTE,                // D Compte
        v.date,                // E Date
    ]]);
    // H:I (cols 8..9) — skip J onward (TPS/TVQ/soldes, all auto-calculated)
    sheet.getRange(row, 8, 1, 2).setValues([[
        v.lots,            // H Lots
        v.parts,           // I Pièces
    ]]);
    return row;
}

function appendFraisRow_(sheet, row, v) {
    // A:E only — Frais carries no lots/pièces, so H:I are left untouched (blank).
    sheet.getRange(row, 1, 1, 5).setValues([[
        v.nom || NOM_FRAIS,    // A Transaction ("Frais CFB - CA" / "Frais CFB - US")
        CATEGORIE_FRAIS,       // B Catégorie
        -v.fees,               // C Montant — negative per accounting convention
        COMPTE,                // D Compte
        v.date,                // E Date
    ]]);
    return row;
}

function parseYmd_(s) {
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return new Date(s);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function round2_(n) {
    return Math.round(Number(n || 0) * 100) / 100;
}

function jsonOut_(obj) {
    return ContentService
        .createTextOutput(JSON.stringify(obj))
        .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Optional: run this once from the Apps Script editor to verify the script
 * can find the sheet and append a dummy pair of rows. Delete them afterward.
 */
function testAppendDummy() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('sheet "' + SHEET_NAME + '" not found');
    const date = new Date();
    const [vRow, fRow] = nextDataRows_(sheet, 2);
    appendVentesRow_(sheet, vRow, { date, lots: 1, parts: 1, total: 0.01 });
    appendFraisRow_(sheet, fRow, { date, fees: 0.01 });
}
