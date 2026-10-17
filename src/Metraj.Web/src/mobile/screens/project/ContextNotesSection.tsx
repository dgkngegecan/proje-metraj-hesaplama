import { useMemo, useState } from 'react';
import { api } from '../../../api';
import { Icon, SwipeRow } from '../../components';
import { BottomSheet, ErrorState, notify, notifyError, notifySuccess, snackbar } from '../../shell';
import { useResource } from '../../store';
import type { MeasureContext } from './context.ts';

export interface ContextNote {
  id: string;
  placementId: string;
  block?: string | null;
  floor?: string | null;
  room?: string | null;
  text: string;
  createdAtUtc: string;
}

const noteTitle = (note: ContextNote) =>
  [note.block && `Blok ${note.block}`, note.floor && `Kat ${note.floor}`, note.room].filter(Boolean).join(' · ') ||
  'Genel açıklama';

/**
 * Bağlam notları: "bu katta boru güzergâhı şafttan geçecek" gibi kat/mahal
 * istisnaları. Ölçüm girişinden bağımsızdır (masaüstü ContextNotes ile aynı uçlar).
 * Silme onay istemez: not hemen kalkar, "Geri al" çubuğu çıkar, süre dolunca
 * sunucuya gider. Onaylı revizyonda notlar yalnız okunur.
 */
export function ContextNotesSection({
  placementId,
  locked,
  context,
}: {
  placementId: string;
  locked: boolean;
  context: MeasureContext;
}) {
  const notes = useResource<ContextNote[]>(`notes:${placementId}`, () =>
    api.get<ContextNote[]>(`/placements/${placementId}/context-notes`),
  );
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const visible = useMemo(() => (notes.data ?? []).filter((note) => !hidden.has(note.id)), [notes.data, hidden]);

  const remove = (note: ContextNote) => {
    setHidden((current) => new Set(current).add(note.id));
    const restore = () =>
      setHidden((current) => {
        const next = new Set(current);
        next.delete(note.id);
        return next;
      });
    snackbar.show({
      message: 'Not silindi.',
      action: { label: 'Geri al', onAction: restore },
      durationMs: 5000,
      onClose: (reason) => {
        if (reason === 'action') return;
        api.delete(`/placements/${placementId}/context-notes/${note.id}`).then(
          () => notes.reload(),
          (error: unknown) => {
            restore();
            notifyError(error);
          },
        );
      },
    });
  };

  return (
    <section className="m-section" aria-labelledby="m-notes-title">
      <div className="m-proj-sectionhead">
        <h2 id="m-notes-title" className="m-section__title">
          Kat / mahal notları {visible.length > 0 && <span className="m-muted">({visible.length})</span>}
        </h2>
        {!locked && (
          <button type="button" className="m-btn m-btn--secondary m-btn--small" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} />
            Yeni not
          </button>
        )}
      </div>
      {notes.status === 'error' && !notes.data ? (
        <ErrorState title="Notlar yüklenemedi" message={notes.error} onRetry={notes.reload} />
      ) : notes.status === 'loading' && !notes.data ? (
        <p className="m-muted m-proj-empty-line" role="status">
          Notlar yükleniyor…
        </p>
      ) : visible.length ? (
        <ul className="m-row-list">
          {visible.map((note) => (
            <li key={note.id}>
              <SwipeRow
                actions={
                  locked
                    ? []
                    : [{ id: 'delete', label: 'Sil', icon: 'trash', tone: 'danger', onAction: () => remove(note) }]
                }
                fullSwipeActionId="delete"
              >
                <div className="m-proj-note-row">
                  <strong>{noteTitle(note)}</strong>
                  <p>{note.text}</p>
                </div>
              </SwipeRow>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-muted m-proj-empty-line">
          Bu kartta kat veya mahala özel bir farklılık yok.
          {locked ? '' : ' “Yeni not” ile ekleyebilirsiniz.'}
        </p>
      )}
      {adding && (
        <NoteSheet
          placementId={placementId}
          context={context}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            notes.reload();
            notifySuccess('Not eklendi.');
          }}
        />
      )}
    </section>
  );
}

function NoteSheet({
  placementId,
  context,
  onClose,
  onSaved,
}: {
  placementId: string;
  context: MeasureContext;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Konum, ölçüm bağlamından önerilir: çoğu zaman not o an çalışılan yerle ilgilidir.
  const [values, setValues] = useState({ block: context.block, floor: context.floor, room: context.room, text: '' });
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof values) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (saving) return;
    if (!values.text.trim()) {
      notify('Farklılığı veya yapılacak işi yazın.', { tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      await api.post<ContextNote>(`/placements/${placementId}/context-notes`, {
        text: values.text.trim(),
        block: values.block.trim() || null,
        floor: values.floor.trim() || null,
        room: values.room.trim() || null,
      });
      onSaved();
    } catch (error) {
      notifyError(error, 'Not kaydedilemedi. Tekrar deneyin.');
      setSaving(false);
    }
  };

  return (
    <BottomSheet
      open
      onClose={onClose}
      title="Yeni not"
      dismissible={!saving}
      footer={
        <>
          <button type="button" className="m-btn m-btn--secondary m-btn--large" disabled={saving} onClick={onClose}>
            Vazgeç
          </button>
          <button
            type="button"
            className="m-btn m-btn--primary m-btn--large"
            style={{ flex: 1 }}
            disabled={saving || !values.text.trim()}
            onClick={() => void save()}
          >
            {saving ? 'Kaydediliyor…' : 'Notu kaydet'}
          </button>
        </>
      }
    >
      <form
        className="m-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="m-proj-grid2">
          <label className="m-field">
            <span className="m-field__label">Blok</span>
            <input
              className="m-input"
              value={values.block}
              maxLength={128}
              onChange={(event) => set('block')(event.target.value)}
            />
          </label>
          <label className="m-field">
            <span className="m-field__label">Kat</span>
            <input
              className="m-input"
              value={values.floor}
              maxLength={128}
              placeholder="Örn. 2"
              onChange={(event) => set('floor')(event.target.value)}
            />
          </label>
        </div>
        <label className="m-field">
          <span className="m-field__label">Mahal</span>
          <input
            className="m-input"
            value={values.room}
            maxLength={256}
            placeholder="Örn. Mutfak / Banyo"
            onChange={(event) => set('room')(event.target.value)}
          />
        </label>
        <label className="m-field">
          <span className="m-field__label">Farklılık / yapılacak iş</span>
          <textarea
            className="m-input m-proj-textarea"
            value={values.text}
            rows={4}
            maxLength={4000}
            placeholder="Örn. Bu katta boru güzergâhı tavan yerine şafttan geçecek."
            onChange={(event) => set('text')(event.target.value)}
          />
        </label>
      </form>
    </BottomSheet>
  );
}
