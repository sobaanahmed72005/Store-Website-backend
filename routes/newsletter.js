import express from 'express';
import { subscribe, checkStatus, unsubscribe } from '../controllers/newsletterController.js';
import { newsletterRateLimit, newsletterLookupRateLimit } from '../middleware/newsletterRateLimit.js';

const router = express.Router();

router.post('/subscribe', newsletterRateLimit, subscribe);
router.get('/status', newsletterLookupRateLimit, checkStatus);
router.post('/unsubscribe', newsletterLookupRateLimit, unsubscribe);

export default router;