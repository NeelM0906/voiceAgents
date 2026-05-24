import { Hono } from 'hono';
import { serve } from 'inngest/hono';
import { inngest } from '../inngest/client.js';
import { functions } from '../inngest/functions/index.js';

const handler = serve({
  client: inngest,
  functions,
  servePath: '/api/inngest',
});

export const inngestRoutes = new Hono();

inngestRoutes.on(['GET', 'POST', 'PUT'], '/', async (c) => handler(c));
