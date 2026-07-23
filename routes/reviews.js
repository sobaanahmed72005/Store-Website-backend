import express from 'express';
import { requireCustomer } from '../middleware/auth.js';
import { getReviewsForProduct, createReview, updateOwnReview, deleteOwnReview, getReviewEligibility } from '../controllers/reviewsController.js';
import { reviewRateLimit } from '../middleware/reviewRateLimit.js';

const router = express.Router();

router.get('/', getReviewsForProduct);
router.get('/eligibility', requireCustomer, getReviewEligibility);
router.post('/', requireCustomer, reviewRateLimit, createReview);
router.put('/:id', requireCustomer, reviewRateLimit, updateOwnReview);
router.delete('/:id', requireCustomer, reviewRateLimit, deleteOwnReview);

export default router;