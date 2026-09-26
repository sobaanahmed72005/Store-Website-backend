import express from 'express';
import { chatRateLimiter } from '../middleware/chatRateLimit.js';
import { handleChatMessage } from '../controllers/chatController.js';

const router = express.Router();

// POST /api/chat — Public storefront AI chatbot endpoint with rate limiting & sanitization
router.post('/', chatRateLimiter, handleChatMessage);

export default router;
