import { getCurrencyRates } from '../utils/currencyRates.js';

export async function getRates(req, res) {
  try {
    const { rates, updatedAt } = await getCurrencyRates();
    res.json({ base: 'PKR', rates, updatedAt });
  } catch (err) {
    res.status(503).json({ error: 'Currency rates are temporarily unavailable' });
  }
}