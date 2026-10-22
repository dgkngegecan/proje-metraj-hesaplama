import { useMemo, useState } from 'react';
import { api } from '../../../api';
import { quantity } from '../../../lib/format';
import type { CalculationResult, CalculationRule, Placement } from '../../../types';
import { Icon, haptic } from '../../components';
import { EmptyState, ErrorState, ScreenHeader, SkeletonList, Spinner, notifySuccess } from '../../shell';
import { actions, useIsRevisionLocked, usePlacements, useSelectedRevision } from '../../store';
import { FormSheet } from '../library/shared/FormSheet';
import { DecimalField, Notice, Section, SelectField, TextAreaField, TextField } from '../library/shared/FormParts';
import { perform } from '../library/shared/perform';
import { PickerField, PlacementPicker } from './PlacementPicker';
import {
  refreshAfterCalculationChange,
  resourceKeys,
  useCalculationResults,
  useCalculationRules,
} from './settingsData';
import {
  CALCULATION_STATUS_LABEL,
  buildOverridePayload,
  buildRulePayload,
  calculationStatusTone,
  emptyRuleDraft,
  pendingResults,
  ruleSummary,
  sortResults,
  validateCalculationLink,
  validateOverride,
  validateRejectReason,
  validateRuleDraft,
  type OverrideDraft,
  type RuleDraft,
} from './settingsModel';

type Sheet =
  | { kind: 'rule' }
  | { kind: 'calculate' }
  | { kind: 'link' }
  | { kind: 'reject'; result: CalculationResult }
  | { kind: 'override'; result: CalculationResult }
  | null;

/**
 * Hesap kuralları ve sonuçları. Kural kaynak miktarı güvenli bir çarpanla öneriye çevirir;
 * öneri "Kontrol bekliyor" durumunda doğar ve rapora ancak onaylanınca (ya da elle
 * düzeltilince) yansır. Reddetme ve elle düzeltme gerekçe ister; gerekçe raporda görünür.
 */
