import type { PaymentProvider } from './types';

export function getConfiguredPaymentProvider(): PaymentProvider | null {
  const configured = process.env.PAYMENT_PROVIDER as PaymentProvider | undefined;
  if (!configured) return null;
  if (!['recurrente', 'stripe', 'binance_pay', 'telegram_stars', 'manual'].includes(configured)) return null;
  return configured;
}
