import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generateIllustration, generateIllustrationPrompt } from '@/lib/ai/illustration';
import { enforceUserRateLimit } from '@/lib/supabase/rate-limit';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  try {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    if (!(await enforceUserRateLimit(supabase, authData.user.id, 'illustration_generation', 5, 60))) return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un minuto.' }, { status: 429 });
    const { id: storyId } = await params;
    const body = await request.json();
    const scene = typeof body.scene === 'string' ? body.scene.trim().slice(0, 700) : '';
    if (!scene) return NextResponse.json({ error: 'Falta la escena' }, { status: 400 });

    const { data: story } = await supabase.from('stories').select('id,protagonist_name').eq('id', storyId).single();
    if (!story) return NextResponse.json({ error: 'Cuento no encontrado' }, { status: 404 });

    const character = body.characterId
      ? (await supabase.from('characters').select('id,name,description,visual_traits').eq('id', body.characterId).single()).data
      : null;
    if (body.characterId && !character) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 });

    const prompt = await generateIllustrationPrompt({
      protagonistName: character?.name || story.protagonist_name,
      characterDescription: character?.description || 'friendly child story protagonist',
      visualTraits: character?.visual_traits || 'consistent colorful storybook appearance',
      scene,
    });

    const { data: lastIllustration } = await supabase.from('illustrations').select('position').eq('story_id', storyId).order('position', { ascending: false }).limit(1).maybeSingle();
    const position = (lastIllustration?.position ?? -1) + 1;
    const { data: pending, error: pendingError } = await supabase.from('illustrations').insert({
      story_id: storyId, character_id: character?.id ?? null, prompt, position, generation_status: 'processing'
    }).select('id').single();
    if (pendingError) return NextResponse.json({ error: 'No se pudo iniciar la ilustración' }, { status: 500 });

    try {
      const image = await generateIllustration(prompt);
      const path = `${authData.user.id}/${storyId}/${pending.id}.png`;
      const { error: uploadError } = await supabase.storage.from('story-art').upload(path, image, { contentType: 'image/png', upsert: true });
      if (uploadError) throw uploadError;
      const { data: updated, error: updateError } = await supabase.from('illustrations').update({ image_url: path, generation_status: 'completed' }).eq('id', pending.id).select('*').single();
      if (updateError) throw updateError;
      return NextResponse.json({ illustration: updated });
    } catch (error) {
      await supabase.from('illustrations').update({ generation_status: 'failed', error_message: 'image_generation_failed' }).eq('id', pending.id);
      throw error;
    }
  } catch (error) {
    console.error('illustration_generation_error', error);
    return NextResponse.json({ error: 'No se pudo generar la ilustración' }, { status: 500 });
  }
}
