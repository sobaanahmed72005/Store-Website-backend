import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getReviewsForProduct, createReview, updateOwnReview, deleteOwnReview, getReviewEligibility } from '../controllers/reviewsController.js';
import { reviewRateLimit } from '../middleware/reviewRateLimit.js';

const router = express.Router();

router.get('/', getReviewsForProduct);
router.get('/eligibility', requireAuth, getReviewEligibility);
router.post('/', requireAuth, reviewRateLimit, createReview);
router.put('/:id', requireAuth, reviewRateLimit, updateOwnReview);
router.delete('/:id', requireAuth, reviewRateLimit, deleteOwnReview);

export default router;