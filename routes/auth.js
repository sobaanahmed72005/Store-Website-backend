import express from 'express';
import {
  register, login, adminLogin, logout, adminLogout, me, refresh, adminRefresh, verifyEmail, resendVerification,
  updateProfile, changePassword, forgotPassword, resetPassword, verifyTwoFactorLogin, twoFactorStatus,
  setupTwoFactor, confirmTwoFactor, disableTwoFactor,
} from '../controllers/authController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/loginRateLimit.js';
import { accountActionRateLimit, authenticatedAccountActionRateLimit } from '../middleware/accountActionRateLimit.js';
import { twoFactorRateLimit, authenticatedTwoFactorRateLimit } from '../middleware/twoFactorRateLimit.js';
import { refreshRateLimit } from '../middleware/refreshRateLimit.js';

const router = express.Router();

router.post('/register', accountActionRateLimit, register);
router.post('/login', loginRateLimit, login);
router.post('/admin-login', loginRateLimit, adminLogin);
router.post('/2fa/verify', twoFactorRateLimit, verifyTwoFactorLogin);
router.post('/refresh', refreshRateLimit, refresh);
router.post('/admin-refresh', refreshRateLimit, adminRefresh);
router.post('/logout', logout);
router.post('/admin-logout', adminLogout);
router.get('/me', requireAuth, me);
router.put('/me', requireAuth, authenticatedAccountActionRateLimit, updateProfile);
router.put('/change-password', requireAuth, authenticatedAccountActionRateLimit, changePassword);
router.get('/verify-email', accountActionRateLimit, verifyEmail);
router.post('/resend-verification', requireAuth, authenticatedAccountActionRateLimit, resendVerification);
router.post('/forgot-password', accountActionRateLimit, forgotPassword);
router.post('/reset-password', accountActionRateLimit, resetPassword);
router.get('/2fa/status', requireAuth, twoFactorStatus);
// A stolen/valid session shouldn't get unlimited guesses at the account's password or TOTP/
// recovery codes through these — 2fa/disable in particular is the one endpoint that can strip a
// security control off the account entirely.
router.post('/2fa/setup', requireAuth, authenticatedTwoFactorRateLimit, setupTwoFactor);
router.post('/2fa/confirm', requireAuth, authenticatedTwoFactorRateLimit, confirmTwoFactor);
router.post('/2fa/disable', requireAuth, authenticatedTwoFactorRateLimit, disableTwoFactor);

// Admin-panel equivalents of the self-service routes above — same controllers (they only ever
// act on req.user/req.business, not on which surface called them), gated by requireAdmin instead
// of requireAuth so the admin panel's own account/security settings are read from the admin
// cookie, never the customer one. See middleware/auth.js and utils/authCookies.js for why the two
// must stay on fully separate cookies rather than sharing this route group.
router.get('/admin/me', requireAdmin, me);
router.put('/admin/me', requireAdmin, authenticatedAccountActionRateLimit, updateProfile);
router.put('/admin/change-password', requireAdmin, authenticatedAccountActionRateLimit, changePassword);
router.get('/admin/2fa/status', requireAdmin, twoFactorStatus);
router.post('/admin/2fa/setup', requireAdmin, authenticatedTwoFactorRateLimit, setupTwoFactor);
router.post('/admin/2fa/confirm', requireAdmin, authenticatedTwoFactorRateLimit, confirmTwoFactor);
router.post('/admin/2fa/disable', requireAdmin, authenticatedTwoFactorRateLimit, disableTwoFactor);

export default router;
