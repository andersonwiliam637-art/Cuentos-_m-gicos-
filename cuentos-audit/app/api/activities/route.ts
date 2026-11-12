import { NextResponse } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enforceUserRateLimit } from '@/lib/supabase/rate-limit';
import { moderateChildInput, moderateChildOutput, moderateWithOpenAI } from '@/lib/safety/content';
import { recordSafetyEvent } from '@/lib/safety/events';

const requestSchema = z.object({
  age: z.number().int().min(4).max(12),
  type: z.enum(['comprehension', 'math', 'science', 'vocabulary', 'logic', 'creativity', 'values']),
  storyId: z.string().uuid().optional(),
  characterId: z.string().uuid().optional(),
  learnerId: z.string().uuid().optional(),
  topic: z.string().trim().min(1).max(300),
}).strict();

const outputSchema = z.object({
  title: z.string().min(1).max(120),
  instructions: z.string().min(1).max(1500),
  question: z.string().min(1).max(600),
  options: z.array(z.string().min(1).max(180)).max(6).default([]),
  answerKey: z.string().min(1).max(500),
  explanation: z.string().min(1).max(800),
});

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  return new OpenAI({ apiKey });
}

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { data, error } = await supabase.from('educational_activities')
    .select('id,activity_type,age,title,instructions,payload,story_id,character_id,created_at')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: 'No se pudieron cargar las actividades' }, { status: 500 });
  return NextResponse.json({
    activities: (data ?? []).map((activity) => ({
      ...activity,
      payload: {
        question: (activity.payload as Record<string, unknown> | null)?.question,
        options: (activity.payload as Record<string, unknown> | null)?.options ?? [],
      },
    })),
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'IA no configurada' }, { status: 503 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 400 });

  if (!(await enforceUserRateLimit(supabase, 'activity_generation'))) {
    await recordSafetyEvent({ userId: auth.user.id, eventType: 'rate_limited', source: 'activity', riskCode: 'activity_generation_rate_limit' });
    return NextResponse.json({ error: 'Demasiadas solicitudes. Espera un minuto.' }, { status: 429 });
  }

  const { age, type, topic, storyId, characterId, learnerId } = parsed.data;
  const localInput = moderateChildInput([topic]);
  if (!localInput.allowed) {
    await recordSafetyEvent({ userId: auth.user.id, eventType: 'input_blocked', source: 'activity', riskCode: localInput.riskCode });
    return NextResponse.json({ error: 'Ese tema no está disponible para Cuentos Mágicos.' }, { status: 422 });
  }

  try {
    const providerInput = await moderateWithOpenAI(topic);
    if (!providerInput.allowed) {
      await recordSafetyEvent({ userId: auth.user.id, eventType: 'input_blocked', source: 'activity', riskCode: providerInput.riskCode });
      return NextResponse.json({ error: 'Ese tema no está disponible para Cuentos Mágicos.' }, { status: 422 });
    }

    if (storyId) {
      const { data } = await supabase.from('stories').select('id').eq('id', storyId).eq('user_id', auth.user.id).single();
      if (!data) return NextResponse.json({ error: 'Cuento no encontrado' }, { status: 404 });
    }
    if (characterId) {
      const { data } = await supabase.from('characters').select('id').eq('id', characterId).eq('user_id', auth.user.id).single();
      if (!data) return NextResponse.json({ error: 'Personaje no encontrado' }, { status: 404 });
    }
    if (learnerId) {
      const { data } = await supabase.from('learner_profiles').select('id,age').eq('id', learnerId).eq('user_id', auth.user.id).single();
      if (!data) return NextResponse.json({ error: 'Perfil de aprendizaje no encontrado' }, { status: 404 });
      if (data.age !== age) return NextResponse.json({ error: 'La edad no coincide con el perfil' }, { status: 400 });
    }

    const response = await getOpenAI().responses.create({
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-6-luna',
      instructions: 'Eres un docente de primaria que diseña actividades seguras, inclusivas y apropiadas para la edad. No solicites datos personales.',
      input: `Create one safe educational activity for a child age ${age}. Type: ${type}. Topic: ${topic}. Never request personal information. No frightening, sexual, violent, discriminatory or manipulative content. Return JSON only with title,instructions,question,options,answerKey,explanation.`,
      text: { format: { type: 'json_object' } },
      store: false,
    });

    const generated = outputSchema.parse(JSON.parse(response.output_text || ''));
    const outputForModeration = JSON.stringify({
      title: generated.title,
      instructions: generated.instructions,
      question: generated.question,
      options: generated.options,
      answerKey: generated.answerKey,
      explanation: generated.explanation,
    });

    const localOutput = moderateChildOutput(outputForModeration);
    const providerOutput = await moderateWithOpenAI(outputForModeration);
    if (!localOutput.allowed || !providerOutput.allowed) {
      await recordSafetyEvent({
        userId: auth.user.id,
        eventType: 'output_blocked',
        source: 'activity',
        riskCode: localOutput.allowed ? providerOutput.riskCode : localOutput.riskCode,
      });
      return NextResponse.json({ error: 'La actividad generada no pasó la revisión de seguridad.' }, { status: 422 });
    }

    const payload = { question: generated.question, options: generated.options };
    const { data: activity, error: activityError } = await supabase.from('educational_activities').insert({
      user_id: auth.user.id,
      story_id: storyId ?? null,
      character_id: characterId ?? null,
      learner_id: learnerId ?? null,
      activity_type: type,
      age,
      title: generated.title,
      instructions: generated.instructions,
      payload,
    }).select('id,activity_type,age,title,instructions,payload,story_id,character_id,created_at').single();

    if (activityError || !activity) throw activityError ?? new Error('ACTIVITY_INSERT_FAILED');

    const admin = createAdminClient();
    const { error: keyError } = await admin.from('educational_answer_keys').insert({
      activity_id: activity.id,
      answer_key: generated.answerKey,
      explanation: generated.explanation,
    });

    if (keyError) {
      const { error: rollbackError } = await admin.from('educational_activities').delete()
        .eq('id', activity.id).eq('user_id', auth.user.id);
      if (rollbackError) console.error('activity_creation_rollback_failed', { code: rollbackError.code });
      throw keyError;
    }

    return NextResponse.json({
      activity: { ...activity, payload: { question: generated.question, options: generated.options } },
    }, { status: 201 });
  } catch (error) {
    console.error('activity_generation_error', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'No se pudo generar la actividad' }, { status: 500 });
  }
}
