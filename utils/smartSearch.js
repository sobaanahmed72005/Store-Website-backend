import Fuse from 'fuse.js';

// Cache for search indices per business to avoid rebuilding index on every request
const indexCache = new Map(); // businessId -> { at, products, fuse, dictFuse, dictionary }
const CACHE_TTL_MS = 60 * 1000; // 1 minute TTL

/**
 * Normalizes input search query string safely
 */
function sanitizeSearchQuery(query) {
  if (typeof query !== 'string') return '';
  return query
    .trim()
    .slice(0, 100) // Prevent arbitrarily long string attacks
    .replace(/[^\w\s\-\.\/\+]/gi, ' ') // Replace unexpected control characters
    .replace(/\s+/g, ' ');
}

/**
 * Builds or retrieves a cached Fuse.js search index for a list of products
 */
export function getSearchIndex(businessId, products) {
  const cached = indexCache.get(businessId);
  const now = Date.now();

  if (cached && now - cached.at < CACHE_TTL_MS && cached.products === products) {
    return cached;
  }

  // Extract a dictionary of known catalog words (titles, categories, brands)
  const dictionarySet = new Set();
  for (const p of products) {
    if (p.name) {
      p.name
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .forEach((w) => w.length >= 3 && dictionarySet.add(w.toLowerCase()));
    }
    if (p.brand) dictionarySet.add(p.brand.toLowerCase());
    if (p.category_name) dictionarySet.add(p.category_name.toLowerCase());
  }

  const fuseOptions = {
    keys: [
      { name: 'name', weight: 0.65 },
      { name: 'brand', weight: 0.15 },
      { name: 'category_name', weight: 0.15 },
      { name: 'description', weight: 0.05 },
    ],
    threshold: 0.45,
    distance: 1000,
    minMatchCharLength: 2,
    includeScore: true,
    ignoreLocation: true,
    useExtendedSearch: false,
  };

  const fuse = new Fuse(products, fuseOptions);

  // Fuse index for single-word dictionary spellcheck
  const dictFuse = new Fuse(Array.from(dictionarySet), {
    threshold: 0.45,
    distance: 100,
    ignoreLocation: true,
    minMatchCharLength: 2,
  });

  const entry = { at: now, products, fuse, dictFuse, dictionary: dictionarySet };
  indexCache.set(businessId, entry);
  return entry;
}

/**
 * Performs a smart, typo-tolerant search over an array of products
 */
export function performSmartSearch(businessId, products, rawQuery) {
  const query = sanitizeSearchQuery(rawQuery);
  if (!query) {
    return {
      results: products,
      suggestedQuery: null,
      isCorrected: false,
      total: products.length,
    };
  }

  const { fuse, dictFuse } = getSearchIndex(businessId, products);
  const searchResults = fuse.search(query);
  let matchedProducts = searchResults.map((res) => res.item);

  // Check if query had a typo and can be suggested or corrected
  const queryWords = query.toLowerCase().split(/\s+/);
  const correctedWords = queryWords.map((word) => {
    if (word.length <= 2) return word;
    const match = dictFuse.search(word);
    if (match.length > 0 && match[0].item !== word) {
      return match[0].item; // Best dictionary match
    }
    return word;
  });

  const suggestedPhrase = correctedWords.join(' ');
  let suggestedQuery = null;
  let isCorrected = false;

  if (suggestedPhrase !== query.toLowerCase()) {
    suggestedQuery = capitalizeWords(suggestedPhrase);
    const fallbackResults = fuse.search(suggestedPhrase);
    const fallbackProducts = fallbackResults.map((res) => res.item);

    // If query had typos, use the corrected search results if available
    if (fallbackProducts.length > 0) {
      matchedProducts = fallbackProducts;
      isCorrected = true;
    }
  }

  return {
    results: matchedProducts,
    suggestedQuery,
    isCorrected,
    originalQuery: query,
    total: matchedProducts.length,
  };
}

function capitalizeWords(str) {
  return str.replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Invalidates the search cache for a business (e.g. when products are created/updated)
 */
export function invalidateSearchCache(businessId) {
  if (businessId) {
    indexCache.delete(businessId);
  } else {
    indexCache.clear();
  }
}
