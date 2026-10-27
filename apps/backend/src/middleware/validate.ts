import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { ApiError } from '../utils/http';

type Part = 'body' | 'query' | 'params';

/** Validates and replaces `req[part]` with the parsed (and coerced) value. */
export function validate(schema: ZodTypeAny, part: Part = 'body') {
  const middleware = (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(ApiError.badRequest('Validation failed', result.error.flatten().fieldErrors));
    }
    // req.query is a getter in Express 5 types; assignment works on Express 4.
    (req as unknown as Record<Part, unknown>)[part] = result.data;
    next();
  };
  // Read by the dev API docs (lib/openapi.ts) to describe the request.
  return Object.assign(middleware, { openapi: { schema, part } });
}
