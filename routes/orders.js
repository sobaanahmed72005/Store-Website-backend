import express from 'express';
import { createOrder, getOrdersByUser } from '../controllers/ordersController.js';
import { requireAuth, requireSelfOrAdmin } from '../middleware/auth.js';

const router = express.Router();

router.post('/', requireAuth, createOrder);
router.get('/user/:userId', requireSelfOrAdmin('userId'), getOrdersByUser);

export default router;
