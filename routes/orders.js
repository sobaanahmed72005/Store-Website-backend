import express from 'express';
import { createOrder, getOrdersByUser, uploadPaymentProof, servePaymentProof } from '../controllers/ordersController.js';
import { requireAuth, requireSelfOrAdmin } from '../middleware/auth.js';
import { paymentProofUpload } from '../middleware/upload.js';

const router = express.Router();

router.post('/', requireAuth, createOrder);
router.post('/payment-proof', requireAuth, paymentProofUpload.single('image'), uploadPaymentProof);
router.get('/payment-proof/:filename', requireAuth, servePaymentProof);
router.get('/user/:userId', requireSelfOrAdmin('userId'), getOrdersByUser);

export default router;
