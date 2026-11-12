import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

function verifySvix(
  rawBody: string,
  secret: string,
  id: string | null,
  timestamp: string | null,
  signatures: string | null,
) {
  if (!id || !timestamp || !signatures || !secret.startsWith('whsec_')) return false;
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt) || Math.abs(Date.now() / 1000 - sentAt) > 300) return false;

  let key: Buffer;
  try {
    key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  } catch {
    return false;
  }

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  return signatures.split(' ').some((entry) => {
    const [version, value] = entry.split(',');
    if (version !== 'v1' || !value) return false;
    try {
      const a = Buffer.from(value);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
}

type RecurrenteEvent = {
  id?: string;
  event_type?: string;
  type?: string;
  status?: string;
  created_at?: string;
  checkout?: { id?: string; status?: string };
  subscription?: { id?: string; status?: string };
  metadata?: Record<string, unknown>;
  details?: Record<string, unknown>;
};

type PaidPlanCode = 'basic' | 'family_premium' | 'plus_family';

function normalizePaidPlan(productCode: string): PaidPlanCode | null {
  if (productCode === 'basic') return 'basic';
  if (productCode === 'family_premium' || productCode === 'family') return 'family_premium';
  if (productCode === 'plus_family' || productCode === 'premium') return 'plus_family';
  return null;
}

function legacyPlanType(planCode: PaidPlanCode | 'free'): 'free' | 'family' | 'premium' {
  if (planCode === 'free') return 'free';
  return planCode === 'plus_family' ? 'premium' : 'family';
}

async function setUserPlan(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  planCode: PaidPlanCode | 'free',
) {
  const { error } = await admin.from('profiles')
    .update({ plan_code: planCode, plan_type: legacyPlanType(planCode) })
    .eq('id', userId);
  if (error) throw error;
}

async function refreshPlanFromPaidOrders(admin: ReturnType<typeof createAdminClient>, userId: string) {
  const { data: orders, error } = await admin
    .from('payment_orders')
    .select('product_code')
    .eq('user_id', userId)
    .eq('status', 'paid');

  if (error) throw error;

  const codes = (orders ?? []).map((order) => normalizePaidPlan(order.product_code)).filter(Boolean);
  const plan: PaidPlanCode | 'free' = codes.includes('plus_family')
    ? 'plus_family'
    : codes.includes('family_premium')
      ? 'family_premium'
      : codes.includes('basic')
        ? 'basic'
        : 'free';

  await setUserPlan(admin, userId, plan);
}

export async function POST(request: Request) {
  const secret = process.env.RECURRENTE_WEBHOOK_SECRET;
  if (!secret) return new NextResponse('Webhook not configured', { status: 503 });

  const rawBody = await request.text();
  const svixId = request.headers.get('svix-id');

  if (!verifySvix(
    rawBody,
    secret,
    svixId,
    request.headers.get('svix-timestamp'),
    request.headers.get('svix-signature'),
  )) {
    return new NextResponse('Invalid signature', { status: 400 });
  }

  let event: RecurrenteEvent;
  try {
    event = JSON.parse(rawBody) as RecurrenteEvent;
  } catch {
    return new NextResponse('Invalid JSON', { status: 400 });
  }

  if (!event.id || !event.event_type || !svixId) {
    return new NextResponse('Invalid event', { status: 400 });
  }

  const admin = createAdminClient();
  const { error: eventError } = await admin.from('payment_events').insert({
    provider: 'recurrente',
    external_event_id: svixId,
    event_type: event.event_type,
    payload: {
      type: event.type,
      status: event.status,
      checkout: event.checkout,
      subscription: event.subscription,
      created_at: event.created_at,
    },
  });

  if (eventError?.code === '23505') {
    // A previous delivery may have failed after persistence. Acknowledge only
    // when it was fully processed; otherwise retry the same event.
    const { data: priorEvent, error: lookupError } = await admin
      .from('payment_events')
      .select('processed_at')
      .eq('provider', 'recurrente')
      .eq('external_event_id', svixId)
      .maybeSingle();

    if (lookupError) return new NextResponse('Could not inspect prior event', { status: 500 });
    if (priorEvent?.processed_at) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  } else if (eventError) {
    console.error('recurrente_event_store_failed', { code: eventError.code });
    return new NextResponse('Could not record event', { status: 500 });
  }

  try {
    const checkoutId = event.checkout?.id;

    if (event.event_type === 'intent.succeeded' && event.status === 'succeeded' && checkoutId) {
      const { data: order, error: orderError } = await admin
        .from('payment_orders')
        .select('id,user_id,product_code,status')
        .eq('provider', 'recurrente')
        .eq('external_order_id', checkoutId)
        .maybeSingle();

      if (orderError) throw orderError;

      if (order && order.status !== 'paid') {
        const { error: paidError } = await admin
          .from('payment_orders')
          .update({ status: 'paid', updated_at: new Date().toISOString() })
          .eq('id', order.id)
          .eq('status', 'pending');

        if (paidError) throw paidError;

        const plan = normalizePaidPlan(order.product_code);
        if (plan) await setUserPlan(admin, order.user_id, plan);
      }
    }

    if (event.event_type === 'subscription.create' && checkoutId && event.subscription?.id) {
      const { error: subscriptionLinkError } = await admin
        .from('payment_orders')
        .update({ external_subscription_id: event.subscription.id })
        .eq('provider', 'recurrente')
        .eq('external_order_id', checkoutId);

      if (subscriptionLinkError) throw subscriptionLinkError;
    }

    if (event.event_type === 'subscription.past_due' && event.subscription?.id) {
      const { data: order, error: lookupError } = await admin
        .from('payment_orders')
        .select('id,metadata')
        .eq('provider', 'recurrente')
        .eq('external_subscription_id', event.subscription.id)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (order) {
        const metadata = order.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
          ? order.metadata as Record<string, unknown>
          : {};
        const { error: statusError } = await admin.from('payment_orders')
          .update({
            metadata: { ...metadata, subscription_state: 'past_due', past_due_at: new Date().toISOString() },
            updated_at: new Date().toISOString(),
          })
          .eq('id', order.id);
        if (statusError) throw statusError;
        // Recurrente retries subscription charges daily up to 15 attempts.
        // Preserve paid access during retries; subscription.cancel is the terminal failure event.
      }
    }

    if (['subscription.pause', 'subscription.cancel'].includes(event.event_type) && event.subscription?.id) {
      const { data: order, error: lookupError } = await admin
        .from('payment_orders')
        .select('id,user_id')
        .eq('provider', 'recurrente')
        .eq('external_subscription_id', event.subscription.id)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (order) {
        const { error: orderStatusError } = await admin.from('payment_orders')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('id', order.id);
        if (orderStatusError) throw orderStatusError;
        await setUserPlan(admin, order.user_id, 'free');
      }
    }

    if (['subscription.unpause', 'subscription.reactivate'].includes(event.event_type) && event.subscription?.id) {
      const { data: order, error: lookupError } = await admin
        .from('payment_orders')
        .select('id,user_id,product_code')
        .eq('provider', 'recurrente')
        .eq('external_subscription_id', event.subscription.id)
        .maybeSingle();

      if (lookupError) throw lookupError;

      if (order) {
        const { error: orderStatusError } = await admin.from('payment_orders')
          .update({ status: 'paid', updated_at: new Date().toISOString() })
          .eq('id', order.id);
        if (orderStatusError) throw orderStatusError;
        const plan = normalizePaidPlan(order.product_code);
        if (plan) await setUserPlan(admin, order.user_id, plan);
      }
    }

    if (event.event_type === 'refund.create' && checkoutId) {
      const { data: refundedOrder, error: refundError } = await admin
        .from('payment_orders')
        .update({ status: 'refunded', updated_at: new Date().toISOString() })
        .eq('provider', 'recurrente')
        .eq('external_order_id', checkoutId)
        .select('user_id')
        .maybeSingle();

      if (refundError) throw refundError;
      if (refundedOrder?.user_id) {
        // Keep access if another paid order still grants a monthly plan.
        await refreshPlanFromPaidOrders(admin, refundedOrder.user_id);
      }
    }

    const { error: processedError } = await admin
      .from('payment_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('provider', 'recurrente')
      .eq('external_event_id', svixId);

    if (processedError) throw processedError;
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('recurrente_event_processing_failed', error instanceof Error ? error.name : 'unknown');
    return new NextResponse('Event processing failed', { status: 500 });
  }
}
