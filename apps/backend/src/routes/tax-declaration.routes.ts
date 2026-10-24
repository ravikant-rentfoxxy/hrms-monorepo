import { Router } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/tax-declaration.controller';
import {
  fyQuerySchema, listDeclarationsQuerySchema, proofUploadSchema, rejectSchema, saveDeclarationSchema,
  submitDeclarationSchema, verifySchema,
} from '../validations/tax-declaration.validation';

export const taxDeclarationsRouter = Router();
taxDeclarationsRouter.use(authenticate, tenant);

taxDeclarationsRouter.get('/meta', controller.meta);

// Employee: own declaration for a FY (default: current FY).
taxDeclarationsRouter.get('/me', validate(fyQuerySchema, 'query'), controller.getMine);
taxDeclarationsRouter.put('/me', validate(saveDeclarationSchema), controller.saveMine);
taxDeclarationsRouter.post('/me', validate(saveDeclarationSchema), controller.saveMine); // same as PUT (clients without PUT)
taxDeclarationsRouter.post('/me/submit', validate(submitDeclarationSchema), controller.submitMine);

// HR verification queue.
taxDeclarationsRouter.get('/', requireRole('ADMIN', 'HR'), validate(listDeclarationsQuerySchema, 'query'), controller.list);
taxDeclarationsRouter.get('/:id', controller.getOne); // owner or ADMIN/HR (service)
taxDeclarationsRouter.post('/:id/verify', requireRole('ADMIN', 'HR'), validate(verifySchema), controller.verify);
taxDeclarationsRouter.post('/:id/reject', requireRole('ADMIN', 'HR'), validate(rejectSchema), controller.reject);

// Proofs (file in multipart field `file`); owner or ADMIN/HR.
taxDeclarationsRouter.post('/:id/proofs', upload.single('file'), validate(proofUploadSchema), controller.addProof);
taxDeclarationsRouter.get('/:id/proofs/:proofId/download', controller.proofDownload);
taxDeclarationsRouter.delete('/:id/proofs/:proofId', controller.deleteProof);
