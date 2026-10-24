/**
 * One-off, idempotent backfill of existing data for the hire-to-retire lifecycle.
 * Safe to re-run; never deletes anything.  Run with: npm run db:backfill
 *
 * Order matters: recruitment links hired employees to their application,
 * career then decides every employee's employment status, and separation
 * fills exit-case codes, clearance checklists and F&F due dates.
 */
import { prisma } from '../../src/lib/prisma';
import { backfillRecruitment } from './recruitment';
import { backfillCareer } from './career';
import { backfillSeparation } from './separation';

async function main(): Promise<void> {
  for (const [name, run] of [
    ['recruitment', backfillRecruitment],
    ['career', backfillCareer],
    ['separation', backfillSeparation],
  ] as const) {
    const lines = await run(prisma);
    console.log(`\n== ${name}`);
    for (const l of lines) console.log(`  ${l}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
