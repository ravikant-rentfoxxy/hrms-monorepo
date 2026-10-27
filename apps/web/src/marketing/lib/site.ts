/**
 * Brand and contact details shown across the site. Values in [brackets] are
 * placeholders — replace them before going live.
 */
export const site = {
  name: 'HRMS',
  tagline: 'The all-in-one HR platform',
  description:
    'Manage your entire employee lifecycle — hiring, onboarding, attendance, leave, payroll and offboarding — in one HRMS platform.',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  contact: {
    email: '[sales@yourcompany.com]',
    phone: '[+91 00000 00000]',
    address: '[Company address, City, State, PIN]',
  },
  social: {
    linkedin: '#',
    x: '#',
    youtube: '#',
  },
} as const;

export const endpoints = {
  /** Where demo requests are POSTed. Unset = not connected yet (the form says so). */
  demoEndpoint: process.env.NEXT_PUBLIC_DEMO_ENDPOINT || '',
} as const;
