export type PaymentProvider = 'recurrente' | 'stripe' | 'binance_pay' | 'telegram_stars' | 'manual';

export type CheckoutRequest = {
  userId: string;
  productCode: 'family' | 'premium' | 'single_story' | 'activity_pack';
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutResult = { checkoutUrl: string; externalOrderId?: string };

export interface PaymentProviderAdapter {
  readonly name: PaymentProvider;
  createCheckout(input: CheckoutRequest): Promise<CheckoutResult>;
}
