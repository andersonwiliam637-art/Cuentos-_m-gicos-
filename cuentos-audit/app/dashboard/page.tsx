'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

type Story = {
  id: string;
  title: string;
  protagonist_name: string;
  age_range: string | null;
  moral_lesson: string | null;
  story_content: string;
  created_at: string;
};
type Activity = {
  id: string;
  activity_type: string;
  title: string;
  instructions: string;
  payload: { question: string; options: string[] };
  created_at: string;
};
type Learner = { id: string; nickname: string; age: number; interests: string[] };
const activityTypes = [
  ['comprehension', 'Comprensión lectora'],
  ['math', 'Matemáticas'],
  ['science', 'Ciencia'],
  ['vocabulary', 'Vocabulario'],
  ['logic', 'Lógica'],
  ['creativity', 'Creatividad'],
  ['values', 'Valores'],
];
const typeLabel = (value: string) => activityTypes.find(([key]) => key === value)?.[1] ?? value;

export default function Dashboard() {
  const [stories, setStories] = useState<Story[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [storyLoading, setStoryLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [message, setMessage] = useState('');
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const [storyForm, setStoryForm] = useState({ protagonistName: '', age: 8, interests: '', moralLesson: 'La importancia de ayudar a los demás' });
  const [activityForm, setActivityForm] = useState({ age: 8, type: 'comprehension', topic: '' });
  const [profileForm, setProfileForm] = useState({ nickname: '', age: 8, interests: '' });
  const [profileLoading, setProfileLoading] = useState(false);

  async function loadData() {
    setLoadingData(true);
    try {
      const [storyResponse, activityResponse, learnerResponse] = await Promise.all([
        fetch('/api/stories', { cache: 'no-store' }),
        fetch('/api/activities', { cache: 'no-store' }),
        fetch('/api/learners', { cache: 'no-store' }),
      ]);
      if ([storyResponse, activityResponse, learnerResponse].some(response => response.status === 401)) {
        setNeedsAuth(true);
        return;
      }
      if (storyResponse.ok) {
        const data = await storyResponse.json();
        setStories(data.stories ?? []);
      }
      if (activityResponse.ok) {
        const data = await activityResponse.json();
        setActivities(data.activities ?? []);
      }
      if (learnerResponse.ok) {
        const data = await learnerResponse.json();
        setLearners(data.learners ?? []);
        if (data.learners?.[0]) {
          setActivityForm(current => ({ ...current, age: data.learners[0].age }));
          setProfileForm(current => ({ ...current, age: data.learners[0].age }));
        }
      }
    } catch {
      setMessage('No se pudo cargar el espacio familiar. Comprueba tu conexión e inténtalo de nuevo.');
    } finally {
      setLoadingData(false);
    }
  }

  useEffect(() => { void loadData(); }, []);

  async function createStory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStoryLoading(true);
    setMessage('');
    try {
      const interests = storyForm.interests.split(',').map(value => value.trim()).filter(Boolean);
      const response = await fetch('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          protagonistName: storyForm.protagonistName,
          age: storyForm.age,
          interests: interests.length ? interests : ['aventuras'],
          moralLesson: storyForm.moralLesson,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo crear el cuento.');
      setStories(current => [data.story, ...current]);
      setSelectedStory(data.story);
      setMessage('¡Tu nuevo cuento está listo! Ya forma parte de la biblioteca.');
      setStoryForm(current => ({ ...current, protagonistName: '', interests: '' }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear el cuento.');
    } finally {
      setStoryLoading(false);
    }
  }

  async function createActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActivityLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          age: activityForm.age,
          type: activityForm.type,
          learnerId: learners[0]?.id,
          topic: activityForm.topic || 'aprendizaje divertido',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo crear la actividad.');
      setActivities(current => [data.activity, ...current]);
      setMessage('Actividad creada. ¡Hora de aprender jugando!');
      setActivityForm(current => ({ ...current, topic: '' }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear la actividad.');
    } finally {
      setActivityLoading(false);
    }
  }

  async function createLearner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileLoading(true);
    setMessage('');
    try {
      const interests = profileForm.interests.split(',').map(value => value.trim()).filter(Boolean);
      const response = await fetch('/api/learners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: profileForm.nickname, age: profileForm.age, interests }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo crear el perfil.');
      setLearners(current => [...current, data.learner]);
      setMessage('Perfil familiar creado correctamente.');
      setProfileForm(current => ({ ...current, nickname: '', interests: '' }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo crear el perfil.');
    } finally {
      setProfileLoading(false);
    }
  }

  async function submitAnswer(activity: Activity) {
    const selected = answer[activity.id];
    if (!selected) return;
    try {
      const response = await fetch('/api/activities/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityId: activity.id, answer: selected }),
      });
      const data = await response.json();
      setMessage(response.ok
        ? (data.attempt.is_correct ? '🎉 ¡Respuesta correcta! Sigue explorando.' : '💡 Buen intento. Vuelve a pensarlo con calma.')
        : (data.error || 'No se pudo comprobar la respuesta.'));
    } catch {
      setMessage('No se pudo comprobar la respuesta. Inténtalo de nuevo.');
    }
  }

  if (needsAuth) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="brand-lockup"><span className="brand-mark">✦</span><span><strong>Cuentos Mágicos</strong><small>ESPACIO FAMILIAR</small></span></div>
          <h1>Entra para abrir tu biblioteca.</h1>
          <p className="auth-intro">El panel familiar está protegido. Inicia sesión con el correo de la persona adulta responsable.</p>
          <Link className="button button-primary button-large" href="/auth/login">Ingresar de forma segura <span>→</span></Link>
          <Link className="auth-back" href="/">Volver al inicio</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <Link href="/" className="brand-lockup"><span className="brand-mark">✦</span><span><strong>Cuentos Mágicos</strong><small>ESPACIO FAMILIAR</small></span></Link>
        <nav aria-label="Secciones del panel">
          <a href="#biblioteca">Biblioteca</a><a href="#crear">Crear</a><a href="#actividades">Actividades</a><a href="#perfiles">Perfiles</a><a href="#membresias">Membresías</a>
        </nav>
        <Link className="button button-quiet button-small" href="/">Salir al inicio ↗</Link>
      </header>

      <div className="dashboard-main">
        <section className="dashboard-hero">
          <div>
            <div className="eyebrow">TU UNIVERSO FAMILIAR</div>
            <h1>¡Hola, familia! ✨</h1>
            <p>Un nuevo día para imaginar, descubrir y aprender juntos.</p>
          </div>
          <a className="button button-light hero-action" href="#crear">Crear una aventura <span>→</span></a>
        </section>

        <section className="dashboard-stats" aria-label="Resumen de la biblioteca">
          <div className="stat-card"><span className="stat-label">CUENTOS GUARDADOS</span><strong className="stat-value">{stories.length}</strong><span className="stat-hint">Historias en tu biblioteca</span></div>
          <div className="stat-card"><span className="stat-label">ACTIVIDADES</span><strong className="stat-value">{activities.length}</strong><span className="stat-hint">Retos listos para explorar</span></div>
          <div className="stat-card"><span className="stat-label">PERFILES INFANTILES</span><strong className="stat-value">{learners.length}</strong><span className="stat-hint">Pequeños grandes exploradores</span></div>
        </section>

        {message && <div className="status-message" role="status">{message}</div>}
        {loadingData ? <div className="empty-state"><strong>Preparando tu biblioteca…</strong>Estamos organizando las historias de tu familia.</div> : (
          <div className="dashboard-grid">
            <section className="panel" id="crear">
              <div className="panel-heading"><div><h2>Crear un cuento</h2><p>Una historia única, con el niño como protagonista.</p></div><span className="panel-icon">📖</span></div>
              <form className="form-grid" onSubmit={createStory}>
                <label className="field field-full">Nombre o apodo del protagonista
                  <input required maxLength={60} value={storyForm.protagonistName} onChange={e => setStoryForm(current => ({ ...current, protagonistName: e.target.value }))} placeholder="Ej. Alex" />
                </label>
                <label className="field">Edad
                  <select value={storyForm.age} onChange={e => setStoryForm(current => ({ ...current, age: Number(e.target.value) }))}>{Array.from({ length: 10 }, (_, index) => index + 3).map(age => <option key={age} value={age}>{age} años</option>)}</select>
                </label>
                <label className="field">Intereses
                  <input value={storyForm.interests} onChange={e => setStoryForm(current => ({ ...current, interests: e.target.value }))} placeholder="Espacio, animales, magia…" />
                </label>
                <label className="field field-full">Aprendizaje que queremos compartir
                  <input required minLength={3} maxLength={200} value={storyForm.moralLesson} onChange={e => setStoryForm(current => ({ ...current, moralLesson: e.target.value }))} />
                </label>
                <button className="button button-primary form-submit" disabled={storyLoading}>{storyLoading ? 'Escribiendo la historia…' : '✦ Crear mi cuento'}</button>
              </form>
            </section>

            <section className="panel">
              <div className="panel-heading"><div><h2>Diseñar una actividad</h2><p>Transforma la curiosidad en un pequeño reto.</p></div><span className="panel-icon">🧩</span></div>
              <form className="form-grid" onSubmit={createActivity}>
                <label className="field">Tipo de actividad
                  <select value={activityForm.type} onChange={e => setActivityForm(current => ({ ...current, type: e.target.value }))}>{activityTypes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                </label>
                <label className="field">Edad
                  <select value={activityForm.age} onChange={e => setActivityForm(current => ({ ...current, age: Number(e.target.value) }))}>{Array.from({ length: 9 }, (_, index) => index + 4).map(age => <option key={age} value={age}>{age} años</option>)}</select>
                </label>
                <label className="field field-full">Tema para explorar
                  <input value={activityForm.topic} onChange={e => setActivityForm(current => ({ ...current, topic: e.target.value }))} maxLength={300} placeholder="Ej. los planetas, sumas, animales marinos…" />
                </label>
                <button className="button button-primary form-submit" disabled={activityLoading}>{activityLoading ? 'Preparando reto…' : '✦ Crear actividad'}</button>
              </form>
            </section>

            <section className="panel panel-wide" id="biblioteca">
              <div className="panel-heading"><div><h2>La biblioteca familiar</h2><p>Las historias creadas para volver a leerlas cuando quieran.</p></div><span className="panel-icon">🌙</span></div>
              {stories.length === 0 ? <div className="empty-state"><strong>Tu primer cuento está por nacer.</strong>Completa el formulario de creación y aparecerá aquí como parte de tu colección.</div> : (
                <div className="story-grid">
                  {stories.map((story, index) => <button type="button" className="story-tile" key={story.id} onClick={() => setSelectedStory(story)}>
                    <span className="story-symbol">{['✦', '☾', '✺'][index % 3]}</span>
                    <small>CUENTO PERSONALIZADO · {story.age_range ?? 'Aventura'}</small>
                    <strong>{story.title}</strong>
                    <span>Protagonista: {story.protagonist_name} · Abrir historia ↗</span>
                  </button>)}
                </div>
              )}
            </section>

            <section className="panel" id="actividades">
              <div className="panel-heading"><div><h2>Retos para aprender</h2><p>Actividades listas para responder.</p></div><span className="panel-icon">⭐</span></div>
              {activities.length === 0 ? <div className="empty-state"><strong>Aún no hay retos.</strong>Crea una actividad para comenzar a explorar.</div> : (
                <div className="activity-list">
                  {activities.map(activity => <article className="activity-item" key={activity.id}>
                    <div className="activity-meta">{typeLabel(activity.activity_type)} · {new Date(activity.created_at).toLocaleDateString('es-GT')}</div>
                    <h3>{activity.title}</h3><p>{activity.instructions}</p><p><strong>{activity.payload.question}</strong></p>
                    <div className="answer-options">
                      {activity.payload.options?.length ? activity.payload.options.map(option => <button type="button" className={`answer-chip ${answer[activity.id] === option ? 'selected' : ''}`} key={option} onClick={() => setAnswer(current => ({ ...current, [activity.id]: option }))}>{option}</button>) : <input className="field" value={answer[activity.id] ?? ''} onChange={e => setAnswer(current => ({ ...current, [activity.id]: e.target.value }))} placeholder="Escribe tu respuesta" />}
                    </div>
                    <button type="button" className="answer-submit" onClick={() => void submitAnswer(activity)} disabled={!answer[activity.id]}>Comprobar respuesta</button>
                  </article>)}
                </div>
              )}
            </section>

            <section className="panel" id="perfiles">
              <div className="panel-heading"><div><h2>Exploradores de la familia</h2><p>Perfiles infantiles gestionados por el adulto.</p></div><span className="panel-icon">🧡</span></div>
              {learners.length === 0 ? <div className="empty-state"><strong>Agrega el primer perfil.</strong>Usa un apodo; no necesitamos nombres legales para personalizar el aprendizaje.</div> : (
                <div className="profile-list">
                  {learners.map((learner, index) => <div className="profile-chip" key={learner.id}><div className="profile-avatar">{['🦊', '🐻', '🐼', '🦉', '🐯'][index % 5]}</div><strong>{learner.nickname}</strong><small>{learner.age} años · {learner.interests?.slice(0, 2).join(', ') || 'Explorador'}</small></div>)}
                </div>
              )}
              <form className="form-grid" onSubmit={createLearner}>
                <label className="field">Apodo
                  <input required maxLength={40} value={profileForm.nickname} onChange={e => setProfileForm(current => ({ ...current, nickname: e.target.value }))} placeholder="Ej. Pequeño explorador" />
                </label>
                <label className="field">Edad
                  <select value={profileForm.age} onChange={e => setProfileForm(current => ({ ...current, age: Number(e.target.value) }))}>{Array.from({ length: 9 }, (_, index) => index + 4).map(age => <option key={age} value={age}>{age} años</option>)}</select>
                </label>
                <label className="field field-full">Intereses (separados por coma)
                  <input value={profileForm.interests} onChange={e => setProfileForm(current => ({ ...current, interests: e.target.value }))} placeholder="Dinosaurios, dibujo, espacio…" />
                </label>
                <button className="button button-outline form-submit" disabled={profileLoading}>{profileLoading ? 'Guardando…' : '＋ Agregar perfil'}</button>
              </form>
            </section>

            <section className="panel panel-wide" id="membresias">
              <div className="panel-heading"><div><h2>Tu próxima aventura familiar</h2><p>Los planes mensuales incluyen límites transparentes para mantener la experiencia sostenible.</p></div><span className="panel-icon">✧</span></div>
              <div className="profile-list">
                <div className="profile-chip"><div className="profile-avatar">✦</div><strong>Mágico Básico · Q99</strong><small>1 perfil · 8 cuentos · 12 actividades · 3 ilustraciones al mes</small></div>
                <div className="profile-chip"><div className="profile-avatar">✧</div><strong>Familiar Premium · Q199</strong><small>3 perfiles · 20 cuentos · 30 actividades · 10 ilustraciones al mes</small></div>
                <div className="profile-chip"><div className="profile-avatar">✺</div><strong>Plus Familiar · Q349</strong><small>5 perfiles · 40 cuentos · 60 actividades · 20 ilustraciones al mes</small></div>
              </div>
              <p className="panel-heading"><span>Próximamente: pagos de suscripción con Recurrente y Binance Pay una vez configurados los enlaces y la confirmación segura.</span></p>
              <Link className="button button-outline" href="/#planes">Comparar todos los beneficios <span>→</span></Link>
            </section>
          </div>
        )}
        <footer className="dashboard-footer"><span>La cuenta y los perfiles son administrados por una persona adulta responsable.</span><Link href="/">Cuentos Mágicos · Inicio</Link></footer>
      </div>

      {selectedStory && <div className="story-reader" role="dialog" aria-modal="true" aria-label={selectedStory.title} onClick={() => setSelectedStory(null)}>
        <article className="reader-card" onClick={event => event.stopPropagation()}>
          <button className="reader-close" type="button" onClick={() => setSelectedStory(null)} aria-label="Cerrar">×</button>
          <div className="eyebrow">BIBLIOTECA MÁGICA · {selectedStory.protagonist_name}</div>
          <h2>{selectedStory.title}</h2>
          <p>{selectedStory.story_content}</p>
          {selectedStory.moral_lesson && <div className="status-message"><strong>Aprendizaje:</strong> {selectedStory.moral_lesson}</div>}
        </article>
      </div>}
    </main>
  );
}
