import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const schema = z.object({ plan: z.enum(['family', 'premium']) }).strict();
const API_BASE = 'https://app.recurrente.com/api';

export async function POST(request: Request) {
  const secret = process.env.RECURRENTE_SECRET_KEY;
  if (process.env.PAYMENT_PROVIDER !== 'recurrente' || !secret) return NextResponse.json({ error: 'Pagos no configurados' }, { status: 503 });
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl || !/^https:\/\//i.test(baseUrl) && process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'URL pública no configurada correctamente' }, { status: 503 });
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Plan inválido' }, { status: 400 });
  const productId = parsed.data.plan === 'family' ? process.env.RECURRENTE_FAMILY_PRODUCT_ID : process.env.RECURRENTE_PREMIUM_PRODUCT_ID;
  if (!productId) return NextResponse.json({ error: 'Producto de suscripción no configurado en Recurrente' }, { status: 503 });

  const admin = createAdminClient();
  const { data: order, error: orderError } = await admin.from('payment_orders').insert({
    user_id: auth.user.id, provider: 'recurrente', product_code: parsed.data.plan,
    amount: 0, currency: 'GTQ', status: 'pending', metadata: { product_id: productId, plan: parsed.data.plan, amount_pending: true },
  }).select('id').single();
  if (orderError || !order) {
    console.error('recurrente_order_create_failed', { code: orderError?.code });
    return NextResponse.json({ error: 'No se pudo iniciar el pago' }, { status: 500 });
  }
  try {
    const response = await fetch(`${API_BASE}/checkouts`, {
      method: 'POST', headers: { 'X-SECRET-KEY': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ product_id: productId, quantity: 1 }],
        success_url: `${baseUrl}/dashboard?billing=processing`,
        cancel_url: `${baseUrl}/dashboard?billing=cancelled`,
      }), cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({})) as { id?: string; checkout_url?: string; total_in_cents?: number; currency?: string; error?: string };
    if (!response.ok || !payload.id || !payload.checkout_url) {
      await admin.from('payment_orders').update({ status: 'failed' }).eq('id', order.id);
      console.error('recurrente_checkout_failed', { status: response.status, error: payload.error });
      return NextResponse.json({ error: 'El proveedor no pudo crear el checkout' }, { status: 502 });
    }
    const { error: updateError } = await admin.from('payment_orders').update({ external_order_id: payload.id, ...(typeof payload.total_in_cents === 'number' && payload.total_in_cents >= 0 ? { amount: payload.total_in_cents / 100 } : {}), ...(payload.currency ? { currency: payload.currency } : {}), metadata: { product_id: productId, plan: parsed.data.plan, amount_pending: typeof payload.total_in_cents !== 'number' } }).eq('id', order.id);
    if (updateError) {
      console.error('recurrente_order_link_failed', { code: updateError.code });
      return NextResponse.json({ error: 'No se pudo registrar la orden de pago' }, { status: 500 });
    }
    return NextResponse.json({ url: payload.checkout_url });
  } catch (error) {
    await admin.from('payment_orders').update({ status: 'failed' }).eq('id', order.id);
    console.error('recurrente_checkout_network_error', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: 'No se pudo conectar con el proveedor de pagos' }, { status: 502 });
  }
}
