import { useRef, useState, type FormEvent } from 'react';
import type { Revision } from '../../types';
import { Icon } from '../components/Icon';
import { haptic } from '../components/haptics.ts';
import {
  actions,
  loadKeys,
  useBusy,
  useIsRevisionLocked,
  useLoad,
  useProjects,
  useRevisionsOf,
  useSelectedProject,
  useSelectedRevision,
} from '../store';
import { BottomSheet } from './BottomSheet';
import { notifyError, notifySuccess } from './feedback.ts';
import { shellActions } from './shellStore.ts';
import { BusyBar, ErrorState, SkeletonList } from './StatusViews';

export const REVISION_STATUS_LABEL: Record<Revision['status'], string> = {
  Draft: 'Taslak',
  Approved: 'Onaylı',
  Archived: 'Arşiv',
};

const dateFormat = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
function formatDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

/** Üst çubuk: proje ve revizyon seçici, altında meşgul çizgisi. */
export function TopBar() {
  const project = useSelectedProject();
  const revision = useSelectedRevision();
  const locked = useIsRevisionLocked();
  const busy = useBusy();
  const projectsLoad = useLoad(loadKeys.projects);
  const [sheet, setSheet] = useState<'project' | 'revision' | null>(null);

  return (
    <header className="m-topbar">
      <button
        type="button"
        className="m-topbar__project"
        onClick={() => setSheet('project')}
        aria-haspopup="dialog"
        aria-label={project ? `Açık proje: ${project.name}. Proje değiştir` : 'Proje seç'}
      >
        <span className="m-topbar__eyebrow">{project?.code ?? 'PROJE'}</span>
        <span className="m-topbar__title">
          {project?.name ?? (projectsLoad.status === 'loading' ? 'Yükleniyor…' : 'Proje seç')}
        </span>
        <Icon name="chevronDown" size={20} />
      </button>
      {project && (
        <button
          type="button"
          className={`m-revision-chip${locked ? ' is-locked' : ''}`}
          onClick={() => setSheet('revision')}
          aria-haspopup="dialog"
          aria-label={
            revision
              ? `Revizyon ${revision.code}, ${REVISION_STATUS_LABEL[revision.status]}. Revizyon değiştir`
              : 'Revizyon seç'
          }
        >
          {locked && <Icon name="lock" size={18} />}
          <span>{revision ? revision.code : '—'}</span>
          <Icon name="chevronDown" size={18} />
        </button>
      )}
      <BusyBar active={busy} />
      <ProjectSheet open={sheet === 'project'} onClose={() => setSheet(null)} />
      <RevisionSheet open={sheet === 'revision'} onClose={() => setSheet(null)} />
    </header>
  );
}

function ProjectSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projects = useProjects();
  const selected = useSelectedProject();
  const load = useLoad(loadKeys.projects);
  const [creating, setCreating] = useState(false);

  const choose = (projectId: string) => {
    haptic('tick');
    onClose();
    if (projectId === selected?.id) return;
    shellActions.resetStacks();
    void actions.selectProject(projectId);
  };

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        setCreating(false);
        onClose();
      }}
      title={creating ? 'Yeni proje' : 'Proje seç'}
      size="tall"
    >
      {creating ? (
        <NewProjectForm
          onDone={() => {
            setCreating(false);
            onClose();
          }}
        />
      ) : (
        <>
          <div className="m-action-list">
            <button type="button" className="m-action-row m-action-row--primary" onClick={() => setCreating(true)}>
              <Icon name="plus" />
              <span>
                <strong>Yeni proje</strong>
                <small>Kod ve ad girerek boş proje açın</small>
              </span>
            </button>
          </div>
          {load.status === 'error' && !projects.length ? (
            <ErrorState message={load.error} onRetry={() => void actions.loadProjects()} />
          ) : load.status === 'loading' && !projects.length ? (
            <SkeletonList rows={4} />
          ) : (
            <ul className="m-choice-list" aria-label="Projeler">
              {projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className="m-choice"
                    aria-current={project.id === selected?.id ? 'true' : undefined}
                    onClick={() => choose(project.id)}
                  >
                    <span className="m-choice__text">
                      <strong>{project.name}</strong>
                      <small>
                        {project.code} · {project.revisionCount} revizyon
                      </small>
                    </span>
                    {project.id === selected?.id && <Icon name="check" label="Seçili" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </BottomSheet>
  );
}

function NewProjectForm({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const valid = code.trim() && name.trim();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const created = await actions.createProject({ code, name });
      shellActions.resetStacks();
      shellActions.setTab('project');
      notifySuccess(`${created.name} oluşturuldu.`);
      onDone();
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="m-form" onSubmit={submit}>
      <label className="m-field">
        <span className="m-field__label">Proje kodu</span>
        <input
          className="m-input"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="Örn. P-001"
          autoCapitalize="characters"
          autoComplete="off"
          enterKeyHint="next"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              nameRef.current?.focus();
            }
          }}
        />
      </label>
      <label className="m-field">
        <span className="m-field__label">Proje adı</span>
        <input
          ref={nameRef}
          className="m-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Örn. Villa Temiz Su"
          autoComplete="off"
          enterKeyHint="done"
        />
      </label>
      <button type="submit" className="m-btn m-btn--primary m-btn--block" disabled={!valid || saving}>
        {saving ? 'Oluşturuluyor…' : 'Projeyi oluştur'}
      </button>
    </form>
  );
}

function RevisionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useSelectedProject();
  const selected = useSelectedRevision();
  const revisions = useRevisionsOf(project?.id ?? null);

  const choose = (revisionId: string) => {
    haptic('tick');
    onClose();
    if (revisionId === selected?.id) return;
    shellActions.resetStacks();
    void actions.selectRevision(revisionId);
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Revizyon seç"
      description="Onaylı revizyonlar yalnız görüntülenir. Yeni revizyonu Ayarlar > Revizyonlar'dan açın."
    >
      <ul className="m-choice-list" aria-label="Revizyonlar">
        {revisions.map((revision) => (
          <li key={revision.id}>
            <button
              type="button"
              className="m-choice"
              aria-current={revision.id === selected?.id ? 'true' : undefined}
              onClick={() => choose(revision.id)}
            >
              <span className="m-choice__text">
                <strong>
                  {revision.code} · {REVISION_STATUS_LABEL[revision.status]}
                </strong>
                <small>
                  {revision.status === 'Draft'
                    ? `Oluşturuldu ${formatDate(revision.createdAtUtc)}`
                    : `Onaylandı ${formatDate(revision.approvedAtUtc ?? revision.createdAtUtc)}`}
                </small>
              </span>
              {revision.status !== 'Draft' && <Icon name="lock" label="Kilitli" />}
              {revision.id === selected?.id && <Icon name="check" label="Seçili" />}
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}

/** Onaylı (kilitli) revizyonda kalıcı uyarı şeridi. */
export function LockBanner() {
  const locked = useIsRevisionLocked();
  const revision = useSelectedRevision();
  if (!locked || !revision) return null;
  return (
    <div className="m-lock-banner" role="status">
      <Icon name="lock" size={20} />
      <p>
        <strong>{revision.code} onaylı.</strong> Değişiklik için yeni revizyon açın.
      </p>
      <button type="button" className="m-btn m-btn--ghost m-btn--small" onClick={() => shellActions.setTab('settings')}>
        Ayarlar
      </button>
    </div>
  );
}
