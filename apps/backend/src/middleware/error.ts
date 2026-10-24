import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ApiError } from '../utils/http';
import { logger } from '../lib/logger';
import { isProd } from '../config/env';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, error: 'Route not found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ success: false, error: err.message, details: err.details });
    return;
  }
  if (err instanceof MulterError) {
    res.status(400).json({ success: false, error: `Upload error: ${err.message}` });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ success: false, error: 'A record with this value already exists' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ success: false, error: 'Record not found' });
      return;
    }
  }
  logger.error(err, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: isProd ? 'Internal server error' : err instanceof Error ? err.message : 'Internal server error',
  });
}
