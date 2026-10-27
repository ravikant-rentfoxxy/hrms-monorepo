import { Router } from 'express';
import { authRouter } from './auth.routes';
import { publicRouter } from './public.routes';
import { superAdminRouter } from './superadmin.routes';
import { employeesRouter } from './employee.routes';
import { officesRouter } from './office.routes';
import { attendanceRouter } from './attendance.routes';
import { leavesRouter } from './leave.routes';
import { payrollRouter } from './payroll.routes';
import { holidaysRouter } from './holiday.routes';
import { announcementsRouter } from './announcement.routes';
import { expensesRouter } from './expense.routes';
import { documentsRouter } from './document.routes';
import { ticketsRouter } from './ticket.routes';
import { dashboardRouter } from './dashboard.routes';
// Foundation
import { mastersRouter } from './master.routes';
import { auditRouter } from './audit.routes';
import { approvalsRouter } from './approval.routes';
import { systemRouter } from './system.routes';
// Time & attendance
import { shiftsRouter } from './shift.routes';
import { overtimeRouter } from './overtime.routes';
import { projectsRouter } from './project.routes';
import { timesheetsRouter } from './timesheet.routes';
// Payroll & finance
import { statutoryRouter } from './statutory.routes';
import { companyProfileRouter } from './company-profile.routes';
import { salaryRouter } from './salary-revision.routes';
import { taxDeclarationsRouter } from './tax-declaration.routes';
import { loansRouter } from './loan.routes';
import { payrollInputsRouter } from './payroll-input.routes';
import { travelRouter } from './travel.routes';
// Employee lifecycle
import { onboardingRouter } from './onboarding.routes';
import { confirmationsRouter } from './confirmation.routes';
import { lettersRouter } from './letter.routes';
import { assetsRouter } from './asset.routes';
import { exitsRouter } from './exit.routes';
import { transfersRouter } from './transfer.routes';
import { careerRouter } from './career.routes';
import { lifecycleRouter } from './lifecycle.routes';
import { idCardsRouter } from './id-card.routes';
// Talent & engagement
import { recruitmentRouter } from './recruitment.routes';
import { surveysRouter } from './survey.routes';
import { recognitionRouter } from './recognition.routes';
// Insights, data & platform
import { reportsRouter } from './report.routes';
import { importsRouter } from './import.routes';
import { integrationsRouter } from './integration.routes';
import { billingRouter, companyBillingRouter } from './billing.routes';

/** Assembles one API surface. Platform (super admin) routes are opt-in. */
export function buildApiRouter(options: { withPlatformRoutes: boolean }): Router {
  const api = Router();
  api.use('/auth', authRouter);
  // Candidate portal (token links, no login) — has its own stricter rate limit.
  api.use('/public', publicRouter);
  if (options.withPlatformRoutes) {
    api.use('/superadmin/billing', billingRouter);
    api.use('/superadmin', superAdminRouter);
  }
  api.use('/employees', employeesRouter);
  api.use('/offices', officesRouter);
  api.use('/attendance', attendanceRouter);
  api.use('/leaves', leavesRouter);
  api.use('/payroll', payrollRouter);
  api.use('/holidays', holidaysRouter);
  api.use('/announcements', announcementsRouter);
  api.use('/expenses', expensesRouter);
  api.use('/documents', documentsRouter);
  api.use('/tickets', ticketsRouter);
  api.use('/dashboard', dashboardRouter);

  api.use('/masters', mastersRouter);
  api.use('/audit', auditRouter);
  api.use('/approvals', approvalsRouter);
  api.use('/system', systemRouter);

  api.use('/shifts', shiftsRouter);
  api.use('/overtime', overtimeRouter);
  api.use('/projects', projectsRouter);
  api.use('/timesheets', timesheetsRouter);

  api.use('/company-profile', companyProfileRouter);
  api.use('/statutory', statutoryRouter);
  api.use('/salary', salaryRouter);
  api.use('/tax-declarations', taxDeclarationsRouter);
  api.use('/loans', loansRouter);
  api.use('/payroll-inputs', payrollInputsRouter);
  api.use('/travel', travelRouter);

  api.use('/onboarding', onboardingRouter);
  api.use('/confirmations', confirmationsRouter);
  api.use('/letters', lettersRouter);
  api.use('/assets', assetsRouter);
  api.use('/exits', exitsRouter);
  api.use('/transfers', transfersRouter);
  api.use('/career', careerRouter);
  api.use('/lifecycle', lifecycleRouter);
  api.use('/id-cards', idCardsRouter);

  api.use('/recruitment', recruitmentRouter);
  api.use('/surveys', surveysRouter);
  api.use('/recognition', recognitionRouter);

  api.use('/reports', reportsRouter);
  api.use('/imports', importsRouter);
  api.use('/integrations', integrationsRouter);
  api.use('/billing', companyBillingRouter);
  return api;
}
