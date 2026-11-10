'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setLoading(false);
    setMessage(error ? 'No pudimos enviar el enlace. Revisa el correo e inténtalo de nuevo.' : 'Revisa tu correo: te enviamos un enlace seguro para entrar.');
  }

  return <main className="container"><div className="card"><h1>Entrar a Cuentos Mágicos</h1><p className="muted">La cuenta está pensada para adultos responsables.</p><form onSubmit={submit}><label>Correo electrónico<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} /></label><button disabled={loading}>{loading ? 'Enviando…' : 'Enviar enlace de acceso'}</button></form>{message && <p>{message}</p>}</div></main>;
}
