const BLOCKED_INPUT = [
  /sexual/i,
  /porn/i,
  /suicid/i,
  /autoles/i,
  /cómo fabricar un arma/i,
  /como fabricar un arma/i,
  /cómo hacer una bomba/i,
  /como hacer una bomba/i,
];

export function moderateChildInput(values: string[]) {
  const text = values.join(' ').trim();
  if (!text || text.length > 2500) return { allowed: false, riskCode: 'input_length' } as const;
  const match = BLOCKED_INPUT.find((pattern) => pattern.test(text));
  return match ? { allowed: false, riskCode: 'blocked_topic' } as const : { allowed: true } as const;
}

const OUTPUT_BLOCKED = [/contenido sexual explícito/i, /autolesión/i, /instrucciones para fabricar explosivos/i];
export function moderateChildOutput(text: string) {
  if (!text || text.length < 20 || text.length > 12000) return { allowed: false, riskCode: 'output_length' } as const;
  const match = OUTPUT_BLOCKED.find((pattern) => pattern.test(text));
  return match ? { allowed: false, riskCode: 'blocked_output' } as const : { allowed: true } as const;
}


/** Provider-backed moderation. Fail closed if the safety service is unavailable. */
export async function moderateWithOpenAI(text: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey });
  const result = await client.moderations.create({ model: 'omni-moderation-latest', input: text.slice(0, 20000) });
  const first = result.results[0];
  if (!first) throw new Error('MODERATION_EMPTY_RESPONSE');
  return first.flagged
    ? { allowed: false as const, riskCode: 'provider_moderation_flagged' }
    : { allowed: true as const };
}
