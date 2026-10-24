/** Registers every module's periodic jobs with the in-process scheduler (lib/scheduler.ts). */
import { registerAttendanceJobs } from './attendance.jobs';
import { registerLeaveJobs } from './leave.jobs';
import { registerSalaryJobs } from './salary.jobs';
import { registerLifecycleJobs } from './lifecycle.jobs';
import { registerTalentJobs } from './talent.jobs';
import { registerPlatformJobs } from './platform.jobs';
import { registerCareerJobs } from './career.jobs';
import { registerRecruitmentJobs } from './recruitment.jobs';

export function registerAllJobs(): void {
  registerAttendanceJobs();
  registerLeaveJobs();
  registerSalaryJobs();
  registerLifecycleJobs();
  registerTalentJobs();
  registerPlatformJobs();
  registerCareerJobs();
  registerRecruitmentJobs();
}
