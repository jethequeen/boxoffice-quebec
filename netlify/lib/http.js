export const defaultHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export const jsonResponse = (statusCode, body) => ({
    statusCode,
    headers: defaultHeaders,
    body: JSON.stringify(body),
});
