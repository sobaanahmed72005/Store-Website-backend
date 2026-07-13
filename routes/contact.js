import express from 'express';
import { sendMessage } from '../controllers/contactController.js';
import { contactRateLimit } from '../middleware/contactRateLimit.js';

const router = express.Router();

router.post('/', contactRateLimit, sendMessage);

export default router;
