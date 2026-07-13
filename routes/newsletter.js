import express from 'express';
import { subscribe, checkStatus, unsubscribe } from '../controllers/newsletterController.js';
import { newsletterRateLimit } from '../middleware/newsletterRateLimit.js';

const router = express.Router();

router.post('/subscribe', newsletterRateLimit, subscribe);
router.get('/status', checkStatus);
router.post('/unsubscribe', unsubscribe);

export default router;