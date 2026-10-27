import multer from 'multer';
import { env } from '../config/env';

/** In-memory upload (any file format); bytes are forwarded to MinIO. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

// Tag single-file middlewares with their field name for the dev API docs (lib/openapi.ts).
const single = upload.single.bind(upload);
upload.single = (field: string) => Object.assign(single(field), { openapi: { uploadField: field } });
