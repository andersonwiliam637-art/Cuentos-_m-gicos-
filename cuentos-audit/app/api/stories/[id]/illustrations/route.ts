import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { generateIllustration, generateIllustrationPrompt } from '@/lib/ai/illustration';
import { moderateChildInput, moderateWithOpenAI } from '@/lib/safety/content';
import { recordSafetyEvent } from '@/lib/safety/events';
import { enforceUserRateLimit } from '@/lib/supabase/rate-limit';

const requestSchema = z.object({
  scene: z.string().trim().min(1).max(700),
  characterId: z.string().uuid().optional(),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError || !authData.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

    if (!(await enforceUserRateLimit(supabase, 'illustration_generation'))) {
      await recordSafetyEvent({ userId: authData.user.id, eventType: 'rate_limited', source: 'illustration', riskCode: 'illustration_generation_rate_limit' });
      return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un minuto.' }, { status: 429 });
    }

    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });

    const { id: storyId } = await params;
    const { data: story, error: storyError } = await supabase
      .from('stories')
      .select('id,protagonist_name')
      .eq('id', storyId)
      .eq('user_id', authData.user.id)
      .single();

    if (storyError || !story) return NextResponse.json({ error: 'Cuento no encontrado' }, { status: 404 });

    const character = parsed.data.characterId
      ? (await supabase.from('characters').select('id,name,description,visual_traits')
          .eq('id', parsed.data.characterId).eq('user_id', authData.user.id).single()).data
      : null;

    if (parsed.data.characterId && !character) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 });

    const moderationInput = [
      parsed.data.scene,
      character?.name ?? story.protagonist_name,
      character?.description ?? '',
      character?.visual_traits ?? '',
    ];
    const localModeration = moderateChildInput(moderationInput);
    if (!localModeration.allowed) {
      await recordSafetyEvent({ userId: authData.user.id, eventType: 'input_blocked', source: 'illustration', riskCode: localModeration.riskCode });
      return NextResponse.json({ error: 'Esa escena no está disponible para Cuentos Mágicos.' }, { status: 422 });
    }

    let providerModeration;
    try { providerModeration = await moderateWithOpenAI(moderationInput.join('\n')); }
    catch { return NextResponse.json({ error: 'La comprobación de seguridad no está disponible. Inténtalo de nuevo.' }, { status: 503 }); }
    if (!providerModeration.allowed) {
      await recordSafetyEvent({ userId: authData.user.id, eventType: 'input_blocked', source: 'illustration', riskCode: providerModeration.riskCode });
      return NextResponse.json({ error: 'Esa escena no está disponible para Cuentos Mágicos.' }, { status: 422 });
    }

    const { data: monthlyReservation, error: monthlyReservationError } = await supabase.rpc('reserve_monthly_ai_usage', { p_bucket: 'illustration' });
    const monthlyQuota = Array.isArray(monthlyReservation) ? monthlyReservation[0] : monthlyReservation;
    if (monthlyReservationError) {
      console.error('illustration_monthly_quota_reservation_failed', { code: monthlyReservationError.code });
      return NextResponse.json({ error: 'No se pudo validar el cupo mensual. Inténtalo de nuevo.' }, { status: 503 });
    }
    if (!monthlyQuota?.allowed) {
      return NextResponse.json({
        error: 'Alcanzaste el límite mensual de ilustraciones de tu plan.',
        used: monthlyQuota?.used,
        limit: monthlyQuota?.limit_count,
      }, { status: 403 });
    }

    const prompt = await generateIllustrationPrompt({
      protagonistName: character?.name || story.protagonist_name,
      characterDescription: character?.description || 'friendly child story protagonist',
      visualTraits: character?.visual_traits || 'consistent colorful storybook appearance',
      scene: parsed.data.scene,
    });

    // The DB allocates both the placeholder and its position in one transaction.
    const { data: reservation, error: reservationError } = await supabase.rpc('reserve_illustration', {
      p_story_id: storyId,
      p_character_id: character?.id ?? null,
      p_prompt: prompt,
    });
    const pending = Array.isArray(reservation) ? reservation[0] : reservation;
    if (reservationError || !pending?.illustration_id) {
      console.error('illustration_reservation_failed', { code: reservationError?.code });
      return NextResponse.json({ error: 'No se pudo iniciar la ilustración' }, { status: 500 });
    }

    const illustrationId = pending.illustration_id as string;
    try {
      const image = await generateIllustration(prompt);
      const path = `${authData.user.id}/${storyId}/${illustrationId}.png`;
      const { error: uploadError } = await supabase.storage.from('story-art')
        .upload(path, image, { contentType: 'image/png', upsert: true });
      if (uploadError) throw uploadError;

      const { data: updated, error: updateError } = await supabase.from('illustrations')
        .update({ image_url: path, generation_status: 'completed' })
        .eq('id', illustrationId)
        .select('*')
        .single();
      if (updateError) throw updateError;
      return NextResponse.json({ illustration: updated });
    } catch (error) {
      const { error: markFailedError } = await supabase.from('illustrations')
        .update({ generation_status: 'failed', error_message: 'image_generation_failed' })
        .eq('id', illustrationId);
      if (markFailedError) console.error('illustration_failure_status_write_failed', { code: markFailedError.code });
      throw error;
    }
  } catch (error) {
    console.error('illustration_generation_error', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'No se pudo generar la ilustración' }, { status: 500 });
  }
}
