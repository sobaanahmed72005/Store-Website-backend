import express from 'express';
import { login, me, checkSlug, listBusinesses, createBusiness, setBusinessStatus, updateProfile, changePassword } from '../controllers/platformController.js';
import { requirePlatformAdmin } from '../middleware/platformAuth.js';
import { loginRateLimit } from '../middleware/loginRateLimit.js';

const router = express.Router();

router.post('/login', loginRateLimit, login);
router.get('/me', requirePlatformAdmin, me);
router.put('/me', requirePlatformAdmin, updateProfile);
router.put('/change-password', requirePlatformAdmin, changePassword);
router.get('/check-slug', requirePlatformAdmin, checkSlug);
router.get('/businesses', requirePlatformAdmin, listBusinesses);
router.post('/businesses', requirePlatformAdmin, createBusiness);
router.patch('/businesses/:id/status', requirePlatformAdmin, setBusinessStatus);

export default router;
