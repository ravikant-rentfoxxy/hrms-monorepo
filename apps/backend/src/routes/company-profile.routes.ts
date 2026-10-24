import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/company-profile.controller';
import { companyProfileSchema } from '../validations/company-profile.validation';

/** Company address, contact and letterhead — HR reads, ADMIN edits. */
export const companyProfileRouter = Router();
companyProfileRouter.use(authenticate, tenant, requireRole('ADMIN', 'HR'));

companyProfileRouter.get('/', controller.getProfile);
companyProfileRouter.patch('/', requireRole('ADMIN'), validate(companyProfileSchema), controller.updateProfile);
companyProfileRouter.post('/logo', requireRole('ADMIN'), upload.single('file'), controller.setLogo);
companyProfileRouter.delete('/logo', requireRole('ADMIN'), controller.removeLogo);
