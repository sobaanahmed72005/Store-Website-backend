import express from 'express';
import { getRates } from '../controllers/currencyController.js';

const router = express.Router();

router.get('/rates', getRates);

export default router;