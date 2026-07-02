import { getCurrencyRates } from '../utils/currencyRates.js';

export async function getRates(req, res) {
  const { rates, updatedAt, isFallback } = await getCurrencyRates();
  res.json({ base: 'PKR', rates, updatedAt, isFallback });
}