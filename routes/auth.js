import express from 'express';
import { register, login, me, verifyEmail, resendVerification, updateProfile, changePassword, forgotPassword, resetPassword } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/loginRateLimit.js';

const router = express.Router();

router.post('/register', register);
router.post('/login', loginRateLimit, login);
router.get('/me', requireAuth, me);
router.put('/me', requireAuth, updateProfile);
router.put('/change-password', requireAuth, changePassword);
router.get('/verify-email', verifyEmail);
router.post('/resend-verification', requireAuth, resendVerification);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

export default router;
