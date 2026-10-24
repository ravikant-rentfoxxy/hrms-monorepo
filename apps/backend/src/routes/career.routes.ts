import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/career.controller';
import {
  certificationQuerySchema, certificationSchema, endorseSchema, expiringQuerySchema, skillSchema, skillSearchQuerySchema,
  updateCertificationSchema, updateSkillSchema, verifySchema,
} from '../validations/career.validation';

export const careerRouter = Router();
careerRouter.use(authenticate, tenant);

// Career history — self, reporting manager, ADMIN/HR (checked in the service).
careerRouter.get('/history/me', controller.myHistory);
careerRouter.get('/history/:employeeId', controller.history);

// Skills
careerRouter.get('/skills/me', controller.mySkills);
careerRouter.get('/skills/search', requireRole('ADMIN', 'HR', 'MANAGER'), validate(skillSearchQuerySchema, 'query'), controller.searchSkills);
careerRouter.get('/skills/export', requireRole('ADMIN', 'HR'), validate(skillSearchQuerySchema, 'query'), controller.exportSkills);
careerRouter.get('/skills/names', controller.skillNames);
careerRouter.get('/skills/employee/:employeeId', controller.employeeSkills);
careerRouter.post('/skills', validate(skillSchema), controller.addSkill);
careerRouter.patch('/skills/:id', validate(updateSkillSchema), controller.updateSkill);
careerRouter.delete('/skills/:id', controller.deleteSkill);
careerRouter.post('/skills/:id/endorse', requireRole('ADMIN', 'HR', 'MANAGER'), validate(endorseSchema), controller.endorseSkill);

// Certifications
careerRouter.get('/certifications/me', controller.myCertifications);
careerRouter.get('/certifications/expiring', validate(expiringQuerySchema, 'query'), controller.expiring);
careerRouter.get('/certifications/export', requireRole('ADMIN', 'HR'), validate(certificationQuerySchema, 'query'), controller.exportCertifications);
careerRouter.get('/certifications/employee/:employeeId', controller.employeeCertifications);
careerRouter.get('/certifications', requireRole('ADMIN', 'HR'), validate(certificationQuerySchema, 'query'), controller.companyCertifications);
// Multipart: optional "file" (certificate scan / PDF) + the fields.
careerRouter.post('/certifications', upload.single('file'), validate(certificationSchema), controller.addCertification);
careerRouter.patch('/certifications/:id', upload.single('file'), validate(updateCertificationSchema), controller.updateCertification);
careerRouter.delete('/certifications/:id', controller.deleteCertification);
careerRouter.post('/certifications/:id/verify', requireRole('ADMIN', 'HR'), validate(verifySchema), controller.verifyCertification);
careerRouter.get('/certifications/:id/file', controller.certificationFile);
