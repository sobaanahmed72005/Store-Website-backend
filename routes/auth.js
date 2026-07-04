import express from 'express';
import {
  register, login, logout, me, verifyEmail, resendVerification, updateProfile, changePassword,
  forgotPassword, resetPassword, verifyTwoFactorLogin, twoFactorStatus, setupTwoFactor, confirmTwoFactor, disableTwoFactor,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/loginRateLimit.js';
import { accountActionRateLimit } from '../middleware/accountActionRateLimit.js';
import { twoFactorRateLimit } from '../middleware/twoFactorRateLimit.js';

const router = express.Router();

router.post('/register', accountActionRateLimit, register);
router.post('/login', loginRateLimit, login);
router.post('/2fa/verify', twoFactorRateLimit, verifyTwoFactorLogin);
router.post('/logout', logout);
router.get('/me', requireAuth, me);
router.put('/me', requireAuth, updateProfile);
router.put('/change-password', requireAuth, changePassword);
router.get('/verify-email', accountActionRateLimit, verifyEmail);
router.post('/resend-verification', requireAuth, accountActionRateLimit, resendVerification);
router.post('/forgot-password', accountActionRateLimit, forgotPassword);
router.post('/reset-password', accountActionRateLimit, resetPassword);
router.get('/2fa/status', requireAuth, twoFactorStatus);
router.post('/2fa/setup', requireAuth, setupTwoFactor);
router.post('/2fa/confirm', requireAuth, confirmTwoFactor);
router.post('/2fa/disable', requireAuth, disableTwoFactor);

export default router;
