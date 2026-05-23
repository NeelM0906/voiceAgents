import { Hono } from 'hono';
import { supabase } from '../db/client.js';

export const healthRoutes = new Hono();

healthRoutes.get('/healthz', async (c) => {
  const { error } = await supabase.from('tenants').select('id', {
    count: 'exact',
    head: true,
  });

  return c.json({
    ok: true,
    supabase: error ? 'unreachable' : 'reachable',
  });
});
