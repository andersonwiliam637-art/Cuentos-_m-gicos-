import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStorySchema } from '@/lib/validation/story';
import { generateStory } from '@/lib/ai/story';
import { moderateChildInput, moderateChildOutput, moderateWithOpenAI } from '@/lib/safety/content';
import { recordSafetyEvent } from '@/lib/safety/events';
import { enforceUserRateLimit } from '@/lib/supabase/rate-limit';

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { data, error } = await supabase
    .from('stories')
    .select('id,title,protagonist_name,age_range,moral_lesson,is_premium,created_at,updated_at')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: 'No se pudo cargar la biblioteca' }, { status: 500 });
  return NextResponse.json({ stories: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  let jobId: string | null = null;

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    if (!(await enforceUserRateLimit(supabase, 'story_generation'))) {
      await recordSafetyEvent({ userId: authData.user.id, eventType: 'rate_limited', source: 'story', riskCode: 'story_generation_rate_limit' });
      return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo.' }, { status: 429 });
    }

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }

    const parsed = createStorySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 400 });

    const moderationInput = [parsed.data.protagonistName, parsed.data.moralLesson, ...parsed.data.interests];
    const localInput = moderateChildInput(moderationInput);
    if (!localInput.allowed) {
      await recordSafetyEvent({ userId: authData.user.id, eventType: 'input_blocked', source: 'story', riskCode: localInput.riskCode });
      return NextResponse.json({ error: 'Ese tema no está disponible para Cuentos Mágicos.' }, { status: 422 });
    }

    let providerInput;
    try { providerInput = await moderateWithOpenAI(moderationInput.join('\n')); }
    catch { return NextResponse.json({ error: 'La comprobación de seguridad no está disponible. Inténtalo de nuevo.' }, { status: 503 }); }
    if (!providerInput.allowed) {
      await recordSafetyEvent({ userId: authData.user.id, eventType: 'input_blocked', source: 'story', riskCode: providerInput.riskCode });
      return NextResponse.json({ error: 'Ese tema no está disponible para Cuentos Mágicos.' }, { status: 422 });
    }

    const { data: reservation, error: quotaError } = await supabase.rpc('reserve_story_generation', { p_user_id: authData.user.id });
    const quota = Array.isArray(reservation) ? reservation[0] : reservation;
    if (quotaError) return NextResponse.json({ error: 'No se pudo reservar la generación' }, { status: 500 });
    if (!quota?.allowed || !quota.job_id) {
      return NextResponse.json({ error: 'Límite de cuentos alcanzado', used: quota?.used, limit: quota?.limit_count }, { status: 403 });
    }

    jobId = quota.job_id;
    const generated = await generateStory(parsed.data);
    const generatedText = [
      generated.title,
      generated.story,
      generated.learningObjective,
      generated.comprehensionQuestion,
    ].join('\n');

    const localOutput = moderateChildOutput(generatedText);
    const providerOutput = await moderateWithOpenAI(generatedText);
    if (!localOutput.allowed || !providerOutput.allowed) {
      await recordSafetyEvent({
        userId: authData.user.id,
        eventType: 'output_blocked',
        source: 'story',
        riskCode: localOutput.allowed ? providerOutput.riskCode : localOutput.riskCode,
      });
      throw new Error('SAFE_OUTPUT_REJECTED');
    }

    const { data: story, error: insertError } = await supabase.from('stories').insert({
      user_id: authData.user.id,
      title: generated.title,
      protagonist_name: parsed.data.protagonistName,
      age_range: String(parsed.data.age),
      moral_lesson: parsed.data.moralLesson,
      story_content: generated.story,
      is_premium: false,
    }).select('id,title,story_content,created_at').single();

    if (insertError) throw new Error(`STORY_INSERT_FAILED:${insertError.code}`);

    const { error: completeError } = await supabase.rpc('complete_story_generation', { p_job_id: jobId, p_story_id: story.id });
    if (completeError) throw new Error('GENERATION_COMPLETION_FAILED');

    jobId = null;
    return NextResponse.json({
      story,
      learningObjective: generated.learningObjective,
      comprehensionQuestion: generated.comprehensionQuestion,
    });
  } catch (error) {
    if (jobId) {
      const { error: failError } = await supabase.rpc('fail_story_generation', {
        p_job_id: jobId,
        p_error_code: error instanceof Error ? error.message.slice(0, 120) : 'generation_failed',
      });
      if (failError) console.error('story_generation_reservation_cleanup_failed', { code: failError.code });
    }
    console.error('story_generation_error', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'No se pudo crear el cuento. Inténtalo de nuevo.' }, { status: 500 });
  }
}
