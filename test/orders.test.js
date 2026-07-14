import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pool from '../config/db.js';
import { request, newAgent, cleanupTestUsers, uniqueEmail } from './_support/helpers.js';

const PASSWORD = 'testpass123';
let businessId;
let productA; // price 1000, stock 10
let productB; // price 500, stock 2 (deliberately low, for the insufficient-stock test)

async function registerCustomer(prefix) {
  const agent = newAgent();
  const email = uniqueEmail(prefix);
  await agent.post('/api/auth/register').send({ name: 'Order Test', email, password: PASSWORD });
  return agent;
}

describe('cart and orders', () => {
  before(async () => {
    const [[business]] = await pool.query("SELECT id FROM businesses WHERE slug = 'main'");
    businessId = business.id;

    await pool.query(
      "INSERT INTO site_content (business_id, content_key, value) VALUES (?, 'payment-settings', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)",
      [businessId, JSON.stringify({
        methods: {
          cod: { enabled: true, label: 'Cash on Delivery' },
          bank_transfer: { enabled: true, label: 'Bank Transfer' },
        },
      })]
    );

    const [[a]] = await pool.query(
      "INSERT INTO products (business_id, name, slug, price, stock) VALUES (?, 'Test Product A', ?, 1000, 10)",
      [businessId, `test-product-a-${Date.now()}`]
    ).then(async ([result]) => pool.query('SELECT id, price, stock FROM products WHERE id = ?', [result.insertId]));
    productA = a;

    const [[b]] = await pool.query(
      "INSERT INTO products (business_id, name, slug, price, stock) VALUES (?, 'Test Product B', ?, 500, 2)",
      [businessId, `test-product-b-${Date.now()}`]
    ).then(async ([result]) => pool.query('SELECT id, price, stock FROM products WHERE id = ?', [result.insertId]));
    productB = b;
  });

  after(async () => {
    await pool.query('DELETE FROM order_items WHERE product_ref IN (?, ?)', [String(productA.id), String(productB.id)]);
    await pool.query('DELETE FROM orders WHERE business_id = ? AND shipping_address LIKE ?', [businessId, 'Test Address%']);
    await pool.query('DELETE FROM discount_code_redemptions WHERE discount_code_id IN (SELECT id FROM discount_codes WHERE code LIKE ?)', ['TEST-%']);
    await pool.query('DELETE FROM discount_codes WHERE code LIKE ?', ['TEST-%']);
    await pool.query('DELETE FROM products WHERE id IN (?, ?)', [productA.id, productB.id]);
    await pool.query("DELETE FROM site_content WHERE business_id = ? AND content_key = 'payment-settings'", [businessId]);
    await cleanupTestUsers();
    await pool.end();
  });

  describe('PUT /api/cart/:userId', () => {
    it('rejects a cart item missing a title', async () => {
      const agent = await registerCustomer('cart1');
      const me = await agent.get('/api/auth/me');
      const res = await agent.put(`/api/cart/${me.body.user.id}`).send({ items: [{ id: productA.id, price: 1000, qty: 1 }] });
      assert.equal(res.status, 400);
    });

    it('rejects a negative price', async () => {
      const agent = await registerCustomer('cart2');
      const me = await agent.get('/api/auth/me');
      const res = await agent.put(`/api/cart/${me.body.user.id}`).send({ items: [{ id: productA.id, title: 'A', price: -5, qty: 1 }] });
      assert.equal(res.status, 400);
    });

    it('merges duplicate product ids into one line with summed quantity', async () => {
      const agent = await registerCustomer('cart3');
      const me = await agent.get('/api/auth/me');
      const res = await agent.put(`/api/cart/${me.body.user.id}`).send({
        items: [
          { id: productA.id, title: 'Test Product A', price: 1000, qty: 2 },
          { id: productA.id, title: 'Test Product A', price: 1000, qty: 3 },
        ],
      });
      assert.equal(res.status, 200);

      const cart = await agent.get(`/api/cart/${me.body.user.id}`);
      assert.equal(cart.body.length, 1);
      assert.equal(cart.body[0].quantity, 5);
    });
  });

  describe('POST /api/orders', () => {
    it('rejects an order missing required fields', async () => {
      const agent = await registerCustomer('order1');
      const res = await agent.post('/api/orders').send({ items: [{ id: productA.id, quantity: 1 }] });
      assert.equal(res.status, 400);
    });

    it('rejects an invalid/disabled payment method', async () => {
      const agent = await registerCustomer('order2');
      const res = await agent.post('/api/orders').send({
        shipping_address: 'Test Address 1', phone: '03001234567',
        items: [{ id: productA.id, quantity: 1 }], payment_method: 'jazzcash',
      });
      assert.equal(res.status, 400);
    });

    it('creates a COD order and prices it from the real product price, not a client-supplied one', async () => {
      const agent = await registerCustomer('order3');
      // Client claims the item costs 1 — the server must ignore this and use productA's real
      // price (1000) instead. This is the core protection against a tampered checkout request.
      const res = await agent.post('/api/orders').send({
        shipping_address: 'Test Address 2', phone: '03001234567',
        items: [{ id: productA.id, quantity: 2, price: 1 }], payment_method: 'cod',
      });
      assert.equal(res.status, 201);
      // 2 * 1000 (real price) + 1800 (default shipping) = 3800, not 2 * 1 + 1800 = 1802
      assert.equal(res.body.total_amount, 3800);
    });

    it('rejects an order that exceeds available stock, without decrementing it', async () => {
      const agent = await registerCustomer('order4');
      const res = await agent.post('/api/orders').send({
        shipping_address: 'Test Address 3', phone: '03001234567',
        items: [{ id: productB.id, quantity: 5 }], payment_method: 'cod', // only 2 in stock
      });
      assert.equal(res.status, 400);

      const [[stillStocked]] = await pool.query('SELECT stock FROM products WHERE id = ?', [productB.id]);
      assert.equal(stillStocked.stock, 2);
    });

    it('requires a transaction reference and proof screenshot for a non-COD payment method', async () => {
      const agent = await registerCustomer('order5');
      const res = await agent.post('/api/orders').send({
        shipping_address: 'Test Address 4', phone: '03001234567',
        items: [{ id: productA.id, quantity: 1 }], payment_method: 'bank_transfer',
      });
      assert.equal(res.status, 400);
    });

    it('rejects a fabricated payment_proof_image that was never actually uploaded', async () => {
      const agent = await registerCustomer('order6');
      const res = await agent.post('/api/orders').send({
        shipping_address: 'Test Address 5', phone: '03001234567',
        items: [{ id: productA.id, quantity: 1 }], payment_method: 'bank_transfer',
        payment_reference: 'FAKE-REF-1', payment_proof_image: '/orders/payment-proof/9999999999999-999999999.png',
      });
      assert.equal(res.status, 400);
    });
  });

  describe('discount codes', () => {
    let singleUseCodeId;

    before(async () => {
      const [result] = await pool.query(
        "INSERT INTO discount_codes (business_id, code, discount_type, discount_value, is_active, reusable) VALUES (?, 'TEST-SINGLE10', 'fixed', 100, 1, 0)",
        [businessId]
      );
      singleUseCodeId = result.insertId;
    });

    after(async () => {
      await pool.query('DELETE FROM discount_code_redemptions WHERE discount_code_id = ?', [singleUseCodeId]);
      await pool.query('DELETE FROM discount_codes WHERE id = ?', [singleUseCodeId]);
    });

    it('applies a valid single-use code to an order', async () => {
      const agent = await registerCustomer('discount1');
      const res = await agent.post('/api/orders').send({
        shipping_address: 'Test Address 6', phone: '03001234567',
        items: [{ id: productA.id, quantity: 1 }], payment_method: 'cod', discount_code: 'TEST-SINGLE10',
      });
      assert.equal(res.status, 201);
      // 1000 - 100 discount + 1800 shipping = 2700
      assert.equal(res.body.total_amount, 2700);
    });

    it('rejects reusing a single-use code for the same user, with a friendly message not a raw 500', async () => {
      const agent = await registerCustomer('discount2');
      const first = await agent.post('/api/orders').send({
        shipping_address: 'Test Address 7', phone: '03001234567',
        items: [{ id: productA.id, quantity: 1 }], payment_method: 'cod', discount_code: 'TEST-SINGLE10',
      });
      assert.equal(first.status, 201);

      const second = await agent.post('/api/orders').send({
        shipping_address: 'Test Address 8', phone: '03001234567',
        items: [{ id: productA.id, quantity: 1 }], payment_method: 'cod', discount_code: 'TEST-SINGLE10',
      });
      assert.equal(second.status, 400);
      assert.match(second.body.error, /already used/i);
    });

    it('rejects an unknown discount code', async () => {
      const agent = await registerCustomer('discount3');
      const res = await agent.post('/api/orders').send({
        shipping_address: 'Test Address 9', phone: '03001234567',
        items: [{ id: productA.id, quantity: 1 }], payment_method: 'cod', discount_code: 'NOT-A-REAL-CODE',
      });
      assert.equal(res.status, 400);
    });
  });
});
