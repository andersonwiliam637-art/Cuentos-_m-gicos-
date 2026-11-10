import { NextResponse } from 'next/server';
export async function POST() { return NextResponse.json({ error: 'La gestión de suscripciones se habilitará cuando se configure el flujo de clientes de Recurrente.' }, { status: 501 }); }
