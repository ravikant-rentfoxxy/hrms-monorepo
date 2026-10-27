/**
 * Dev-only API docs: builds an OpenAPI 3 spec by walking the Express routers
 * (paths + methods) and reading the tags that `validate()`, `requireRole()`
 * and `upload.single()` attach to their middlewares (zod schemas, roles,
 * file fields). Nothing is hand-maintained, so new routes appear automatically.
 *
 *   GET /api/docs       Swagger UI
 *   GET /api/docs.json  raw spec
 */
import type { Express, RequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { buildApiRouter } from '../routes';

const BASE_PATH = '/api/admin/v1';
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

type JsonSchema = Record<string, unknown> & { properties?: Record<string, JsonSchema>; required?: string[]; description?: string };

/** What the tagged middlewares tell us about a route. */
interface Tags {
  auth: boolean;
  roles?: string[];
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  uploadField?: string;
}

// Minimal shapes of Express 4 router internals.
interface Layer {
  name: string;
  handle: RequestHandler & { stack?: Layer[]; openapi?: OpenApiTag };
  regexp: RegExp & { fast_slash?: boolean };
  keys: { name: string }[];
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: Layer[] };
}
interface OpenApiTag {
  schema?: ZodTypeAny;
  part?: 'body' | 'query' | 'params';
  roles?: string[];
  uploadField?: string;
}

/** Folds one middleware into the tags collected so far. */
function collect(tags: Tags, layer: Layer): Tags {
  const t = layer.handle.openapi;
  if (layer.name === 'authenticate') return { ...tags, auth: true };
  if (!t) return tags;
  if (t.roles) return { ...tags, roles: t.roles };
  if (t.uploadField) return { ...tags, uploadField: t.uploadField };
  if (t.schema && t.part === 'body') return { ...tags, body: t.schema };
  if (t.schema && t.part === 'query') return { ...tags, query: t.schema };
  return tags;
}

/** Mount path of a `router.use('/x/:id', sub)` layer, recovered from its regexp. */
function mountPath(layer: Layer): string {
  if (layer.regexp.fast_slash) return '';
  let i = 0;
  return layer.regexp.source
    .replace('\\/?(?=\\/|$)', '')
    .replace(/^\^/, '')
    // A param segment compiles to `(?:([^\/]+?))`, or `(?:\/([^/]+?))` with its leading slash inside.
    .replace(/\(\?:(\\\/)?\(\[\^\\?\/\]\+\?\)\)/g, (_m, slash?: string) => `${slash ? '/' : ''}:${layer.keys[i++]?.name ?? 'param'}`)
    .replace(/\\(.)/g, '$1');
}

interface Op {
  method: (typeof METHODS)[number];
  path: string;
  tags: Tags;
}

function walk(stack: Layer[], prefix: string, inherited: Tags, out: Op[]) {
  let tags = inherited;
  for (const layer of stack) {
    if (layer.route) {
      let routeTags = tags;
      for (const l of layer.route.stack) routeTags = collect(routeTags, l);
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        for (const m of METHODS) {
          if (layer.route.methods[m]) out.push({ method: m, path: `${prefix}${p === '/' ? '' : p}` || '/', tags: routeTags });
        }
      }
    } else if (layer.handle.stack) {
      walk(layer.handle.stack, prefix + mountPath(layer), tags, out);
    } else {
      tags = collect(tags, layer); // router.use(middleware) applies to everything after it
    }
  }
}

function jsonSchema(schema: ZodTypeAny): JsonSchema {
  const { $schema: _s, ...rest } = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none', effectStrategy: 'input' }) as JsonSchema;
  return rest;
}

const envelope = (data: JsonSchema = {}) => ({
  type: 'object',
  properties: { success: { type: 'boolean', example: true }, data },
});

function operation(op: Op) {
  const { tags } = op;
  const segments = op.path.split('/').filter(Boolean);
  const pathParams = op.path.match(/:(\w+)/g)?.map((p) => p.slice(1)) ?? [];
  const parameters: object[] = pathParams.map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));

  if (tags.query) {
    const q = jsonSchema(tags.query);
    for (const [name, schema] of Object.entries(q.properties ?? {})) {
      parameters.push({ name, in: 'query', required: q.required?.includes(name) ?? false, schema, description: schema.description });
    }
  }

  let requestBody: object | undefined;
  if (tags.uploadField) {
    const fields = tags.body ? jsonSchema(tags.body) : { properties: {}, required: [] };
    requestBody = {
      required: true,
      content: {
        'multipart/form-data': {
          schema: {
            type: 'object',
            properties: { [tags.uploadField]: { type: 'string', format: 'binary' }, ...fields.properties },
            required: [tags.uploadField, ...(fields.required ?? [])],
          },
        },
      },
    };
  } else if (tags.body) {
    requestBody = { required: true, content: { 'application/json': { schema: jsonSchema(tags.body) } } };
  }

  const roles = tags.roles ? `**Roles:** ${tags.roles.join(', ')} (SUPER_ADMIN is always allowed).` : undefined;
  return {
    tags: [segments[0] ?? 'root'],
    operationId: `${op.method}_${op.path.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '')}`,
    ...(roles ? { description: roles } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    ...(tags.auth ? { security: [{ bearerAuth: [] }, { bearerAuth: [], actingCompany: [] }] } : { security: [] }),
    responses: {
      '200': { description: 'OK', content: { 'application/json': { schema: envelope() } } },
      '400': { $ref: '#/components/responses/Error' },
      ...(tags.auth ? { '401': { $ref: '#/components/responses/Error' }, '403': { $ref: '#/components/responses/Error' } } : {}),
      ...(pathParams.length ? { '404': { $ref: '#/components/responses/Error' } } : {}),
    },
  };
}

export function buildOpenApiSpec() {
  const ops: Op[] = [];
  walk((buildApiRouter({ withPlatformRoutes: true }) as unknown as { stack: Layer[] }).stack, '', { auth: false }, ops);

  const paths: Record<string, Record<string, object>> = {};
  for (const op of ops) {
    const key = op.path.replace(/:(\w+)/g, '{$1}');
    (paths[key] ??= {})[op.method] ??= operation(op); // first registration wins, as in Express
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'HRMS API',
      version: '1.0.0',
      description:
        'Generated from the Express routes and their zod validators (development only).\n\n' +
        '1. Call `POST /auth/login` and copy `data.accessToken`.\n' +
        '2. Click **Authorize** and paste it under `bearerAuth`.\n' +
        '3. SUPER_ADMIN acting inside a company: also fill `actingCompany` (X-Company-Id).\n\n' +
        `The Flutter app uses the same routes under \`/api/v1\` (without \`/superadmin\`).`,
    },
    servers: [{ url: BASE_PATH, description: 'Admin panel API' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        actingCompany: { type: 'apiKey', in: 'header', name: 'X-Company-Id' },
      },
      responses: {
        Error: {
          description: 'Error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { success: { type: 'boolean', example: false }, error: { type: 'string' }, details: {} },
              },
            },
          },
        },
      },
    },
    paths,
  };
}

/** Serves Swagger UI at /api/docs. Mount before helmet so its CSP doesn't block the UI. */
export function mountApiDocs(app: Express): void {
  const spec = buildOpenApiSpec();
  app.get('/api/docs.json', (_req, res) => {
    res.json(spec);
  });
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(spec, {
      customSiteTitle: 'HRMS API docs',
      swaggerOptions: { persistAuthorization: true, docExpansion: 'none', filter: true, tagsSorter: 'alpha' },
    })
  );
}
