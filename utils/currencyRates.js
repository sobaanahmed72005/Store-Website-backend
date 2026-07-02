const RATES_URL = 'https://open.er-api.com/v6/latest/PKR';
const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FALLBACK_RATES = { PKR: 1, USD: 0.0036, GBP: 0.0027, EUR: 0.0032, AED: 0.0132, SAR: 0.0135, CAD: 0.005, AUD: 0.0055 };

let cache = { rates: FALLBACK_RATES, updatedAt: null, isFallback: true };
let lastFetchAttempt = 0;

async function fetchLiveRates() {
  const res = await fetch(RATES_URL);
  if (!res.ok) throw new Error(`Exchange rate API responded with ${res.status}`);
  const data = await res.json();
  if (data.result !== 'success' || !data.rates) throw new Error('Unexpected exchange rate API response');
  return data.rates;
}

export async function getCurrencyRates() {
  const now = Date.now();
  const isStale = !cache.updatedAt || now - cache.updatedAt > REFRESH_INTERVAL_MS;
  const recentlyTried = now - lastFetchAttempt < 60 * 1000;

  if (isStale && !recentlyTried) {
    lastFetchAttempt = now;
    try {
      const rates = await fetchLiveRates();
      cache = { rates, updatedAt: now, isFallback: false };
    } catch (err) {
      console.error('Failed to refresh currency rates, using last known rates:', err.message);
    }
  }

  return cache;
}