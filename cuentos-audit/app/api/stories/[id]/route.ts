import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data: story, error } = await supabase.from('stories').select('id,title,protagonist_name,age_range,moral_lesson,story_content,is_premium,created_at').eq('id', id).eq('user_id', auth.user.id).single();
  if (error || !story) return NextResponse.json({ error: 'Cuento no encontrado' }, { status: 404 });
  return NextResponse.json({ story });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { error } = await supabase.from('stories').delete().eq('id', id).eq('user_id', auth.user.id);
  if (error) return NextResponse.json({ error: 'No se pudo eliminar el cuento' }, { status: 500 });
  return NextResponse.json({ ok: true });
}
