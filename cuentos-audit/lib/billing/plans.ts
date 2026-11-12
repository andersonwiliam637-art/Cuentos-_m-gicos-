export const PAID_PLANS = [
  {
    code: 'basic',
    name: 'Mágico Básico',
    price: 99,
    audience: 'Para comenzar a descubrir historias',
    profiles: '1 perfil infantil',
    storiesLabel: '8 cuentos personalizados al mes',
    activitiesLabel: '12 actividades educativas al mes',
    illustrationsLabel: '3 ilustraciones con IA al mes',
    maxLearners: 1,
    stories: 8,
    activities: 12,
    illustrations: 3,
    featured: false,
    features: ['Biblioteca privada de cuentos', 'Comprensión lectora y aprendizaje', 'Progreso básico del perfil', 'Contenido adaptado a la edad'],
  },
  {
    code: 'family_premium',
    name: 'Familiar Premium',
    price: 199,
    audience: 'Para compartir el aprendizaje en familia',
    profiles: 'Hasta 3 perfiles infantiles',
    storiesLabel: '20 cuentos personalizados al mes',
    activitiesLabel: '30 actividades educativas al mes',
    illustrationsLabel: '10 ilustraciones con IA al mes',
    maxLearners: 3,
    stories: 20,
    activities: 30,
    illustrations: 10,
    featured: true,
    features: ['Todo lo incluido en Básico', 'Seguimiento del progreso familiar', 'Personajes y aventuras personalizadas', 'Más espacio para crear y aprender'],
  },
  {
    code: 'plus_family',
    name: 'Plus Familiar',
    price: 349,
    audience: 'La experiencia más completa de Cuentos Mágicos',
    profiles: 'Hasta 5 perfiles infantiles',
    storiesLabel: '40 cuentos personalizados al mes',
    activitiesLabel: '60 actividades educativas al mes',
    illustrationsLabel: '20 ilustraciones con IA al mes',
    maxLearners: 5,
    stories: 40,
    activities: 60,
    illustrations: 20,
    featured: false,
    features: ['Acceso a todas las herramientas disponibles', 'Biblioteca y actividades completas', 'Experiencias creativas para toda la familia', 'Cupos mensuales ampliados de IA'],
  },
] as const;

export type PaidPlanCode = (typeof PAID_PLANS)[number]['code'];
export type PlanCode = 'free' | PaidPlanCode;

export const PLAN_LIMITS = {
  free: { maxLearners: 1, stories: 2, activities: 3, illustrations: 0 },
  basic: { maxLearners: 1, stories: 8, activities: 12, illustrations: 3 },
  family_premium: { maxLearners: 3, stories: 20, activities: 30, illustrations: 10 },
  plus_family: { maxLearners: 5, stories: 40, activities: 60, illustrations: 20 },
} as const;

export function normalizePlanCode(value: string | null | undefined): PlanCode {
  if (value === 'family') return 'family_premium';
  if (value === 'premium') return 'plus_family';
  if (value === 'basic' || value === 'family_premium' || value === 'plus_family') return value;
  return 'free';
}

export function getPlanLimits(value: string | null | undefined) {
  return PLAN_LIMITS[normalizePlanCode(value)];
}
