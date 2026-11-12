'use client';

import Link from 'next/link';
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
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      setMessage(error
        ? 'No pudimos enviar el enlace. Revisa el correo e inténtalo de nuevo.'
        : 'Revisa tu correo: te enviamos un enlace seguro para entrar a tu espacio familiar.');
    } catch {
      setMessage('No fue posible conectar con el servicio de acceso. Inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <Link href="/" className="brand-lockup">
          <span className="brand-mark">✦</span>
          <span><strong>Cuentos Mágicos</strong><small>UNIVERSO DE APRENDIZAJE</small></span>
        </Link>
        <div className="eyebrow">ESPACIO PARA ADULTOS</div>
        <h1>Tu familia tiene un mundo por descubrir.</h1>
        <p className="auth-intro">Accede con tu correo electrónico. Te enviaremos un enlace seguro para entrar, sin necesidad de recordar otra contraseña.</p>
        <form className="auth-form" onSubmit={submit}>
          <label className="field">Correo electrónico
            <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" />
          </label>
          <button className="button button-primary button-large form-submit" type="submit" disabled={loading}>
            {loading ? 'Enviando enlace…' : 'Enviar enlace de acceso'} <span aria-hidden="true">→</span>
          </button>
        </form>
        {message && <p className="auth-message" role="status">{message}</p>}
        <Link className="auth-back" href="/">← Volver a Cuentos Mágicos</Link>
      </section>
    </main>
  );
}
