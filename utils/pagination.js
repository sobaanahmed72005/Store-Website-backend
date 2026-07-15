const MAX_LIMIT = 100;

// Shared by every paginated list endpoint — parses ?page=/?limit= into a safe { page, limit,
// offset } triple (limit capped at MAX_LIMIT so a client can't force an unbounded query back
// out through the pagination params themselves), and shapes the response consistently so every
// paginated endpoint has the same fields regardless of resource.
export function parsePagination(req, defaultLimit) {
  const page = Math.max(1, Math.trunc(Number(req.query.page)) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(Number(req.query.limit)) || defaultLimit));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// For endpoints that take a plain "top N" limit rather than full page/offset pagination (the
// reportsController.js chart endpoints) — same clamping idea as parsePagination above, kept
// separate since these have their own, lower default/max (report charts don't need 100 rows).
export function clampLimit(req, defaultLimit, maxLimit = 50) {
  return Math.min(maxLimit, Math.max(1, Math.trunc(Number(req.query.limit)) || defaultLimit));
}

export function buildPaginatedResponse(key, rows, total, page, limit) {
  return {
    [key]: rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
