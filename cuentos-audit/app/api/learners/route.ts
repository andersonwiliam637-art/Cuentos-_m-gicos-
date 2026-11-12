import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const schema = z.object({
  nickname: z.string().trim().min(1).max(40),
  age: z.number().int().min(4).max(12),
  interests: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
});

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data, error } = await supabase.from('learner_profiles').select('id,nickname,age,interests,created_at,updated_at').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'No se pudieron cargar los perfiles' }, { status: 500 });
  return NextResponse.json({ learners: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
  const { data, error } = await supabase.from('learner_profiles').insert({ user_id: auth.user.id, ...parsed.data }).select('id,nickname,age,interests,created_at,updated_at').single();
  if (error) {
    if (error.message?.includes('learner_profile_limit_reached')) {
      return NextResponse.json({ error: 'Alcanzaste el máximo de perfiles infantiles incluido en tu plan.' }, { status: 403 });
    }
    console.error('learner_profile_create_failed', { code: error.code });
    return NextResponse.json({ error: 'No se pudo crear el perfil' }, { status: 500 });
  }
  return NextResponse.json({ learner: data }, { status: 201 });
}
