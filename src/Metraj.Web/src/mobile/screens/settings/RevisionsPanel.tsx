import { useState } from 'react';
import { api } from '../../../api';
import type { Revision } from '../../../types';
import { Icon, haptic } from '../../components';
import { EmptyState, ErrorState, ScreenHeader } from '../../shell';
import { actions, loadKeys, useLoad, useRevisionsOf, useSelectedProject, useSelectedRevision } from '../../store';
import { ConfirmSheet } from '../library/shared/ConfirmSheet';
import { Notice } from '../library/shared/FormParts';
import { perform } from '../library/shared/perform';
import { closeProjectScreens } from './settingsData';
import {
  REVISION_STATUS_TEXT,
  approveConsequences,
  canApproveRevision,
  formatDateTime,
  isRevisionLocked,
} from './settingsModel';

/**
 * Revizyonlar: liste, yeni taslak (düzenleme kopyası) ve onaylama. Onay geri alınamaz;
 * panel sonucu önceden anlatır. Onaylı revizyon kilitlidir, değişiklik için yeni taslak açılır.
 */
export function RevisionsPanel() {
  const project = useSelectedProject();
  const selected = useSelectedRevision();
  const revisions = useRevisionsOf(project?.id ?? null);
  const load = useLoad(project ? loadKeys.revisions(project.id) : 'revisions:none');
  const [approving, setApproving] = useState(false);
  // Sunucu aynı anda tek taslağa izin verir; düğmeyi kapatıp nedenini yazmak, hata almaktan iyidir.
  const hasDraft = revisions.some((revision) => revision.status === 'Draft');

  const choose = (revision: Revision) => {
    if (revision.id === selected?.id) return;
    haptic('tick');
    closeProjectScreens();
    void actions.selectRevision(revision.id);
  };

  const createDraft = async () => {
    if (!project) return;
    const result = await perform(() => api.post<Revision>(`/projects/${project.id}/revisions`), {
      success: (created) => `${created.code} düzenleme kopyası hazır.`,
      error: 'Yeni revizyon oluşturulamadı.',
    });
    if (!result.ok) return;
    await actions.loadRevisions(project.id);
    void actions.loadProjects();
    closeProjectScreens();
    void actions.selectRevision(result.value.id);
  };

  const approve = async () => {
    if (!project || !selected) return false;
    const result = await perform(() => api.post(`/revisions/${selected.id}/approve`), {
      success: `${selected.code} onaylandı ve kilitlendi.`,
      error: 'Revizyon onaylanamadı.',
    });
    if (!result.ok) return false;
    await actions.loadRevisions(project.id);
    actions.invalidateResources('');
    await actions.refreshRevision();
  };

  if (!project)
    return (
      <div className="m-detail">
        <ScreenHeader title="Revizyonlar" />
        <EmptyState icon="project" title="Önce bir proje seçin" message="Üstteki “Proje seç” ile bir proje açın." />
      </div>
    );

  return (
    <div className="m-detail">
      <ScreenHeader title="Revizyonlar" subtitle={project.name} />
      <div className="m-detail__scroll">
        {load.status === 'error' && !revisions.length ? (
          <ErrorState message={load.error} onRetry={() => void actions.loadRevisions(project.id)} />
        ) : (
          <ul className="m-choice-list m-set-revisions" aria-label="Revizyonlar">
            {revisions.map((revision) => {
              const locked = isRevisionLocked(revision);
              return (
                <li key={revision.id}>
                  <button
                    type="button"
                    className="m-choice"
                    aria-current={revision.id === selected?.id ? 'true' : undefined}
                    onClick={() => choose(revision)}
                  >
                    <span className="m-choice__text">
                      <strong>{revision.code}</strong>
                      <small>
                        {REVISION_STATUS_TEXT[revision.status]}
                        {revision.approvedAtUtc ? ` · ${formatDateTime(revision.approvedAtUtc)}` : ''}
                      </small>
                      <small>Oluşturuldu: {formatDateTime(revision.createdAtUtc)}</small>
                    </span>
                    {locked && <Icon name="lock" label="Kilitli" />}
                    {revision.id === selected?.id && <Icon name="check" label="Seçili" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="m-set-note">
          <Notice tone="info">
            Onaylanan revizyon korunur; değişiklik için yeni bir düzenleme kopyası açılır. Kopya, seçili revizyonun
            kartlarını ve ölçümlerini taşır.
          </Notice>
          {hasDraft && (
            <p id="m-set-draft-hint" className="m-muted">
              Zaten düzenlenebilir bir taslak var. Yeni kopya açmak için önce onu onaylayın.
            </p>
          )}
        </div>
      </div>
      <div className="m-bottom-actions m-bottom-actions--row">
        <button
          type="button"
          className="m-btn m-btn--secondary m-btn--large"
          disabled={hasDraft}
          aria-describedby={hasDraft ? 'm-set-draft-hint' : undefined}
          onClick={() => void createDraft()}
        >
          <Icon name="plus" size={20} />
          Yeni taslak
        </button>
        <button
          type="button"
          className="m-btn m-btn--primary m-btn--large"
          disabled={!canApproveRevision(selected)}
          onClick={() => setApproving(true)}
        >
          <Icon name="lock" size={20} />
          Onayla
        </button>
      </div>
      <ConfirmSheet
        open={approving}
        onClose={() => setApproving(false)}
        title={selected ? `${selected.code} onaylansın mı?` : 'Revizyon onaylansın mı?'}
        description="Onay geri alınamaz."
        confirmLabel="Onayla ve kilitle"
        onConfirm={approve}
      >
        <ul>
          {approveConsequences(selected?.code ?? 'Revizyon').map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </ConfirmSheet>
    </div>
  );
}
