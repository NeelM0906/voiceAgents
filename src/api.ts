import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { getApiConfig } from './config.js';
import { logger } from './logger.js';
import { healthRoutes } from './routes/health.js';
import { tenantRoutes } from './routes/tenants.js';

const apiConfig = getApiConfig();
const apiLogger = logger.child({ component: 'admin-api' });

export const app = new Hono();

app.route('/', healthRoutes);

app.use('/admin/*', async (c, next) => {
  const apiKey = c.req.header('x-api-key');

  if (apiKey !== apiConfig.ADMIN_API_KEY) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  await next();
});

app.route('/admin/tenants', tenantRoutes);

serve(
  {
    fetch: app.fetch,
    port: apiConfig.API_PORT,
  },
  (info) => {
    apiLogger.info({ port: info.port }, 'admin API listening');
  },
);
