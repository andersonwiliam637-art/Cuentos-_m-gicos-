import Link from 'next/link';
import { PAID_PLANS } from '@/lib/billing/plans';

const plans = PAID_PLANS;

const experiences = [
  { icon: '📖', title: 'Cuentos que nacen de su imaginación', text: 'Historias personalizadas con protagonistas, intereses y aprendizajes elegidos por la familia.' },
  { icon: '🧩', title: 'Aprender jugando', text: 'Retos de comprensión, lógica, matemáticas, ciencia, vocabulario y creatividad.' },
  { icon: '🎨', title: 'Un mundo ilustrado', text: 'Escenas originales que hacen que cada aventura se sienta como un libro especial.' },
  { icon: '🧡', title: 'Un espacio cuidado para niños', text: 'La cuenta la administra una persona adulta y el contenido pasa por controles de seguridad.' },
];

export default function Home() {
  return (
    <main className="landing-shell">
      <header className="site-nav">
        <Link href="/" className="brand-lockup" aria-label="Cuentos Mágicos, inicio">
          <span className="brand-mark">✦</span>
          <span><strong>Cuentos Mágicos</strong><small>UNIVERSO DE APRENDIZAJE</small></span>
        </Link>
        <nav className="nav-links" aria-label="Navegación principal">
          <a href="#experiencia">Experiencia</a>
          <a href="#planes">Planes</a>
          <a href="#familias">Familias</a>
        </nav>
        <div className="nav-actions">
          <Link className="button button-quiet" href="/auth/login">Ingresar</Link>
          <Link className="button button-primary button-small" href="/auth/login">Comenzar <span aria-hidden="true">↗</span></Link>
        </div>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> IMAGINACIÓN · APRENDIZAJE · FAMILIA</div>
          <h1>Donde cada historia <em>abre un mundo.</em></h1>
          <p className="hero-lede">Cuentos creados alrededor de cada niño, actividades para aprender jugando y aventuras que la familia puede compartir.</p>
          <div className="hero-actions">
            <Link className="button button-primary button-large" href="#planes">Descubrir los planes <span aria-hidden="true">→</span></Link>
            <Link className="text-link" href="/auth/login">Ya tengo una cuenta <span aria-hidden="true">↗</span></Link>
          </div>
          <div className="hero-proof">
            <span className="proof-icon">✧</span>
            <span>Un espacio creativo administrado por adultos responsables</span>
          </div>
        </div>

        <div className="hero-art" aria-label="Ilustración decorativa de un libro mágico abierto">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <span className="spark spark-a">✦</span><span className="spark spark-b">✧</span><span className="spark spark-c">✦</span>
          <div className="floating-note note-top"><span>✧</span> Una aventura nueva cada día</div>
          <div className="book-stage">
            <div className="book-glow" />
            <div className="book-cover book-left"><span className="cover-symbol">☾</span><small>EL BOSQUE<br />DE LOS SUEÑOS</small></div>
            <div className="book-cover book-right"><span className="cover-tree">✺</span><small>UNA HISTORIA<br />HECHA PARA TI</small></div>
            <div className="book-spine" />
            <div className="book-star star-one">✦</div><div className="book-star star-two">✧</div>
          </div>
          <div className="floating-note note-bottom"><span>♡</span> Aprender también puede ser mágico</div>
          <div className="floating-mini mini-one">🦊</div><div className="floating-mini mini-two">🌙</div>
        </div>
      </section>

      <section className="trust-strip" id="familias">
        <div><strong>Hecho para imaginar</strong><span>Historias que conectan con sus intereses</span></div>
        <div><strong>Aprendizaje con propósito</strong><span>Actividades adaptadas a cada etapa</span></div>
        <div><strong>La familia al centro</strong><span>Perfiles gestionados por adultos</span></div>
      </section>

      <section className="experience-section" id="experiencia">
        <div className="section-heading">
          <div className="eyebrow">MÁS QUE UNA BIBLIOTECA</div>
          <h2>Un universo hecho para <em>explorar.</em></h2>
          <p>Cada herramienta tiene un propósito: convertir la curiosidad en historias, juego y descubrimiento.</p>
        </div>
        <div className="experience-grid">
          {experiences.map((item, index) => (
            <article className="experience-card" key={item.title}>
              <div className={`experience-icon icon-tone-${index + 1}`}>{item.icon}</div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
              <span className="card-index">0{index + 1}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="plans-section" id="planes">
        <div className="section-heading plans-heading">
          <div className="eyebrow">MEMBRESÍAS MENSUALES</div>
          <h2>Elige cómo crecerá <em>su universo.</em></h2>
          <p>Tres niveles claros. Todas las funciones se presentan con sus cupos mensuales para que cada familia sepa qué incluye su plan.</p>
          <div className="billing-note"><span>✓</span> Sin licencias permanentes ni cobros anuales. Solo suscripción mensual.</div>
        </div>
        <div className="plans-grid">
          {plans.map((plan) => (
            <article className={`plan-card ${plan.featured ? 'plan-featured' : ''}`} key={plan.code}>
              {plan.featured && <div className="popular-ribbon">EQUILIBRIO FAMILIAR</div>}
              <div className="plan-topline">
                <span className="plan-orb">{plan.code === 'basic' ? '✦' : plan.code === 'family_premium' ? '✧' : '✺'}</span>
                <span className="plan-period">MENSUAL</span>
              </div>
              <h3>{plan.name}</h3>
              <p className="plan-audience">{plan.audience}</p>
              <div className="plan-price"><span>Q</span>{plan.price}<small>/ mes</small></div>
              <div className="plan-includes">
                <strong>Incluye cada mes</strong>
                <ul>
                  <li>{plan.profiles}</li>
                  <li>{plan.storiesLabel}</li>
                  <li>{plan.activitiesLabel}</li>
                  <li>{plan.illustrationsLabel}</li>
                </ul>
              </div>
              <div className="plan-divider" />
              <ul className="feature-list">
                {plan.features.map((feature) => <li key={feature}><span>✓</span>{feature}</li>)}
              </ul>
              <Link className={`button plan-button ${plan.featured ? 'button-primary' : 'button-outline'}`} href="/auth/login">Elegir {plan.name} <span aria-hidden="true">→</span></Link>
              <p className="plan-footnote">Los cupos de IA se renuevan cada mes y no se acumulan.</p>
            </article>
          ))}
        </div>
        <p className="plans-disclaimer">La generación de cuentos, actividades e ilustraciones tiene límites mensuales por cuenta. El plan Plus Familiar incluye acceso a todas las herramientas disponibles y cupos ampliados; no significa generación ilimitada.</p>
      </section>

      <section className="closing-section">
        <div className="closing-orbit">✧</div>
        <div className="eyebrow">EL PRÓXIMO CAPÍTULO COMIENZA AQUÍ</div>
        <h2>Hay un mundo esperando<br /><em>ser contado.</em></h2>
        <p>Crea el espacio de aprendizaje de tu familia y deja que la imaginación haga el resto.</p>
        <Link className="button button-light button-large" href="/auth/login">Entrar a Cuentos Mágicos <span aria-hidden="true">↗</span></Link>
      </section>

      <footer className="site-footer">
        <Link href="/" className="brand-lockup footer-brand"><span className="brand-mark">✦</span><span><strong>Cuentos Mágicos</strong><small>HISTORIAS PARA CRECER</small></span></Link>
        <span>© {new Date().getFullYear()} Cuentos Mágicos. Un universo para aprender.</span>
        <Link href="/auth/login">Acceso familiar</Link>
      </footer>
    </main>
  );
}
