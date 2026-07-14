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

export function buildPaginatedResponse(key, rows, total, page, limit) {
  return {
    [key]: rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
