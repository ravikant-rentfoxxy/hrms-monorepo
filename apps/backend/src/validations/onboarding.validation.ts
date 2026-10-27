import { z } from 'zod';
import { issueAssetsSchema } from './asset.validation';

export const ONBOARDING_ASSIGNEE_ROLES = ['EMPLOYEE', 'HR', 'MANAGER', 'IT', 'ADMIN'] as const;

export const templateTaskSchema = z.object({
  title: z.string().trim().min(2).max(160),
  description: z.string().max(1000).default(''),
  assigneeRole: z.enum(ONBOARDING_ASSIGNEE_ROLES).default('EMPLOYEE'),
  /** Days from the joining date (negative = before joining). */
  dueOffsetDays: z.coerce.number().int().min(-90).max(365).default(0),
  requiresDocument: z.boolean().default(false),
  documentCategory: z.string().max(60).default(''),
});

export const onboardingTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  tasks: z.array(templateTaskSchema).min(1).max(100),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const onboardingTemplateUpdateSchema = onboardingTemplateSchema.partial();

export const startCaseSchema = z.object({
  employeeId: z.string().uuid(),
  templateId: z.string().uuid().optional(),
});

export const listCasesQuerySchema = z.object({
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
});

/** Assets issued from an onboarding task: name + count rows, all for the task's joiner. */
export const issueTaskAssetsSchema = issueAssetsSchema.extend({ complete: z.boolean().default(true) });
