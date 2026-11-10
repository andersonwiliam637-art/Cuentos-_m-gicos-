import type { SupabaseClient } from '@supabase/supabase-js';

export async function enforceUserRateLimit(
  supabase: SupabaseClient,
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_user_id: userId, p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds,
  });
  if (error) {
    // Fail closed: never allow paid AI operations when rate limiting cannot be verified.
    console.error('rate_limit_check_failed', { bucket, code: error.code });
    return false;
  }
  return data === true;
}
