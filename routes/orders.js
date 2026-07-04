import express from 'express';
import { createOrder, getOrdersByUser, uploadPaymentProof } from '../controllers/ordersController.js';
import { requireAuth, requireSelfOrAdmin } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

router.post('/', requireAuth, createOrder);
router.post('/payment-proof', requireAuth, upload.single('image'), uploadPaymentProof);
router.get('/user/:userId', requireSelfOrAdmin('userId'), getOrdersByUser);

export default router;
