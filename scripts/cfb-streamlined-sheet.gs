/**
 * CFB daily inventory webhook — Apps Script for the streamlined sheet.
 *
 * Deployment:
 *   1. In your new spreadsheet: Extensions → Apps Script.
 *   2. Paste this entire file into the editor (replace any existing code.gs).
 *   3. Edit SHEET_NAME below to match the tab name where rows should land
 *      (e.g. "Transactions"). Optionally set SECRET_TOKEN.
 *   4. Save, then Deploy → New deployment → Type: Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   5. Copy the deployment URL.
 *   6. In Netlify → Site settings → Environment variables, add ONE of:
 *        GSHEET_WEBHOOK_URL_OLD   = <deployment URL>   (current legacy sheet)
 *        GSHEET_WEBHOOK_URL_NEW   = <deployment URL>   (future streamlined sheet)
 *      Optionally add the matching GSHEET_WEBHOOK_TOKEN_OLD/_NEW if SECRET_TOKEN is set.
 *
 * On every successful ingest, the Netlify backend POSTs JSON like:
 *   { token, date: "2026-05-08", parts, lots, total, payout, fees, ... }
 *
 * This script appends two rows per call:
 *   1) "ventes" row — Canada First Bricks / CA / QC, lots/parts/total/payout
 *   2) "Frais CFB" row — FT category, dépense = -fees
 * Column L (Taxes) is intentionally not written so any ARRAYFORMULA or
 * per-row tax formula stays intact.
 */

const SHEET_NAME = 'Transactions';   // <-- adjust to your tab name
const SECRET_TOKEN = '';             // <-- optional; leave '' to disable auth

const NOM_VENTES = 'Canada First Bricks';
const COMPTE = 'CFB';
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
        const payout = round2_(Number(payload.payout || 0));
        const fees = round2_(Number(payload.fees || 0));

        const ventesRow = appendVentesRow_(sheet, { date, lots, parts, total, payout });
        let fraisRow = null;
        if (fees > 0) {
            fraisRow = appendFraisRow_(sheet, { date, fees });
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
 * Find the first row where column A is empty. We can't trust getLastRow()
 * because other columns hold ARRAYFORMULAs / per-row formulas that extend the
 * "used range" far past the actual transaction data — using getLastRow() would
 * append rows below the formula tail. Scanning column A puts new rows in the
 * first available data slot so the formulas pick them up.
 */
function firstBlankRowInA_(sheet) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return 2;
    const aValues = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < aValues.length; i++) {
        const v = aValues[i][0];
        if (v === '' || v === null) return i + 2;
    }
    return lastRow + 1;
}

function appendVentesRow_(sheet, v) {
    const row = firstBlankRowInA_(sheet);
    // A:K (cols 1..11) — skip L (Taxes, auto-calculated)
    sheet.getRange(row, 1, 1, 11).setValues([[
        'ventes',          // A Transaction
        '',                // B Catégorie
        '',                // C Dépense
        '',                // D #
        NOM_VENTES,        // E Nom
        'CA',              // F Pays
        'QC',              // G Province
        v.lots,            // H Lots
        v.parts,           // I Pièces
        v.total,           // J Valeur $
        0,                 // K Shipping
    ]]);
    // M:S (cols 13..19)
    sheet.getRange(row, 13, 1, 7).setValues([[
        0,                 // M Frais (P ou S)
        v.payout,          // N Argent reçu
        '',                // O ID
        '',                // P (no header)
        '',                // Q Fait?
        COMPTE,            // R Compte
        v.date,            // S Date
    ]]);
    return row;
}

function appendFraisRow_(sheet, v) {
    const row = firstBlankRowInA_(sheet);
    sheet.getRange(row, 1, 1, 11).setValues([[
        'Frais CFB',       // A Transaction
        CATEGORIE_FRAIS,   // B Catégorie
        -v.fees,           // C Dépense — negative per accounting convention
        '',                // D #
        '',                // E Nom
        '',                // F Pays
        '',                // G Province
        '',                // H Lots
        '',                // I Pièces
        '',                // J Valeur $
        '',                // K Shipping
    ]]);
    sheet.getRange(row, 13, 1, 7).setValues([[
        '',                // M Frais (P ou S)
        '',                // N Argent reçu
        '',                // O ID
        '',                // P
        '',                // Q Fait?
        COMPTE,            // R Compte
        v.date,            // S Date
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
 * can find the sheet and append a dummy row. Delete the row afterward.
 */
function testAppendDummy() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) throw new Error('sheet "' + SHEET_NAME + '" not found');
    const date = new Date();
    appendVentesRow_(sheet, { date, lots: 1, parts: 1, total: 0.01, payout: 0.01 });
    appendFraisRow_(sheet, { date, fees: 0.01 });
}
