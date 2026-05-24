import type { Context } from 'hono';
import { z } from 'zod';
import { DbConflictError, DbNotFoundError } from '../db/tenants.js';
import { logger } from '../logger.js';

const apiLogger = logger.child({ component: 'admin-api' });

export type JsonParseResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      response: Response;
    };

export async function parseJsonBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<JsonParseResult<z.output<T>>> {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    return {
      ok: false,
      response: c.json({ error: 'invalid_json' }, 400),
    };
  }

  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false,
      response: c.json(
        {
          error: 'invalid_request',
          details: z.treeifyError(parsed.error),
        },
        400,
      ),
    };
  }

  return {
    ok: true,
    data: parsed.data,
  };
}

export function handleAdminRouteError(c: Context, error: unknown): Response {
  if (error instanceof DbConflictError) {
    return c.json({ error: 'conflict', message: error.message }, 409);
  }

  if (error instanceof DbNotFoundError) {
    return c.json({ error: 'not_found', message: error.message }, 404);
  }

  apiLogger.error({ error }, 'admin route error');
  return c.json({ error: 'internal_error' }, 500);
}
