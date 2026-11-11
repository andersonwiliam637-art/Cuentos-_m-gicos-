import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Quotas are defined by the database, never by browser-supplied arguments.
 * Authenticated users can invoke exposed Supabase RPCs directly.
 */
export async function enforceUserRateLimit(
  supabase: SupabaseClient,
  bucket: 'story_generation' | 'illustration_generation' | 'activity_generation' | 'activity_attempt',
): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_rate_limit', { p_bucket: bucket });

  if (error) {
    console.error('rate_limit_check_failed', { bucket, code: error.code });
    return false;
  }
  return data === true;
}
