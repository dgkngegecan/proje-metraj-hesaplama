import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';

interface ContextNote {
  id: string;
  placementId: string;
  block?: string | null;
  floor?: string | null;
  room?: string | null;
  text: string;
  createdAtUtc: string;
}
const empty = { block: '', floor: '', room: '', text: '' };

/** These are independent site exceptions, never temporary measurement input. */
export function ContextNotes({ placementId, canEdit }: { placementId: string; canEdit: boolean }) {
  const [notes, setNotes] = useState<ContextNote[]>([]);
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const explain = (error: unknown) => setError(error instanceof ApiError ? error.message : 'Not kaydedilemedi. Tekrar deneyin.');
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void api.get<ContextNote[]>(`/placements/${placementId}/context-notes`).then((rows) => {
      if (!cancelled) setNotes(rows);
    }).catch((error) => { if (!cancelled) explain(error); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [placementId]);

  const save = async () => {
    if (!canEdit || saving || !draft.text.trim()) return;
    setSaving(true); setError('');
    try {
      const created = await api.post<ContextNote>(`/placements/${placementId}/context-notes`, draft);
      setNotes((current) => [...current, created]);
      setDraft(empty); setEditing(false);
    } catch (error) { explain(error); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    if (!canEdit || saving) return;
    setSaving(true); setError('');
    try {
      await api.delete(`/placement-context-notes/${id}`);
      setNotes((current) => current.filter((item) => item.id !== id));
      setDeleteId(null);
    } catch (error) { explain(error); }
    finally { setSaving(false); }
  };
  return (
    <section className="context-notes" aria-label="Kat ve mahal farklılıkları">
      <div className="context-notes-heading">
        <h4>Kat / mahal farklılıkları {notes.length > 0 && <span>({notes.length})</span>}</h4>
        <button disabled={!canEdit || saving || loading} onClick={() => setEditing(!editing)} aria-expanded={editing}>+ Yeni not</button>
      </div>
      <p className="muted">Bu katta veya mahalde farklı yapılan ya da yapılacak işi kaydedin.</p>
      {error && <p role="alert" className="context-note-error">{error}</p>}
      {loading && <small role="status">Notlar yükleniyor…</small>}
      <div className="context-note-list">
        {notes.map((note) => <article className="context-note" key={note.id}>
          <header><strong>{[note.block && `Blok ${note.block}`, note.floor && `Kat ${note.floor}`, note.room].filter(Boolean).join(' · ') || 'Genel açıklama'}</strong>
            {canEdit && <button className="danger-link" disabled={saving} aria-label="Bu notu sil" onClick={() => setDeleteId(deleteId === note.id ? null : note.id)}>Sil</button>}
          </header>
          <p>{note.text}</p>
          {deleteId === note.id && <div className="inline-actions"><button disabled={saving} onClick={() => void remove(note.id)}>Silmeyi onayla</button><button onClick={() => setDeleteId(null)}>Vazgeç</button></div>}
        </article>)}
      </div>
      {editing && <form className="context-note-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>Blok<input value={draft.block} maxLength={128} disabled={saving || !canEdit} onChange={(event) => setDraft({ ...draft, block: event.target.value })} /></label>
        <label>Kat<input value={draft.floor} maxLength={128} disabled={saving || !canEdit} placeholder="Örn. 2. kat" onChange={(event) => setDraft({ ...draft, floor: event.target.value })} /></label>
        <label className="wide">Mahal<input value={draft.room} maxLength={256} disabled={saving || !canEdit} placeholder="Örn. Mutfak / Banyo" onChange={(event) => setDraft({ ...draft, room: event.target.value })} /></label>
        <label className="wide">Farklılık / yapılacak iş<textarea rows={3} value={draft.text} maxLength={4000} required disabled={saving || !canEdit} placeholder="Örn. Bu katta boru güzergâhı tavan yerine şafttan geçecek." onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></label>
        <div className="inline-actions wide"><button className="primary" type="submit" disabled={saving || !canEdit || !draft.text.trim()}>{saving ? 'Kaydediliyor…' : 'Notu kaydet'}</button><button type="button" disabled={saving} onClick={() => setEditing(false)}>Vazgeç</button></div>
      </form>}
    </section>
  );
}
