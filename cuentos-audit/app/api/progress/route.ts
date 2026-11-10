import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data: learners, error } = await supabase.from('learner_profiles').select('id,nickname,age').order('created_at');
  if (error) return NextResponse.json({ error: 'No se pudieron cargar los perfiles' }, { status: 500 });
  const ids = (learners ?? []).map(x => x.id);
  if (!ids.length) return NextResponse.json({ progress: [] });
  const { data: progress } = await supabase.from('learner_progress').select('learner_id,stories_completed,activities_attempted,activities_correct,updated_at').in('learner_id', ids);
  return NextResponse.json({ progress: (learners ?? []).map(l => ({ ...l, ...(progress ?? []).find(p => p.learner_id === l.id) })) });
}
