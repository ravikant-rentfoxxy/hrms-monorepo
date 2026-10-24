import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(128),
  companyId: z.string().uuid().optional(), // pick a company when the user belongs to several
});

export const switchCompanySchema = z.object({ companyId: z.string().uuid() });

export const refreshSchema = z.object({ refreshToken: z.string().min(1) });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Za-z]/, 'Must contain a letter')
    .regex(/[0-9]/, 'Must contain a digit'),
});

export const passwordRule = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/[0-9]/, 'Must contain a digit');

const totpCode = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app');

export const login2faSchema = z.object({
  challengeToken: z.string().min(1),
  code: totpCode,
});

export const enable2faSchema = z.object({ code: totpCode });

export const disable2faSchema = z.object({ password: z.string().min(1).max(128) });

export const forgotPasswordSchema = z.object({ email: z.string().email().toLowerCase() });

export const resetPasswordSchema = z.object({
  email: z.string().email().toLowerCase(),
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  newPassword: passwordRule,
});
