import OpenAI from 'openai';
import type { CreateStoryInput } from '@/lib/validation/story';

function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  return new OpenAI({ apiKey });
}

export const storyResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    story: { type: 'string' },
    learningObjective: { type: 'string' },
    comprehensionQuestion: { type: 'string' },
  },
  required: ['title', 'story', 'learningObjective', 'comprehensionQuestion'],
} as const;

function buildPrompt(input: CreateStoryInput) {
  return `Crea un cuento infantil original para un niño de ${input.age} años llamado ${input.protagonistName}.
Intereses: ${input.interests.join(', ')}.
Lección educativa: ${input.moralLesson}.

Requisitos:
- 400 a 650 palabras.
- Lenguaje apropiado para la edad.
- Principio, desarrollo y desenlace claros.
- Integrar un pequeño aprendizaje de forma natural.
- No pedir datos personales al niño.
- No incluir violencia gráfica, sexualidad, terror intenso, autolesiones ni instrucciones peligrosas.
- No presentar al niño como interlocutor privado de la IA.
- Terminar con una pregunta sencilla de comprensión para conversar con el adulto.
- Devuelve únicamente el objeto estructurado solicitado.`;
}

export async function generateStory(input: CreateStoryInput) {
  const openai = getOpenAI();
  const response = await openai.responses.create({
    model: process.env.OPENAI_TEXT_MODEL || 'gpt-5-mini',
    instructions: 'Eres un autor infantil especializado en aprendizaje seguro y apropiado para la edad.',
    input: buildPrompt(input),
    text: {
      format: {
        type: 'json_schema',
        name: 'children_story',
        strict: true,
        schema: storyResultSchema,
      },
    },
    store: false,
  });

  const raw = response.output_text?.trim();
  if (!raw) throw new Error('EMPTY_AI_RESPONSE');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (typeof parsed.title !== 'string' || typeof parsed.story !== 'string') throw new Error('INVALID_AI_RESPONSE');
  return {
    title: parsed.title.trim().slice(0, 120),
    story: parsed.story.trim(),
    learningObjective: String(parsed.learningObjective ?? '').trim().slice(0, 500),
    comprehensionQuestion: String(parsed.comprehensionQuestion ?? '').trim().slice(0, 500),
  };
}
