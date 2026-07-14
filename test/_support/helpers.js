import supertest from 'supertest';
import app from '../../app.js';
import pool from '../../config/db.js';

export const request = supertest(app);

// A plain `request` call doesn't persist cookies between calls — each one is independent. Any
// test flow that logs in and then needs that session on a later request (checking /me, logging
// out, refreshing) needs its own agent so cookies from one test's login can't leak into another.
export function newAgent() {
  return supertest.agent(app);
}

// sessions.user_id has ON DELETE CASCADE (see sql/schema.sql), so deleting the user is enough
// to clean up their sessions too. Matches on the test-user email prefix so a previous run that
// crashed before its own cleanup ran doesn't leave users accumulating in czone_test forever.
export async function cleanupTestUsers() {
  await pool.query("DELETE FROM users WHERE email LIKE 'test-%@example.com'");
}

let counter = 0;
export function uniqueEmail(prefix) {
  counter += 1;
  return `test-${prefix}-${Date.now()}-${counter}@example.com`;
}
