import OpenAI from 'openai';

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  return new OpenAI({ apiKey });
}

export async function generateIllustrationPrompt(args: {
  protagonistName: string;
  characterDescription: string;
  visualTraits: string;
  scene: string;
}) {
  const safeScene = args.scene.replace(/\s+/g, ' ').trim().slice(0, 700);
  return `Children's picture-book illustration. Main character: ${args.protagonistName}. Character description: ${args.characterDescription}. Visual traits: ${args.visualTraits}. Scene: ${safeScene}. Warm, friendly, imaginative, age-appropriate, no text, no logos, no frightening imagery.`;
}

export async function generateIllustration(prompt: string) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY_MISSING');
  const openai = getOpenAI();
  const result = await openai.images.generate({
    model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    prompt,
    size: '1024x1024',
  });
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error('EMPTY_IMAGE_RESPONSE');
  return Buffer.from(b64, 'base64');
}
