import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request } from './_support/helpers.js';

describe('POST /api/chat', () => {
  it('rejects empty message with 400 Bad Request', async () => {
    const res = await request.post('/api/chat').send({ message: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Please enter a valid message.');
  });

  it('rejects whitespace-only message with 400 Bad Request', async () => {
    const res = await request.post('/api/chat').send({ message: '   ' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Please enter a valid message.');
  });

  it('accepts valid message and returns reply and ISO timestamp', async () => {
    const res = await request.post('/api/chat').send({
      message: 'What laptops do you sell?',
      history: [{ role: 'user', content: 'Hello' }],
    });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.reply === 'string');
    assert.ok(res.body.reply.length > 0);
    assert.ok(typeof res.body.timestamp === 'string');
  });

  it('sanitizes HTML tags in user query', async () => {
    const res = await request.post('/api/chat').send({
      message: '<script>alert("xss")</script>Do you sell CCTV cameras?',
    });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.reply === 'string');
  });
});
