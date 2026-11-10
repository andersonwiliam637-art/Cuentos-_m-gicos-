import Link from 'next/link';

export default function Home() {
  return <main className="container"><div className="card"><h1>✨ Cuentos Mágicos AI</h1><p className="muted">Aventuras educativas personalizadas, creadas para aprender jugando.</p><div className="actions"><Link href="/auth/login">Entrar como adulto →</Link><Link href="/dashboard">Ir al dashboard →</Link></div></div></main>;
}
