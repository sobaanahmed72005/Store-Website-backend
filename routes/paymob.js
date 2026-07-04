import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getEnabled, createSession } from '../controllers/paymobController.js';

const router = express.Router();

router.get('/enabled', getEnabled);
router.post('/session', requireAuth, createSession);

export default router;
