import { createClient } from '@supabase/supabase-js';

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

function looksLikeSupabaseUrl(value) {
  return value.startsWith('https://') && value.includes('.supabase.co');
}

export const hasSupabaseConfig = Boolean(
  looksLikeSupabaseUrl(supabaseUrl) && supabaseAnonKey.length > 20
);

let client = null;
let configError = '';

try {
  if (hasSupabaseConfig) {
    client = createClient(supabaseUrl, supabaseAnonKey);
  }
} catch (error) {
  configError = error.message;
  client = null;
}

export const supabase = client;
export const supabaseConfigError = configError;
