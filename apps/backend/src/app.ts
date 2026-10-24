import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { env, isProd } from './config/env';
import { logger } from './lib/logger';
import { apiLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/error';
import { buildApiRouter } from './routes';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
  app.use(
    cors({
      origin: origins.includes('*') ? true : origins,
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Company-Id'],
      // Lets the web panel read download file names and payroll export warnings.
      exposedHeaders: ['Content-Disposition', 'X-Missing-UAN'],
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  if (!isProd) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(apiLimiter);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  // Flutter app API — no platform (super admin) routes.
  app.use('/api/v1', buildApiRouter({ withPlatformRoutes: false }));
  // Admin panel API — separate surface, includes platform routes.
  app.use('/api/admin/v1', buildApiRouter({ withPlatformRoutes: true }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
