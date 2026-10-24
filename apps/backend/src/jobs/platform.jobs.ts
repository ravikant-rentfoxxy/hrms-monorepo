/** Platform billing jobs: monthly invoices and the daily subscription sweep (trials, seats, PAST_DUE). */
import { registerJob } from '../lib/scheduler';
import { logger } from '../lib/logger';
import * as billingService from '../services/billing.service';

export function registerPlatformJobs(): void {
  registerJob({
    name: 'platform.invoices',
    period: 'monthly',
    atHour: 2,
    run: async (key) => {
      // key = current month "YYYY-MM" → bill the previous month (idempotent per company + period).
      const [y, m] = key.split('-').map(Number);
      const previous = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 2, 1)).toISOString().slice(0, 7);
      await billingService.ensureDefaultPlans();
      const result = await billingService.generateInvoices(previous);
      logger.info({ job: 'platform.invoices', ...result }, 'invoices generated');
    },
  });

  registerJob({
    name: 'platform.subscriptions',
    period: 'daily',
    atHour: 3,
    run: async () => {
      await billingService.dailySubscriptionSweep();
    },
  });
}
