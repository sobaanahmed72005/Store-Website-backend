import { buildChatContext } from '../utils/chatContext.js';
import { generateChatResponse } from '../services/geminiService.js';
import { logger } from '../utils/logger.js';

/**
 * Handles POST /api/chat requests.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleChatMessage(req, res) {
  try {
    const { message, history } = req.body || {};

    // 1. Input Validation & Sanitization
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Please enter a valid message.' });
    }

    const sanitizedMessage = message
      .trim()
      .slice(0, 500)
      .replace(/<[^>]*>?/gm, ''); // Strip any HTML tags

    if (!sanitizedMessage) {
      return res.status(400).json({ error: 'Please enter a valid message.' });
    }

    // Sanitize conversation history if provided (excluding error fallbacks)
    let sanitizedHistory = [];
    if (Array.isArray(history)) {
      sanitizedHistory = history
        .slice(-10)
        .filter(
          (item) =>
            item &&
            typeof item === 'object' &&
            item.content &&
            !String(item.content).includes('trouble') &&
            !String(item.content).includes('maintenance') &&
            !String(item.content).includes('unavailable')
        )
        .map((item) => ({
          role: item.role === 'user' ? 'user' : 'model',
          content: String(item.content).replace(/<[^>]*>?/gm, '').slice(0, 500),
        }));
    }

    const businessId = req.business?.id || 1;

    // 2. Retrieve Grounded RAG Catalog Context (with graceful fallback)
    let contextText = '';
    try {
      const resContext = await buildChatContext(businessId);
      contextText = resContext.contextText;
    } catch (contextErr) {
      logger.warn({ contextErr }, 'Failed to build full chat context from DB, using fallback context');
      contextText = `=== IT SOLUTIONS PAKISTAN STORE CATALOG & POLICIES ===
Store Name: IT Solutions Pakistan
Phone / Support: +92 300 4265499
Address: Office # 19, 2nd Floor, Fazal Trade Center, Near Hafeez Center, Gulberg III, Lahore, Pakistan
Products: HP Laptops, Dell Latitude Laptops, Lenovo ThinkPads, CCTV Security Cameras, Solar Inverters.
Shipping: Rs. 180 Nationwide Delivery (Free on 1st order). Cash on Delivery (COD) available.
Return Policy: 7-day return/exchange window for defective or incorrect items.
=== END CATALOG ===`;
    }

    // 3. Generate Gemini AI Response
    const reply = await generateChatResponse({
      message: sanitizedMessage,
      chatHistory: sanitizedHistory,
      catalogContext: contextText,
    });

    return res.json({
      reply,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, 'Error in handleChatMessage controller');
    return res.json({
      reply: "Welcome to IT Solutions Pakistan! How can I help you find laptops, CCTV cameras, solar inverters, or check store policies today?",
      timestamp: new Date().toISOString(),
    });
  }
}
