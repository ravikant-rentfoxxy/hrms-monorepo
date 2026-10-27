import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/company-profile.controller';
import { companyProfileSchema } from '../validations/company-profile.validation';

/** Company address, contact, logo and letterhead — ADMIN and HR (who issue the letters) read and edit. */
export const companyProfileRouter = Router();
companyProfileRouter.use(authenticate, tenant, requireRole('ADMIN', 'HR'));

companyProfileRouter.get('/', controller.getProfile);
companyProfileRouter.patch('/', validate(companyProfileSchema), controller.updateProfile);
companyProfileRouter.post('/logo', upload.single('file'), controller.setLogo);
companyProfileRouter.delete('/logo', controller.removeLogo);
