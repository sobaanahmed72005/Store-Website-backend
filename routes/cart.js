import express from 'express';
import { getCart, replaceCart } from '../controllers/cartController.js';
import { requireSelfOrAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/:userId', requireSelfOrAdmin('userId'), getCart);
router.put('/:userId', requireSelfOrAdmin('userId'), replaceCart);
// Same handler as the PUT above — this exists only because navigator.sendBeacon (used by the
// frontend to flush a pending cart sync as the page unloads, since a normal fetch would get
// cancelled) can only send POST, never PUT.
router.post('/:userId', requireSelfOrAdmin('userId'), replaceCart);

export default router;
