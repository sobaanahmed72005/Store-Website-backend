const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT', 'ENOTFOUND',
  'ER_ACCESS_DENIED_ERROR', 'POOL_CLOSED', 'POOL_ENQUEUELIMIT',
]);

// True for raw mysql2/driver-level errors (query-level via sqlMessage/sqlState, or
// connection-level via err.code) whose default `message` can echo back schema or
// infrastructure details (query text, host, port) and so shouldn't reach an HTTP response.
export function isDbError(err) {
  return Boolean(err?.sqlMessage || err?.sqlState || CONNECTION_ERROR_CODES.has(err?.code));
}
