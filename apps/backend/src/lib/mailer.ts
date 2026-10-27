/**
 * Outgoing email over SMTP (Gmail / Google Workspace with an app password,
 * Outlook / Microsoft 365, Zoho, Amazon SES …). Configured through SMTP_* in
 * .env; until SMTP_HOST, SMTP_USER and SMTP_PASS are set every send fails with
 * a clear "email is not set up" error instead of pretending to succeed.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { ApiError } from '../utils/http';

let transporter: Transporter | null = null;

export const isMailConfigured = (): boolean => !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

function transport(): Transporter {
  if (!isMailConfigured()) throw ApiError.badRequest('Email is not set up yet — add the SMTP settings to the backend .env and restart it');
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

export async function sendMail(input: MailInput): Promise<void> {
  try {
    await transport().sendMail({ from: env.MAIL_FROM || env.SMTP_USER, ...input });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw ApiError.badRequest(`Email could not be sent: ${err instanceof Error ? err.message : 'SMTP error'}`);
  }
}
