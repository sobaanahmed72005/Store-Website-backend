import test, { describe } from 'node:test';
import assert from 'node:assert';
import { performSmartSearch } from '../utils/smartSearch.js';

describe('Smart Search Engine', () => {
  const sampleProducts = [
    { id: 1, name: 'ROMOSS Sense 4S Pro 10000mAh 30W Fast Power Bank', brand: 'ROMOSS', category_name: 'Power Banks', description: 'Portable power bank with 30W fast charging' },
    { id: 2, name: 'Tele Link Gold TLG-3A 20000mAh 22.5W Fast Power Bank', brand: 'Tele Link', category_name: 'Power Banks', description: 'Heavy duty power bank' },
    { id: 3, name: 'TECLAST E30 Pro 30000mAh 22.5W Power Bank', brand: 'TECLAST', category_name: 'Power Banks', description: 'High capacity power bank' },
    { id: 4, name: 'Turbo GENAI Original USB-A to USB-C Cable', brand: 'GENAI', category_name: 'Cables', description: 'Fast charging cable compatible with smartphones and power banks' },
    { id: 5, name: 'Japi Type-C to Type-C Cable 2M', brand: 'Japi', category_name: 'Cables', description: 'Durable charging cable for power banks and adapters' },
  ];

  test('ranks power banks above cables when searching for "power bank"', () => {
    const res = performSmartSearch('test-store', sampleProducts, 'power bank');
    assert.strictEqual(res.results.length > 0, true);
    // Top 3 results should all be actual Power Banks (ids 1, 2, 3), not cables
    const topIds = res.results.slice(0, 3).map((p) => p.id);
    assert.deepStrictEqual(topIds.sort(), [1, 2, 3]);
  });

  test('detects typos and suggests corrected phrase when typo occurs', () => {
    const res = performSmartSearch('test-store', sampleProducts, 'pwer bank');
    assert.strictEqual(res.suggestedQuery, 'Power Bank');
  });

  test('safely handles empty queries', () => {
    const res = performSmartSearch('test-store', sampleProducts, '   ');
    assert.strictEqual(res.results.length, 5);
    assert.strictEqual(res.suggestedQuery, null);
  });
});
