import { useState } from 'react';
import { api } from '../../../api';
import type { Placement, ResponsibilityData } from '../../../types';
import { ChipGrid, Icon } from '../../components';
import { EmptyState, ErrorState, ScreenHeader, SkeletonList } from '../../shell';
import { actions, useIsRevisionLocked, usePlacements, useSelectedRevision } from '../../store';
import { FormSheet } from '../library/shared/FormSheet';
import { Notice, Section, SelectField, TextField } from '../library/shared/FormParts';
import { perform } from '../library/shared/perform';
import { PickerField, PlacementPicker } from './PlacementPicker';
import { resourceKeys, useResponsibilities } from './settingsData';
import { ASSIGNMENT_STATE_LABEL, validateAssignment, validateNamed, type AssignmentState } from './settingsModel';

type Sheet = 'dimension' | 'party' | 'assignment' | null;
const PREVIEW = 30;

/**
 * Sorumluluklar: boyutlar ("Temin", "Montaj"…), taraflar ve kart bazında atamalar.
 * Boyut ve taraflar sabit değildir; ihtiyaç kadar eklenir.
 */
export function ResponsibilitiesPanel() {
  const revision = useSelectedRevision();
  const revisionId = revision?.id ?? null;
  const locked = useIsRevisionLocked();
  const data = useResponsibilities(revisionId);
  const placements = usePlacements(revisionId);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [showAll, setShowAll] = useState(false);

  if (!revisionId)
    return (
      <div className="m-detail">
        <ScreenHeader title="Sorumluluklar" />
        <EmptyState icon="project" title="Önce bir proje seçin" />
      </div>
    );
  if (!data.data && data.status !== 'error')
    return (
      <div className="m-detail">
        <ScreenHeader title="Sorumluluklar" subtitle={revision?.code} />
        <SkeletonList />
      </div>
    );
  if (!data.data)
    return (
      <div className="m-detail">
        <ScreenHeader title="Sorumluluklar" subtitle={revision?.code} />
        <ErrorState message={data.error} onRetry={() => data.reload()} />
      </div>
    );

  const { dimensions, parties, assignments } = data.data;
  const reload = () => actions.invalidateResources(resourceKeys.responsibilities(revisionId));

  return (
    <div className="m-detail">
      <ScreenHeader title="Sorumluluklar" subtitle={`${revision?.code} · ${assignments.length} atama`} />
      <div className="m-detail__scroll">
        {locked && (
          <div className="m-detail__notice">
            <Notice tone="warning">Bu revizyon kilitli: boyut, taraf ve atama eklenemez.</Notice>
          </div>
        )}
        <Section
          title={`Boyutlar (${dimensions.length})`}
          actions={
            !locked && (
              <button type="button" className="m-btn m-btn--ghost m-btn--small" onClick={() => setSheet('dimension')}>
                <Icon name="plus" size={18} />
                Boyut ekle
              </button>
            )
          }
        >
          {dimensions.length ? (
            <ul className="m-set-list">
              {dimensions.map((dimension) => (
                <li key={dimension.id}>
                  <strong>{dimension.name}</strong>
                  <small>{dimension.code}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-muted">
              “Temin”, “montaj” gibi sorumluluk boyutları sabit değildir; ihtiyacınız kadar ekleyin.
            </p>
          )}
        </Section>

        <Section
          title={`Taraflar (${parties.length})`}
          actions={
            !locked && (
              <button type="button" className="m-btn m-btn--ghost m-btn--small" onClick={() => setSheet('party')}>
                <Icon name="plus" size={18} />
                Taraf ekle
              </button>
            )
          }
        >
          {parties.length ? (
            <ul className="m-set-list">
              {parties.map((party) => (
                <li key={party.id}>
                  <strong>{party.name}</strong>
                  <small>{party.code}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-muted">Henüz taraf yok (ör. taşeron, ana yüklenici).</p>
          )}
        </Section>

        <Section
          title={`Atamalar (${assignments.length})`}
          actions={
            !locked && (
              <button
                type="button"
                className="m-btn m-btn--ghost m-btn--small"
                disabled={!dimensions.length}
                onClick={() => setSheet('assignment')}
              >
                <Icon name="plus" size={18} />
                Atama ekle
              </button>
            )
          }
        >
          {!dimensions.length && !locked && <p className="m-muted">Atama için önce bir boyut ekleyin.</p>}
          {assignments.length ? (
            <>
              <ul className="m-set-list">
                {(showAll ? assignments : assignments.slice(0, PREVIEW)).map((assignment) => (
                  <li key={assignment.id}>
                    <strong>{assignment.placementName ?? 'Kart'}</strong>
                    <small>
                      {assignment.dimensionName} · {assignment.partyName ?? 'Taraf yok'} ·{' '}
                      {ASSIGNMENT_STATE_LABEL[assignment.state]}
                    </small>
                  </li>
                ))}
              </ul>
              {assignments.length > PREVIEW && (
                <button
                  type="button"
                  className="m-btn m-btn--secondary"
                  aria-expanded={showAll}
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? 'Daha az göster' : `Tümünü göster (${assignments.length})`}
                </button>
              )}
            </>
          ) : (
            <p className="m-muted">Henüz sorumluluk kaydı yok.</p>
          )}
        </Section>
      </div>

      <NamedSheet
        kind="dimension"
        open={sheet === 'dimension'}
        onClose={() => setSheet(null)}
        revisionId={revisionId}
        onDone={reload}
      />
      <NamedSheet
        kind="party"
        open={sheet === 'party'}
        onClose={() => setSheet(null)}
        revisionId={revisionId}
        onDone={reload}
      />
      <AssignmentSheet
        open={sheet === 'assignment'}
        onClose={() => setSheet(null)}
        revisionId={revisionId}
        data={data.data}
        placements={placements}
        onDone={reload}
      />
    </div>
  );
}

const NAMED = {
  dimension: {
    noun: 'Boyut' as const,
    title: 'Sorumluluk boyutu ekle',
    path: 'dimensions',
    codeLabel: 'Boyut kodu',
    codeHint: 'Örn. MONTAJ',
    nameLabel: 'Boyut adı',
    nameHint: 'Örn. Montaj',
    done: 'Sorumluluk boyutu eklendi.',
  },
  party: {
    noun: 'Taraf' as const,
    title: 'Taraf ekle',
    path: 'parties',
    codeLabel: 'Taraf kodu',
    codeHint: 'Örn. TASERON',
    nameLabel: 'Taraf adı',
    nameHint: 'Örn. Boru Ustası',
    done: 'Taraf eklendi.',
  },
};

function NamedSheet({
  kind,
  open,
  onClose,
  revisionId,
  onDone,
}: {
  kind: 'dimension' | 'party';
  open: boolean;
  onClose: () => void;
  revisionId: string;
  onDone: () => void;
}) {
  const meta = NAMED[kind];
  const [draft, setDraft] = useState({ code: '', name: '' });
  const [error, setError] = useState<string | null>(null);
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title={meta.title}
      submitLabel="Ekle"
      onSubmit={async () => {
        const problem = validateNamed(draft, meta.noun);
        setError(problem);
        if (problem) return false;
        const result = await perform(() => api.post(`/revisions/${revisionId}/responsibilities/${meta.path}`, draft), {
          success: meta.done,
          error: `${meta.noun} eklenemedi.`,
        });
        if (!result.ok) return false;
        setDraft({ code: '', name: '' });
        onDone();
      }}
    >
      {error && <Notice tone="error">{error}</Notice>}
      <TextField
        label={meta.codeLabel}
        value={draft.code}
        placeholder={meta.codeHint}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        onChange={(code) => setDraft({ ...draft, code })}
      />
      <TextField
        label={meta.nameLabel}
        value={draft.name}
        placeholder={meta.nameHint}
        autoComplete="off"
        onChange={(name) => setDraft({ ...draft, name })}
      />
    </FormSheet>
  );
}

function AssignmentSheet({
  open,
  onClose,
  revisionId,
  data,
  placements,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  revisionId: string;
  data: ResponsibilityData;
  placements: readonly Placement[];
  onDone: () => void;
}) {
  const [dimensionId, setDimensionId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [state, setState] = useState<AssignmentState>('Assigned');
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effectiveDimension = dimensionId || data.dimensions[0]?.id || '';
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Kart sorumluluğu ata"
      submitLabel="Atamayı kaydet"
      onSubmit={async () => {
        const problem = validateAssignment(effectiveDimension, placement?.id ?? '');
        setError(problem);
        if (problem || !placement) return false;
        const result = await perform(
          () =>
            api.post(`/revisions/${revisionId}/responsibilities/assignments`, {
              dimensionId: effectiveDimension,
              placementId: placement.id,
              partyId: partyId || null,
              state,
              notes: null,
            }),
          { success: 'Sorumluluk atandı.', error: 'Atama kaydedilemedi.' },
        );
        if (!result.ok) return false;
        setPlacement(null);
        onDone();
      }}
    >
      {error && <Notice tone="error">{error}</Notice>}
      <SelectField
        label="Boyut"
        value={effectiveDimension}
        options={data.dimensions.map((dimension) => ({ value: dimension.id, label: dimension.name }))}
        onChange={setDimensionId}
      />
      <SelectField
        label="Taraf"
        value={partyId}
        options={[
          { value: '', label: 'Atanmamış' },
          ...data.parties.map((party) => ({ value: party.id, label: party.name })),
        ]}
        onChange={setPartyId}
      />
      <PickerField
        label="Kart"
        value={placement?.displayName ?? null}
        placeholder="Kart seç"
        onClick={() => setPicker(true)}
      />
      <div className="m-field">
        <span className="m-field__label">Durum</span>
        <ChipGrid
          mode="single"
          label="Atama durumu"
          columns={2}
          value={state}
          onChange={(next) => setState(next as AssignmentState)}
          options={(Object.keys(ASSIGNMENT_STATE_LABEL) as AssignmentState[]).map((value) => ({
            value,
            label: ASSIGNMENT_STATE_LABEL[value],
          }))}
        />
      </div>
      <PlacementPicker
        open={picker}
        onClose={() => setPicker(false)}
        title="Kart seç"
        placements={placements}
        selectedId={placement?.id ?? ''}
        onSelect={setPlacement}
      />
    </FormSheet>
  );
}
