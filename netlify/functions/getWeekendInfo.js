import { sql } from '../lib/db.js';
import { defaultHeaders, jsonResponse } from '../lib/http.js';

export const handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: defaultHeaders };
    }

    try {
        const {weekendId } = event.queryStringParameters || {};
        if (!weekendId) return jsonResponse(400, { error: 'weekendId is required' });
        const rows = await sql/*sql*/`
      SELECT *
      FROM weekends w
      WHERE w.id = ${weekendId}
    `;

        return jsonResponse(200, { data: rows, weekendId, count: rows.length });
    } catch (err) {
        console.error('Error fetching weekend info:', err);
        return jsonResponse(500, {
            error: 'Erreur lors de la récupération des données box-office',
            details: err.message,
            timestamp: new Date().toISOString(),
            function: 'getBoxOfficeData',
        });
    }
};
