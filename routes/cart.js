import express from 'express';
import { getCart, replaceCart } from '../controllers/cartController.js';
import { requireSelfCustomer, requireSelfOrAdmin } from '../middleware/auth.js';

const router = express.Router();

// Reading a cart stays open to admin-as-support (requireSelfOrAdmin), but writing one is a
// storefront-only action — an admin has no legitimate cart of their own, and a stray admin
// session cookie picked up by a storefront tab must not be able to populate/save a "cart" under
// the admin's account (see requireSelfCustomer in middleware/auth.js).
router.get('/:userId', requireSelfOrAdmin('userId'), getCart);
router.put('/:userId', requireSelfCustomer('userId'), replaceCart);
// Same handler as the PUT above — this exists only because navigator.sendBeacon (used by the
// frontend to flush a pending cart sync as the page unloads, since a normal fetch would get
// cancelled) can only send POST, never PUT.
router.post('/:userId', requireSelfCustomer('userId'), replaceCart);

export default router;
