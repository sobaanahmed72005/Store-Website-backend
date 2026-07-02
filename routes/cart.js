import express from 'express';
import { getCart, replaceCart } from '../controllers/cartController.js';
import { requireSelfOrAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/:userId', requireSelfOrAdmin('userId'), getCart);
router.put('/:userId', requireSelfOrAdmin('userId'), replaceCart);

export default router;
