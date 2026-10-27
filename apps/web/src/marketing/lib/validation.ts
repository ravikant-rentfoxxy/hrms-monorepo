/** Small, dependency-free validators shared by the forms. Each returns an error message or undefined. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Common personal mailbox domains — the demo form asks for a work email. */
const PERSONAL_DOMAINS = new Set(['gmail.com', 'yahoo.com', 'yahoo.co.in', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'rediffmail.com', 'aol.com', 'proton.me', 'protonmail.com']);

export const v = {
  required: (value: string, label: string) => (value.trim() ? undefined : `${label} is required`),
  email: (value: string) => {
    if (!value.trim()) return 'Email address is required';
    return EMAIL.test(value.trim()) ? undefined : 'Enter a valid email address';
  },
  workEmail: (value: string) => {
    const base = v.email(value);
    if (base) return base;
    const domain = value.trim().split('@')[1]?.toLowerCase() ?? '';
    return PERSONAL_DOMAINS.has(domain) ? 'Please use your work email address' : undefined;
  },
  phone: (value: string) => {
    const digits = value.replace(/[^\d]/g, '');
    if (!digits) return 'Phone number is required';
    return digits.length >= 8 && digits.length <= 15 ? undefined : 'Enter a valid phone number';
  },
  minLength: (value: string, n: number, label: string) => (value.trim().length >= n ? undefined : `${label} must be at least ${n} characters`),
  /** Same rule as the HRMS API: 8+ characters with a letter and a digit. */
  newPassword: (value: string) => {
    if (value.length < 8) return 'Use at least 8 characters';
    if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return 'Include at least one letter and one number';
    return undefined;
  },
  futureDate: (value: string) => {
    if (!value) return 'Choose a preferred date';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Date(`${value}T00:00:00`) >= today ? undefined : 'Pick today or a future date';
  },
};

/** Keep only keys whose value is a message. */
export function compact<T extends Record<string, string | undefined>>(errors: T): Partial<Record<keyof T, string>> {
  return Object.fromEntries(Object.entries(errors).filter(([, m]) => m)) as Partial<Record<keyof T, string>>;
}
