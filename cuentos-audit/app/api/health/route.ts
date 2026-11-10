import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export async function GET() {
  const required = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'OPENAI_API_KEY'];
  const missing = required.filter((key) => !process.env[key]);
  const configured = missing.length === 0;
  return NextResponse.json(
    { ok: configured, service: 'cuentos-magicos', status: configured ? 'ready' : 'misconfigured' },
    { status: configured ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
