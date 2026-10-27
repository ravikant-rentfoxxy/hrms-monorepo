/**
 * Demo requests. POSTs JSON to NEXT_PUBLIC_DEMO_ENDPOINT (your CRM, form
 * service or backend route). With no endpoint configured the request fails
 * with NotConfiguredError — the form tells the visitor instead of pretending.
 */
import { endpoints } from '@/marketing/lib/site';
import { NotConfiguredError, postJson } from './http';

export interface DemoRequest {
  fullName: string;
  workEmail: string;
  phone: string;
  companyName: string;
  companySize: string;
  jobTitle: string;
  modules: string[];
  preferredDate: string;
  requirements: string;
}

export async function submitDemoRequest(request: DemoRequest): Promise<void> {
  if (!endpoints.demoEndpoint) {
    throw new NotConfiguredError('Online demo booking isn’t connected yet.');
  }
  await postJson(endpoints.demoEndpoint, { ...request, source: 'website', submittedAt: new Date().toISOString() });
}
