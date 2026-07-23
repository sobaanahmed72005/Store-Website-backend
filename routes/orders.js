import express from 'express';
import { createOrder, getOrdersByUser, uploadPaymentProof, servePaymentProof } from '../controllers/ordersController.js';
import { requireAnyAuth, requireCustomer, requireSelfOrAdmin } from '../middleware/auth.js';
import { paymentProofUpload } from '../middleware/upload.js';
import { checkoutRateLimit, paymentProofRateLimit } from '../middleware/checkoutRateLimit.js';

const router = express.Router();

router.post('/', requireCustomer, checkoutRateLimit, createOrder);
router.post('/payment-proof', requireCustomer, paymentProofRateLimit, paymentProofUpload.single('image'), uploadPaymentProof);
// servePaymentProof checks admin-or-owner internally (there's no :userId param on this route to
// check against up front — ownership is resolved from the filename), so this needs an identity
// from either cookie rather than requireCustomer/requireAuth alone.
router.get('/payment-proof/:filename', requireAnyAuth, servePaymentProof);
router.get('/user/:userId', requireSelfOrAdmin('userId'), getOrdersByUser);

export default router;
