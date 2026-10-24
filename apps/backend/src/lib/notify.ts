/**
 * Notification hook for every HR event (leave applied/decided, payslip
 * published, approval pending, onboarding task due, ...).
 *
 * Call sites are already in place across the services; delivery is not.
 * TODO(notifications): persist an in-app notification and send push (FCM).
 * TODO(email): send email (SMTP / provider) for the events that need it.
 * Until then this only writes a debug log line and never throws.
 */
import { logger } from './logger';

export interface NotifyPayload {
  /** Machine-readable event, e.g. "leave.approved". */
  event: string;
  title: string;
  body: string;
  /** Deep link for the app / web panel, e.g. "/leaves". */
  link?: string;
  /** Also send an email (when email is wired). */
  email?: boolean;
}

export async function notify(companyId: string, employeeIds: (string | null | undefined)[], payload: NotifyPayload): Promise<void> {
  const recipients = [...new Set(employeeIds.filter((id): id is string => !!id))];
  if (recipients.length === 0) return;
  // TODO(notifications): save in-app notification rows + push via Firebase Cloud Messaging.
  // TODO(email): when payload.email, look up recipients' emails and send through the mail provider.
  logger.debug({ companyId, recipients, event: payload.event, title: payload.title }, 'notify (TODO: delivery not wired)');
}

export interface CandidateContact {
  name: string;
  email: string;
  phone?: string;
}

/**
 * Message to a candidate (not yet an employee): interview invitations and
 * reminders, offer letters, candidate-portal links, joining instructions.
 * TODO(email): send through the mail provider (and SMS/WhatsApp if added).
 * Until then HR copies the portal link from the panel; this only logs.
 */
export async function notifyCandidate(companyId: string, candidate: CandidateContact, payload: NotifyPayload): Promise<void> {
  // TODO(email): deliver payload to candidate.email.
  logger.debug({ companyId, candidate: candidate.email, event: payload.event, title: payload.title }, 'notifyCandidate (TODO: delivery not wired)');
}
