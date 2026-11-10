import { NextResponse } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { enforceUserRateLimit } from '@/lib/supabase/rate-limit';
import { moderateChildInput, moderateWithOpenAI } from '@/lib/safety/content';

const requestSchema = z.object({ age:z.number().int().min(4).max(12), type:z.enum(['comprehension','math','science','vocabulary','logic','creativity','values']), storyId:z.string().uuid().optional(), characterId:z.string().uuid().optional(), learnerId:z.string().uuid().optional(), topic:z.string().trim().min(1).max(300) });
const outputSchema = z.object({ title:z.string().min(1).max(120), instructions:z.string().min(1).max(1500), question:z.string().min(1).max(600), options:z.array(z.string().min(1).max(180)).max(6).default([]), answerKey:z.string().min(1).max(500), explanation:z.string().min(1).max(800) });
function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY_MISSING');
  return new OpenAI({ apiKey });
}

export async function GET(){
  const supabase=await createClient(); const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)return NextResponse.json({error:'No autenticado'},{status:401});
  const {data,error}=await supabase.from('educational_activities').select('id,activity_type,age,title,instructions,payload,story_id,character_id,created_at').order('created_at',{ascending:false}).limit(50);
  if(error)return NextResponse.json({error:'No se pudieron cargar las actividades'},{status:500});
  return NextResponse.json({activities:(data??[]).map(a=>({...a,payload:{question:(a.payload as any)?.question,options:(a.payload as any)?.options??[]}}))});
}

export async function POST(request:Request){
  const supabase=await createClient(); const {data:auth}=await supabase.auth.getUser();
  if(!auth.user)return NextResponse.json({error:'No autenticado'},{status:401});
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:'IA no configurada'},{status:503});
  const parsed=requestSchema.safeParse(await request.json()); if(!parsed.success)return NextResponse.json({error:'Datos inválidos'},{status:400});
  if (!(await enforceUserRateLimit(supabase, auth.user.id, 'activity_generation', 10, 60))) return NextResponse.json({error:'Demasiadas solicitudes. Espera un minuto.'},{status:429});
  const {age,type,topic,storyId,characterId,learnerId}=parsed.data;
  const moderation = moderateChildInput([topic]);
  if (!moderation.allowed) { await supabase.from('safety_events').insert({user_id:auth.user.id,event_type:'input_blocked',source:'activity',risk_code:moderation.riskCode}); return NextResponse.json({error:'Ese tema no está disponible para Cuentos Mágicos.'},{status:422}); }
  if(storyId){const {data}=await supabase.from('stories').select('id').eq('id',storyId).single();if(!data)return NextResponse.json({error:'Cuento no encontrado'},{status:404});}
  if(characterId){const {data}=await supabase.from('characters').select('id').eq('id',characterId).single();if(!data)return NextResponse.json({error:'Personaje no encontrado'},{status:404});}
  if(learnerId){const {data}=await supabase.from('learner_profiles').select('id,age').eq('id',learnerId).single();if(!data)return NextResponse.json({error:'Perfil de aprendizaje no encontrado'},{status:404});if(data.age!==age)return NextResponse.json({error:'La edad no coincide con el perfil'},{status:400});}
  try{
    const openai = getOpenAI();
    const response=await openai.responses.create({model:process.env.OPENAI_TEXT_MODEL||'gpt-5-mini',input:`Create one safe educational activity for a child age ${age}. Type: ${type}. Topic: ${topic}. Never request personal information. No frightening, sexual, violent, discriminatory or manipulative content. Return JSON only with title,instructions,question,options,answerKey,explanation.`,text:{format:{type:'json_object'}}});
    const generated=outputSchema.parse(JSON.parse(response.output_text || ''));
    const outputCheck = await moderateWithOpenAI(JSON.stringify({title:generated.title,instructions:generated.instructions,question:generated.question,options:generated.options,answerKey:generated.answerKey,explanation:generated.explanation}));
    if (!outputCheck.allowed) { await supabase.from('safety_events').insert({user_id:auth.user.id,event_type:'output_blocked',source:'activity',risk_code:outputCheck.riskCode}); return NextResponse.json({error:'La actividad generada no pasó la revisión de seguridad.'},{status:422}); }
    const payload={question:generated.question,options:generated.options};
    const {data:activity,error}=await supabase.from('educational_activities').insert({user_id:auth.user.id,story_id:storyId??null,character_id:characterId??null,learner_id:learnerId??null,activity_type:type,age,title:generated.title,instructions:generated.instructions,payload}).select('id,activity_type,age,title,instructions,payload,story_id,character_id,created_at').single();
    if(error)throw error;
    const admin=createAdminClient();
    const {error:keyError}=await admin.from('educational_answer_keys').insert({activity_id:activity.id,answer_key:generated.answerKey,explanation:generated.explanation});
    if(keyError){await supabase.from('educational_activities').delete().eq('id',activity.id);throw keyError;}
    return NextResponse.json({activity:{...activity,payload:{question:generated.question,options:generated.options}}},{status:201});
  }catch(error){console.error('activity_generation_error',error);return NextResponse.json({error:'No se pudo generar la actividad'},{status:500});}
}
