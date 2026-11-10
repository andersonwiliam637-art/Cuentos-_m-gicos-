import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const schema = z.object({ activityId: z.string().uuid(), answer: z.string().trim().min(1).max(500) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
  const { activityId, answer } = parsed.data;

  const { data: activity } = await supabase.from('educational_activities').select('id').eq('id', activityId).single();
  if (!activity) return NextResponse.json({ error: 'Actividad no encontrada' }, { status: 404 });

  try {
    const admin = createAdminClient();
    const { data: key } = await admin.from('educational_answer_keys').select('answer_key,explanation').eq('activity_id', activityId).single();
    if (!key) return NextResponse.json({ error: 'Actividad no disponible para corregir' }, { status: 409 });
    const isCorrect = answer.trim().toLowerCase() === key.answer_key.trim().toLowerCase();
    const feedback = isCorrect ? '¡Muy bien! Tu respuesta coincide con la solución.' : 'Buen intento. Revisa la explicación y vuelve a intentarlo.';
    const { data: attempt, error } = await supabase.from('activity_attempts').insert({ activity_id: activityId, user_id: auth.user.id, answer: { value: answer }, is_correct: isCorrect, feedback }).select('id,is_correct,feedback,created_at').single();
    if (error) throw error;
    return NextResponse.json({ attempt, explanation: isCorrect ? key.explanation : undefined });
  } catch (error) {
    console.error('activity_attempt_error', error);
    return NextResponse.json({ error: 'No se pudo comprobar la respuesta' }, { status: 500 });
  }
}