export function CalculationsPanel() {
  const revision = useSelectedRevision();
  const revisionId = revision?.id ?? null;
  const locked = useIsRevisionLocked();
  const rules = useCalculationRules(revisionId);
  const results = useCalculationResults(revisionId);
  const placements = usePlacements(revisionId);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => sortResults(results.data ?? []), [results.data]);
  const pending = pendingResults(sorted);
  const others = sorted.filter((result) => result.status !== 'PendingReview');
  const activeRules = (rules.data ?? []).filter((rule) => rule.isActive);

  if (!revisionId)
    return (
      <div className="m-detail">
        <ScreenHeader title="Hesaplar" />
        <EmptyState icon="project" title="Önce bir proje seçin" />
      </div>
    );
  if (!rules.data && !results.data && (rules.status === 'loading' || results.status === 'loading'))
    return (
      <div className="m-detail">
        <ScreenHeader title="Hesaplar" subtitle={revision?.code} />
        <SkeletonList />
      </div>
    );
  if (!rules.data && !results.data && (rules.error || results.error))
    return (
      <div className="m-detail">
        <ScreenHeader title="Hesaplar" subtitle={revision?.code} />
        <ErrorState
          message={rules.error ?? results.error}
          onRetry={() => {
            rules.reload();
            results.reload();
          }}
        />
      </div>
    );

  const approve = async (result: CalculationResult) => {
    setWorking(result.id);
    const done = await perform(() => api.post(`/calculations/results/${result.id}/approve`), {
      success: 'Hesap önerisi onaylandı.',
      error: 'Öneri onaylanamadı.',
    });
    setWorking(null);
    if (done.ok) refreshAfterCalculationChange();
  };

  return (
    <div className="m-detail">
      <ScreenHeader title="Hesaplar" subtitle={`${revision?.code} · ${pending.length} kontrol bekliyor`} />
      <div className="m-detail__scroll">
        {locked && (
          <div className="m-detail__notice">
            <Notice tone="warning">
              Bu revizyon kilitli: kural, öneri ve karar değişiklikleri kapalı. Yalnız görüntülenir.
            </Notice>
          </div>
        )}

        <Section title={`Kontrol bekleyenler (${pending.length})`}>
          {pending.length === 0 ? (
            <p className="m-muted">Kontrol bekleyen öneri yok.</p>
          ) : (
            <ul className="m-set-cards">
              {pending.map((result) => (
                <li key={result.id} className="m-set-card">
                  <ResultHead result={result} />
                  <ResultFigures result={result} />
                  {!locked && (
                    <div className="m-set-card__actions">
                      <button
                        type="button"
                        className="m-btn m-btn--primary"
                        disabled={working !== null}
                        onClick={() => void approve(result)}
                      >
                        {working === result.id ? <Spinner size={18} /> : <Icon name="check" size={18} />}
                        Onayla
                      </button>
                      <button
                        type="button"
                        className="m-btn m-btn--secondary"
                        disabled={working !== null}
                        onClick={() => setSheet({ kind: 'override', result })}
                      >
                        <Icon name="edit" size={18} />
                        Elle düzelt
                      </button>
                      <button
                        type="button"
                        className="m-btn m-btn--secondary m-btn--danger-text"
                        disabled={working !== null}
                        onClick={() => setSheet({ kind: 'reject', result })}
                      >
                        Reddet
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!locked && (
            <button type="button" className="m-btn m-btn--secondary" onClick={() => setSheet({ kind: 'calculate' })}>
              <Icon name="plus" size={20} />
              Yeni öneri hesapla
            </button>
          )}
        </Section>

        <Section
          title={`Kurallar (${activeRules.length})`}
          actions={
            !locked && (
              <button
                type="button"
                className="m-btn m-btn--ghost m-btn--small"
                onClick={() => setSheet({ kind: 'rule' })}
              >
                <Icon name="plus" size={18} />
                Kural ekle
              </button>
            )
          }
        >
          {activeRules.length === 0 ? (
            <p className="m-muted">
              Henüz kural yok. Kural, kaynak miktarı bir çarpanla öneriye çevirir (ör. dirsek payı ×0,2).
            </p>
          ) : (
            <ul className="m-set-list">
              {activeRules.map((rule) => (
                <li key={rule.id}>
                  <strong>{ruleSummary(rule)}</strong>
                  <small>
                    {rule.name} · {rule.mode === 'FixedMultiplier' ? 'sabit çarpan' : 'doğrudan'} · v
                    {rule.versionNumber}
                  </small>
                </li>
              ))}
            </ul>
          )}
          {!locked && (
            <button type="button" className="m-btn m-btn--secondary" onClick={() => setSheet({ kind: 'link' })}>
              Hesap kaynağı bağla
            </button>
          )}
        </Section>

        <Section title={`Önceki kararlar (${others.length})`}>
          {others.length === 0 ? (
            <p className="m-muted">Henüz karara bağlanmış öneri yok.</p>
          ) : (
            <>
              <ul className="m-set-cards">
                {(showAll ? others : others.slice(0, 5)).map((result) => (
                  <li key={result.id} className="m-set-card m-set-card--quiet">
                    <ResultHead result={result} />
                    <ResultFigures result={result} />
                  </li>
                ))}
              </ul>
              {others.length > 5 && (
                <button
                  type="button"
                  className="m-btn m-btn--secondary"
                  aria-expanded={showAll}
                  onClick={() => setShowAll(!showAll)}
                >
                  {showAll ? 'Daha az göster' : `Tümünü göster (${others.length})`}
                </button>
              )}
            </>
          )}
        </Section>
      </div>

      <RuleSheet open={sheet?.kind === 'rule'} onClose={() => setSheet(null)} revisionId={revisionId} />
      <CalculateSheet
        open={sheet?.kind === 'calculate'}
        onClose={() => setSheet(null)}
        revisionId={revisionId}
        rules={activeRules}
        placements={placements}
      />
      <LinkSheet open={sheet?.kind === 'link'} onClose={() => setSheet(null)} placements={placements} />
      <RejectSheet result={sheet?.kind === 'reject' ? sheet.result : null} onClose={() => setSheet(null)} />
      <OverrideSheet result={sheet?.kind === 'override' ? sheet.result : null} onClose={() => setSheet(null)} />
    </div>
  );
}

function ResultHead({ result }: { result: CalculationResult }) {
  return (
    <div className="m-set-card__head">
      <strong>{result.targetPlacementName}</strong>
      <span className={`m-status m-status--${calculationStatusTone(result.status)}`}>
        {CALCULATION_STATUS_LABEL[result.status]}
      </span>
    </div>
  );
}

function ResultFigures({ result }: { result: CalculationResult }) {
  return (
    <p className="m-set-card__figures m-num">
      {result.ruleCode} · önerilen {quantity(result.proposedQuantity)} {result.unit} · satın alma{' '}
      {quantity(result.purchaseQuantity)}
    </p>
  );
}

function RuleSheet({ open, onClose, revisionId }: { open: boolean; onClose: () => void; revisionId: string }) {
  const [draft, setDraft] = useState<RuleDraft>(emptyRuleDraft);
  const [error, setError] = useState<string | null>(null);
  const multiplier = draft.multiplier.trim() === '' ? null : Number(draft.multiplier.replace(',', '.'));
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Hesap kuralı ekle"
      description="Kaynak kartın miktarı bu çarpanla çarpılır; sonuç onayınıza sunulur."
      submitLabel="Kuralı ekle"
      onSubmit={async () => {
        const problem = validateRuleDraft(draft);
        setError(problem);
        if (problem) return false;
        const result = await perform(
          () => api.post(`/revisions/${revisionId}/calculations/rules`, buildRulePayload(draft)),
          { success: 'Hesap kuralı eklendi.', error: 'Kural eklenemedi.' },
        );
        if (!result.ok) return false;
        setDraft(emptyRuleDraft());
        actions.invalidateResources(resourceKeys.rules(revisionId));
      }}
    >
      {error && <Notice tone="error">{error}</Notice>}
      <TextField
        label="Kod"
        value={draft.code}
        placeholder="Örn. DIRSEK"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        onChange={(code) => setDraft({ ...draft, code })}
      />
      <TextField
        label="Ad"
        value={draft.name}
        placeholder="Örn. Dirsek payı"
        autoComplete="off"
        onChange={(name) => setDraft({ ...draft, name })}
      />
      <DecimalField
        label="Çarpan"
        suffix="×"
        value={Number.isFinite(multiplier) ? multiplier : null}
        onChange={(value) => setDraft({ ...draft, multiplier: value === null ? '' : String(value) })}
      />
    </FormSheet>
  );
}

function CalculateSheet({
  open,
  onClose,
  revisionId,
  rules,
  placements,
}: {
  open: boolean;
  onClose: () => void;
  revisionId: string;
  rules: readonly CalculationRule[];
  placements: readonly Placement[];
}) {
  const measurable = useMemo(() => placements.filter((placement) => placement.isMeasurable), [placements]);
  const [target, setTarget] = useState<Placement | null>(null);
  const [ruleId, setRuleId] = useState('');
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const effectiveRule = ruleId || rules[0]?.id || '';
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Yeni öneri hesapla"
      description="Hesaplanacak ek parçayı ve kuralı seçin. Öneri “Kontrol bekliyor” olarak listeye eklenir."
      submitLabel="Hesapla"
      submitDisabled={!rules.length}
      onSubmit={async () => {
        if (!target) return void setError('Önce hesaplanacak kartı seçin.');
        if (!effectiveRule) return void setError('Önce bir hesap kuralı ekleyin.');
        setError(null);
        const result = await perform(
          () =>
            api.post(`/revisions/${revisionId}/calculations/results`, {
              targetPlacementId: target.id,
              ruleVersionId: effectiveRule,
            }),
          { success: 'Öneri onayınıza sunuldu.', error: 'Öneri hesaplanamadı.' },
        );
        if (!result.ok) return false;
        refreshAfterCalculationChange();
      }}
    >
      {error && <Notice tone="error">{error}</Notice>}
      {!rules.length && <Notice tone="warning">Önce en az bir hesap kuralı ekleyin.</Notice>}
      <PickerField
        label="Hesaplanacak ek parça"
        value={target?.displayName ?? null}
        placeholder="Kart seç"
        onClick={() => setPicker(true)}
      />
      <SelectField
        label="Kural"
        value={effectiveRule}
        options={rules.map((rule) => ({ value: rule.id, label: ruleSummary(rule) }))}
        onChange={setRuleId}
      />
      <p className="m-muted">
        Hesap kaynağı bağlı değilse önce “Hesap kaynağı bağla” ile kaynak kartı (ör. boru) belirleyin.
      </p>
      <PlacementPicker
        open={picker}
        onClose={() => setPicker(false)}
        title="Hesaplanacak kart"
        placements={measurable}
        selectedId={target?.id ?? ''}
        onSelect={setTarget}
      />
    </FormSheet>
  );
}

function LinkSheet({
  open,
  onClose,
  placements,
}: {
  open: boolean;
  onClose: () => void;
  placements: readonly Placement[];
}) {
  const measurable = useMemo(() => placements.filter((placement) => placement.isMeasurable), [placements]);
  const [target, setTarget] = useState<Placement | null>(null);
  const [source, setSource] = useState<Placement | null>(null);
  const [picker, setPicker] = useState<'target' | 'source' | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <FormSheet
      open={open}
      onClose={onClose}
      title="Hesap kaynağı seç"
      description="Örnek: boru kartını kaynak, dirsek ya da te kartını hesaplanacak ek parça seçin."
      submitLabel="Kaynağı kaydet"
      onSubmit={async () => {
        const problem = validateCalculationLink(target?.id ?? '', source?.id ?? '');
        setError(problem);
        if (problem || !target || !source) return false;
        const result = await perform(
          () => api.post(`/placements/${target.id}/calculated-from`, { sourcePlacementId: source.id, notes: null }),
          {
            success: 'Hesap kaynağı kaydedildi. Şimdi öneri hesaplayabilirsiniz.',
            error: 'Hesap kaynağı kaydedilemedi.',
          },
        );
        if (!result.ok) return false;
        setSource(null);
      }}
    >
      {error && <Notice tone="error">{error}</Notice>}
      <PickerField
        label="Hesaplanacak ek parça"
        value={target?.displayName ?? null}
        placeholder="Kart seç"
        onClick={() => setPicker('target')}
      />
      <PickerField
        label="Bu hesabın kaynak kartı"
        value={source?.displayName ?? null}
        placeholder="Kaynak seç"
        onClick={() => setPicker('source')}
      />
      <PlacementPicker
        open={picker === 'target'}
        onClose={() => setPicker(null)}
        title="Hesaplanacak kart"
        placements={measurable}
        selectedId={target?.id ?? ''}
        excludeId={source?.id}
        onSelect={setTarget}
      />
      <PlacementPicker
        open={picker === 'source'}
        onClose={() => setPicker(null)}
        title="Kaynak kart"
        placements={measurable}
        selectedId={source?.id ?? ''}
        excludeId={target?.id}
        onSelect={setSource}
      />
    </FormSheet>
  );
}

function RejectSheet({ result, onClose }: { result: CalculationResult | null; onClose: () => void }) {
  const [reason, setReason] = useState('Kontrol sonrası uygulanmadı');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormSheet
      open={result !== null}
      onClose={onClose}
      title="Hesap önerisi uygulanmasın mı?"
      description={result ? `${result.targetPlacementName} · Gerekçe raporda görünür.` : undefined}
      submitLabel="Uygulama"
      tone="danger"
      onSubmit={async () => {
        const problem = validateRejectReason(reason);
        setError(problem);
        if (problem || !result) return false;
        const done = await perform(
          () => api.post(`/calculations/results/${result.id}/reject`, { reason: reason.trim() }),
          { error: 'Öneri reddedilemedi.' },
        );
        if (!done.ok) return false;
        haptic('confirm');
        notifySuccess('Hesap önerisi uygulanmadı.');
        refreshAfterCalculationChange();
      }}
    >
      <TextAreaField label="Gerekçe" value={reason} error={error} rows={3} onChange={setReason} />
    </FormSheet>
  );
}

function OverrideSheet({ result, onClose }: { result: CalculationResult | null; onClose: () => void }) {
  const [draft, setDraft] = useState<OverrideDraft>({ quantity: '', reason: 'Saha kontrolü sonrası düzeltildi' });
  const [errors, setErrors] = useState<{ quantity?: string; reason?: string }>({});
  // Panel her açılışında önerilen miktarla başlar.
  const [forId, setForId] = useState<string | null>(null);
  if (result && forId !== result.id) {
    setForId(result.id);
    setDraft({
      quantity: String(result.proposedQuantity).replace('.', ','),
      reason: 'Saha kontrolü sonrası düzeltildi',
    });
    setErrors({});
  }
  return (
    <FormSheet
      open={result !== null}
      onClose={() => {
        setForId(null);
        onClose();
      }}
      title={result ? `${result.targetPlacementName} için kullanılacak miktar` : 'Miktarı düzelt'}
      description={result ? `Öneri: ${quantity(result.proposedQuantity)} ${result.unit}` : undefined}
      submitLabel="Miktarı uygula"
      onSubmit={async () => {
        const found = validateOverride(draft);
        setErrors(found);
        if (found.quantity || found.reason || !result) return false;
        const done = await perform(
          () => api.post(`/calculations/results/${result.id}/override`, buildOverridePayload(draft)),
          { success: 'Miktar elle düzeltildi.', error: 'Miktar uygulanamadı.' },
        );
        if (!done.ok) return false;
        setForId(null);
        refreshAfterCalculationChange();
      }}
    >
      <TextField
        label={`Kullanılacak miktar${result ? ` (${result.unit})` : ''}`}
        value={draft.quantity}
        error={errors.quantity}
        inputMode="decimal"
        autoComplete="off"
        onChange={(value) => setDraft({ ...draft, quantity: value })}
      />
      <TextAreaField
        label="Neden elle değiştirildi?"
        value={draft.reason}
        error={errors.reason}
        rows={3}
        onChange={(reason) => setDraft({ ...draft, reason })}
      />
    </FormSheet>
  );
}
