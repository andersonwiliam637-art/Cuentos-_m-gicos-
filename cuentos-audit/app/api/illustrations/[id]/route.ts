import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { id } = await params;
  const { data: illustration, error } = await supabase.from('illustrations').select('id,image_url,generation_status,story_id,position').eq('id', id).single();
  if (error || !illustration) return NextResponse.json({ error: 'Ilustración no encontrada' }, { status: 404 });
  if (!illustration.image_url) return NextResponse.json({ illustration });
  const { data: signed, error: signedError } = await supabase.storage.from('story-art').createSignedUrl(illustration.image_url, 60 * 15);
  if (signedError) return NextResponse.json({ error: 'No se pudo obtener la imagen' }, { status: 500 });
  return NextResponse.json({ illustration: { ...illustration, signedUrl: signed.signedUrl } });
}
