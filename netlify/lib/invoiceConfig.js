/**
 * Configuration des factures mensuelles remises à Canada First Bricks (CFB).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  👉 REMPLIR LES VALEURS DANS LE BLOC « COORDONNÉES » CI-DESSOUS.           │
 * │  Ce ne sont pas des secrets (elles figurent sur chaque facture), donc      │
 * │  elles vivent ici, dans le code, et non dans des variables Netlify.        │
 * │  Tant qu'une valeur reste « À COMPLÉTER », les PDF portent un filigrane     │
 * │  « BROUILLON » pour éviter d'envoyer une facture incomplète par erreur.     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Deux factures sont produites chaque mois, toutes deux au nom de CFB, en CAD :
 *   - 'CFB' — commission sur les pièces vendues sur la boutique canadienne (CA).
 *   - 'UFB' — commission sur les pièces vendues sur la boutique américaine (US),
 *     dont le brut USD est converti en CAD au taux Banque du Canada du jour de la
 *     facture MOINS un écart (1% par défaut), selon la consigne de Sylvain.
 *
 * (Chaque champ accepte une surcharge par variable d'environnement du même nom si
 *  un jour tu préfères la gérer dans Netlify, mais ce n'est pas nécessaire.)
 */

// ════════════════════════════════════════════════════════════════════════════
//  COORDONNÉES — à remplir
// ════════════════════════════════════════════════════════════════════════════

// L'émetteur de la facture (ton entreprise).
const ISSUER_INFO = {
    name: '9451-4502 QC inc.',
    address: '441, rue Le Corbusier\nBeloeil (Québec) J3G 3N8',
    email: 'jeremie.queenton@gmail.com',       // aussi utilisé comme destinataire par défaut
    gst: '757925409 RT0001',                   // TPS / GST
    qst: '1228939028 TQ0001',                  // TVQ / QST
};

// Client de la facture CFB (ventes canadiennes) — Canada First Bricks.
const CLIENT_INFO = {
    name: 'Canada First Bricks',
    address: '5525, chemin de la Côte-de-Liesse\nSaint-Laurent (Québec) H4P 1A1',
};

// Client de la facture UFB (ventes américaines) — USA First Bricks. Facturé en CAD,
// SANS taxes (exportation vers une entité hors Canada). L'adresse est par défaut la
// même que CFB — à corriger si USA First Bricks a une adresse distincte.
const CLIENT_UFB_INFO = {
    name: 'USA First Bricks',
    address: '5525, chemin de la Côte-de-Liesse\nSaint-Laurent (Québec) H4P 1A1',
};

// Destinataire des courriels de factures. Vide = on retombe sur l'émetteur, puis
// sur ALERT_EMAIL_TO.
const EMAIL_TO = '';

// ════════════════════════════════════════════════════════════════════════════
//  RÈGLES DE CALCUL — à ajuster si Sylvain change d'idée
// ════════════════════════════════════════════════════════════════════════════

// Taxes du Québec. Le montant facturé (les pièces, net de commission) est TAXES
// INCLUSES, donc ces taux servent à EXTRAIRE la TPS/TVQ (voir extractTaxIncluded()).
const TPS_RATE = 0.05;       // TPS / GST
const TVQ_RATE = 0.09975;    // TVQ / QST

// Commission que CFB RETIENT (leur part pour gérer la plateforme). On ne facture PAS
// la commission : CFB nous achète les pièces au brut MOINS cette commission, donc on
// facture le net = ventes brutes × (1 - COMMISSION). 0.25 → on facture 75%.
const COMMISSION = 0.25;

// Frais de conversion appliqué APRÈS la commission, sur le montant net à virer en CAD
// (facture UFB seulement — les ventes US doivent être converties). net × (1 - FRAIS).
const FX_SPREAD_RATE = 0.01;

// Préfixes des numéros de facture → « CFB-2026-06 », « UFB-2026-06 ».
const PREFIX_CFB = 'CFB';
const PREFIX_UFB = 'UFB';

// ════════════════════════════════════════════════════════════════════════════
//  (Reste du fichier — pas besoin d'y toucher)
// ════════════════════════════════════════════════════════════════════════════

// Surcharge optionnelle par variable d'environnement, sinon la valeur du fichier.
const env = (name, fallback) => {
    const v = process.env[name];
    return v && v.trim() ? v.trim() : fallback;
};

export const TAX_RATES = {
    tps: Number(env('INVOICE_TPS_RATE', String(TPS_RATE))),
    tvq: Number(env('INVOICE_TVQ_RATE', String(TVQ_RATE))),
};

export const COMMISSION_RATE = Number(env('INVOICE_COMMISSION_RATE', String(COMMISSION)));

export const FX_SPREAD = Number(env('INVOICE_FX_SPREAD', String(FX_SPREAD_RATE)));

export const ISSUER = {
    name: env('INVOICE_ISSUER_NAME', ISSUER_INFO.name),
    address: env('INVOICE_ISSUER_ADDRESS', ISSUER_INFO.address),
    email: env('INVOICE_ISSUER_EMAIL', ISSUER_INFO.email),
    gst: env('INVOICE_GST_NUMBER', ISSUER_INFO.gst),
    qst: env('INVOICE_QST_NUMBER', ISSUER_INFO.qst),
};

export const CLIENT = {
    name: env('INVOICE_CLIENT_NAME', CLIENT_INFO.name),
    address: env('INVOICE_CLIENT_ADDRESS', CLIENT_INFO.address),
};

export const CLIENT_UFB = {
    name: env('INVOICE_CLIENT_UFB_NAME', CLIENT_UFB_INFO.name),
    address: env('INVOICE_CLIENT_UFB_ADDRESS', CLIENT_UFB_INFO.address),
};

export const INVOICE_KINDS = {
    CFB: {
        source: 'CA',
        store: 'Canada First Bricks',
        client: CLIENT,
        numberPrefix: env('INVOICE_PREFIX_CFB', PREFIX_CFB),
        native: 'CAD',        // ventes déjà en CAD, aucune conversion
        taxable: true,        // client canadien → TPS/TVQ incluses
    },
    UFB: {
        source: 'US',
        store: 'USA First Bricks',
        client: CLIENT_UFB,
        numberPrefix: env('INVOICE_PREFIX_UFB', PREFIX_UFB),
        native: 'USD',        // ventes en USD, converties en CAD à tauxBoC*(1-écart)
        taxable: false,       // client hors Canada (exportation) → aucune taxe
    },
};

// Le courriel qui n'est PAS une coordonnée légale reste surchargée-able en dernier
// recours par ALERT_EMAIL_TO, pour qu'un déploiement neuf atteigne quand même qqn.
const emailToResolved = env('INVOICE_EMAIL_TO', EMAIL_TO) || ISSUER.email;
export const INVOICE_EMAIL_TO =
    /À COMPLÉTER/.test(emailToResolved) ? env('ALERT_EMAIL_TO', '') : emailToResolved;

// Vrai tant que les coordonnées légales ne sont pas remplies — déclenche le
// filigrane « BROUILLON » sur le PDF et un avertissement dans le courriel.
export const isDraftConfig = () =>
    [ISSUER.name, ISSUER.gst, ISSUER.qst, CLIENT.address].some((v) => /À COMPLÉTER/.test(v));
