import express from 'express';
import { createOrder, getOrdersByUser, uploadPaymentProof, servePaymentProof } from '../controllers/ordersController.js';
import { requireAuth, requireCustomer, requireSelfOrAdmin } from '../middleware/auth.js';
import { paymentProofUpload } from '../middleware/upload.js';
import { checkoutRateLimit, paymentProofRateLimit } from '../middleware/checkoutRateLimit.js';

const router = express.Router();

router.post('/', requireCustomer, checkoutRateLimit, createOrder);
router.post('/payment-proof', requireCustomer, paymentProofRateLimit, paymentProofUpload.single('image'), uploadPaymentProof);
router.get('/payment-proof/:filename', requireAuth, servePaymentProof);
router.get('/user/:userId', requireSelfOrAdmin('userId'), getOrdersByUser);

export default router;
