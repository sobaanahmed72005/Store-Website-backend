import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateCode } from '../controllers/discountCodesController.js';

const router = express.Router();

router.post('/validate', requireAuth, validateCode);

export default router;