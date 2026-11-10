import { z } from 'zod';

export const createStorySchema = z.object({
  protagonistName: z.string().trim().min(1).max(60),
  age: z.number().int().min(3).max(12),
  interests: z.array(z.string().trim().min(1).max(40)).min(1).max(5),
  moralLesson: z.string().trim().min(3).max(200),
}).strict();

export type CreateStoryInput = z.infer<typeof createStorySchema>;
