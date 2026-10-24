import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import * as controller from '../controllers/auth.controller';
import {
  changePasswordSchema, disable2faSchema, enable2faSchema, forgotPasswordSchema, login2faSchema, loginSchema,
  refreshSchema, resetPasswordSchema, switchCompanySchema,
} from '../validations/auth.validation';

export const authRouter = Router();

authRouter.get('/companies', controller.companies); // public: login-screen company dropdown
authRouter.post('/login', authLimiter, validate(loginSchema), controller.login);
authRouter.post('/login/2fa', authLimiter, validate(login2faSchema), controller.login2fa);
authRouter.post('/forgot-password', authLimiter, validate(forgotPasswordSchema), controller.forgotPassword);
authRouter.post('/reset-password', authLimiter, validate(resetPasswordSchema), controller.resetPassword);
authRouter.post('/switch-company', authenticate, validate(switchCompanySchema), controller.switchCompany);
authRouter.post('/refresh', authLimiter, validate(refreshSchema), controller.refresh);
authRouter.post('/logout', authenticate, controller.logout);
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/change-password', authenticate, authLimiter, validate(changePasswordSchema), controller.changePassword);

// Two-factor (TOTP) enrolment for the signed-in user.
authRouter.get('/2fa', authenticate, controller.twoFactorStatus);
authRouter.post('/2fa/setup', authenticate, controller.setupTwoFactor);
authRouter.post('/2fa/enable', authenticate, authLimiter, validate(enable2faSchema), controller.enableTwoFactor);
authRouter.post('/2fa/disable', authenticate, authLimiter, validate(disable2faSchema), controller.disableTwoFactor);
