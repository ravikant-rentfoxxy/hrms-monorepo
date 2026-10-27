import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireRole, tenant } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { upload } from '../middleware/upload';
import * as controller from '../controllers/id-card.controller';
import { idCardSettingsSchema } from '../validations/id-card.validation';

/**
 * Employee ID cards. Everyone sees and edits the photo on their own card
 * (`/me`); Admin and HR see every card, set the company design and reissue.
 */
export const idCardsRouter = Router();
idCardsRouter.use(authenticate, tenant);

const hrOnly = requireRole('ADMIN', 'HR');
/** `/me/...` is open to every signed-in employee; any other employee id needs Admin / HR. */
const selfOrHr = (req: Request, res: Response, next: NextFunction) =>
  req.params.employeeId === 'me' ? next() : hrOnly(req, res, next);

idCardsRouter.get('/settings', controller.getSettings);
idCardsRouter.put('/settings', hrOnly, validate(idCardSettingsSchema), controller.updateSettings);

idCardsRouter.get('/:employeeId', selfOrHr, controller.card);
idCardsRouter.post('/:employeeId/photo', selfOrHr, upload.single('file'), controller.setPhoto);
idCardsRouter.delete('/:employeeId/photo', selfOrHr, controller.removePhoto);
idCardsRouter.post('/:employeeId/reissue', hrOnly, controller.reissue);
