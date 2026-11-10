import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
function verifySvix(rawBody: string, secret: string, id: string | null, timestamp: string | null, signatures: string | null) {
  if (!id || !timestamp || !signatures || !secret.startsWith('whsec_')) return false;
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() / 1000 - sentAt) > 300) return false;
  let key: Buffer;
  try { key = Buffer.from(secret.slice('whsec_'.length), 'base64'); } catch { return false; }
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  return signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    try { const a = Buffer.from(value); const b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b); } catch { return false; }
  });
}

type RecurrenteEvent = {
  id?: string; event_type?: string; type?: string; status?: string; created_at?: string;
  checkout?: { id?: string; status?: string };
  subscription?: { id?: string; status?: string };
  metadata?: Record<string, unknown>;
  details?: Record<string, unknown>;
};

export async function POST(request: Request) {
  const secret = process.env.RECURRENTE_WEBHOOK_SECRET;
  if (!secret) return new NextResponse('Webhook not configured', { status: 503 });
  const rawBody = await request.text();
  const svixId = request.headers.get('svix-id');
  if (!verifySvix(rawBody, secret, svixId, request.headers.get('svix-timestamp'), request.headers.get('svix-signature'))) {
    return new NextResponse('Invalid signature', { status: 400 });
  }
  let event: RecurrenteEvent;
  try { event = JSON.parse(rawBody) as RecurrenteEvent; } catch { return new NextResponse('Invalid JSON', { status: 400 }); }
  if (!event.id || !event.event_type || !svixId) return new NextResponse('Invalid event', { status: 400 });
  const admin = createAdminClient();
  const { error: eventError } = await admin.from('payment_events').insert({ provider: 'recurrente', external_event_id: svixId, event_type: event.event_type, payload: { type: event.type, status: event.status, checkout: event.checkout, subscription: event.subscription, created_at: event.created_at } });
  if (eventError?.code === '23505') return NextResponse.json({ received: true, duplicate: true });
  if (eventError) { console.error('recurrente_event_store_failed', { code: eventError.code }); return new NextResponse('Could not record event', { status: 500 }); }
  try {
    const checkoutId = event.checkout?.id;
    if (event.event_type === 'intent.succeeded' && event.status === 'succeeded' && checkoutId) {
      const { data: order, error: orderError } = await admin.from('payment_orders').select('id,user_id,product_code,status').eq('provider', 'recurrente').eq('external_order_id', checkoutId).maybeSingle();
      if (orderError) throw orderError;
      if (order && order.status !== 'paid') {
        const { error: paidError } = await admin.from('payment_orders').update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', order.id).eq('status', 'pending');
        if (paidError) throw paidError;
        const plan = order.product_code === 'premium' ? 'premium' : order.product_code === 'family' ? 'family' : null;
        if (plan) { const { error: profileError } = await admin.from('profiles').update({ plan_type: plan }).eq('id', order.user_id); if (profileError) throw profileError; }
      }
    }
    if (event.event_type === 'subscription.create' && checkoutId && event.subscription?.id) {
      const { error: subscriptionLinkError } = await admin.from('payment_orders')
        .update({ external_subscription_id: event.subscription.id })
        .eq('provider', 'recurrente').eq('external_order_id', checkoutId);
      if (subscriptionLinkError) throw subscriptionLinkError;
    }
    if (['subscription.pause', 'subscription.cancel', 'subscription.past_due'].includes(event.event_type) && event.subscription?.id) {
      const { data: order, error: lookupError } = await admin.from('payment_orders')
        .select('user_id').eq('provider', 'recurrente').eq('external_subscription_id', event.subscription.id).maybeSingle();
      if (lookupError) throw lookupError;
      if (order) { const { error: planError } = await admin.from('profiles').update({ plan_type: 'free' }).eq('id', order.user_id); if (planError) throw planError; }
    }
    if (['subscription.unpause', 'subscription.reactivate'].includes(event.event_type) && event.subscription?.id) {
      const { data: order, error: lookupError } = await admin.from('payment_orders')
        .select('user_id,product_code').eq('provider', 'recurrente').eq('external_subscription_id', event.subscription.id).maybeSingle();
      if (lookupError) throw lookupError;
      if (order) { const plan = order.product_code === 'premium' ? 'premium' : order.product_code === 'family' ? 'family' : null; if (plan) { const { error: planError } = await admin.from('profiles').update({ plan_type: plan }).eq('id', order.user_id); if (planError) throw planError; } }
    }
    if (event.event_type === 'refund.create' && checkoutId) {
      await admin.from('payment_orders').update({ status: 'refunded', updated_at: new Date().toISOString() }).eq('provider', 'recurrente').eq('external_order_id', checkoutId);
    }
    await admin.from('payment_events').update({ processed_at: new Date().toISOString() }).eq('provider', 'recurrente').eq('external_event_id', svixId);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('recurrente_event_processing_failed', error instanceof Error ? error.name : 'unknown');
    return new NextResponse('Event processing failed', { status: 500 });
  }
}
