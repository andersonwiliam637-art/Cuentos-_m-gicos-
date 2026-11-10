'use client';

import { useEffect, useState } from 'react';

type Character = { id: string; name: string; description: string; visual_traits: string; favorite_interests: string[] };

export function CharacterStudio() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visualTraits, setVisualTraits] = useState('');
  const [interests, setInterests] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const res = await fetch('/api/characters');
    if (res.ok) setCharacters((await res.json()).characters ?? []);
  }
  useEffect(() => { void load(); }, []);

  async function createCharacter(e: React.FormEvent) {
    e.preventDefault(); setMessage('');
    const res = await fetch('/api/characters', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ name, description, visualTraits, favoriteInterests: interests.split(',').map(x=>x.trim()).filter(Boolean) }) });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error ?? 'No se pudo crear'); return; }
    setCharacters(prev => [data.character, ...prev]); setName(''); setDescription(''); setVisualTraits(''); setInterests(''); setMessage('Personaje creado.');
  }

  return <section className="card"><h2>🎨 Estudio de personajes</h2><form onSubmit={createCharacter}><label>Nombre<input value={name} onChange={e=>setName(e.target.value)} maxLength={60} required /></label><label>Descripción<textarea value={description} onChange={e=>setDescription(e.target.value)} maxLength={500} /></label><label>Rasgos visuales<textarea value={visualTraits} onChange={e=>setVisualTraits(e.target.value)} maxLength={500} placeholder="Cabello, colores, ropa, accesorios…" /></label><label>Intereses separados por coma<input value={interests} onChange={e=>setInterests(e.target.value)} /></label><button>Guardar personaje</button></form>{message && <p>{message}</p>}<div>{characters.map(c=><article className="character" key={c.id}><strong>{c.name}</strong><p>{c.description}</p><small>{c.visual_traits}</small></article>)}</div></section>;
}
