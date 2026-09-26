import rateLimit from 'express-rate-limit';

/**
 * Rate limiter middleware for the AI Chatbot endpoint.
 *
 * Limits:
 * - 10 requests per minute per IP window (prevents rapid-fire automated spam)
 * - Standardized JSON error response when limit is exceeded
 */
export const chatRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: 10, // Max 10 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "You are typing a bit fast! Please wait a few seconds before asking another question.",
      retryAfterSeconds: 30,
    });
  },
});
