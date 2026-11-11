import { createAdminClient } from '@/lib/supabase/admin';

type SafetyEventType = 'input_blocked' | 'output_blocked' | 'generation_failed' | 'rate_limited';

export async function recordSafetyEvent(input: {
  userId: string;
  eventType: SafetyEventType;
  source: 'story' | 'illustration' | 'activity';
  riskCode?: string;
}) {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from('safety_events').insert({
      user_id: input.userId,
      event_type: input.eventType,
      source: input.source,
      risk_code: input.riskCode?.slice(0, 80) ?? null,
    });
    if (error) {
      console.error('safety_event_write_failed', {
        source: input.source,
        eventType: input.eventType,
        code: error.code,
      });
    }
  } catch (error) {
    console.error('safety_event_write_failed', {
      source: input.source,
      eventType: input.eventType,
      reason: error instanceof Error ? error.name : 'unknown',
    });
  }
}
