import express from 'express';
import { subscribe, checkStatus, unsubscribe } from '../controllers/newsletterController.js';

const router = express.Router();

router.post('/subscribe', subscribe);
router.get('/status', checkStatus);
router.post('/unsubscribe', unsubscribe);

export default router;