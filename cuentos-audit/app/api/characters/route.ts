import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const characterSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).default(''),
  visualTraits: z.string().trim().max(500).default(''),
  favoriteInterests: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
});

export async function GET() {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const { data, error } = await supabase.from('characters').select('*').order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: 'No se pudieron cargar los personajes' }, { status: 500 });
  return NextResponse.json({ characters: data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const parsed = characterSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 400 });
  const { data, error } = await supabase.from('characters').insert({
    user_id: user.user.id,
    name: parsed.data.name,
    description: parsed.data.description,
    visual_traits: parsed.data.visualTraits,
    favorite_interests: parsed.data.favoriteInterests,
  }).select('*').single();
  if (error) return NextResponse.json({ error: 'No se pudo crear el personaje' }, { status: 500 });
  return NextResponse.json({ character: data }, { status: 201 });
}
