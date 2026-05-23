import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { Database } from './types.js';

export const supabase = createClient<Database>(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);
