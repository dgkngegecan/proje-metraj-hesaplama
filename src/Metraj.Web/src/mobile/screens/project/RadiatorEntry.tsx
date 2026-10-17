import { useState } from 'react';
import { quantity } from '../../../lib/format';
import {
  isSectionalRadiator,
  PANEL_TYPES,
  radiatorGroupKey,
  radiatorTypeLabel,
  type RadiatorDraft,
} from '../../../lib/radiatorChoices';
import type { Measurement, Placement } from '../../../types';
import { ChipGrid, Stepper, haptic } from '../../components';
import { BottomSheet } from '../../shell';
import { actions, draftKey, drafts, useMeasurementsOf } from '../../store';
import type { MeasureContext } from './context.ts';
import { saveDeps } from './deps';
import { saveMeasurementRows } from './entrySave.ts';
import {
  activeGroup,
  addCustomLength,
  addGroup,
  afterSubmit,
  countFor,
  groupCount,
  heightsOf,
  hydrateRadiatorDraft,
  legacyFittingKind,
  MAX_RADIATOR_COUNT,
  otherPending,
  pendingOf,
  radiatorDraftKind,
  radiatorOptionsKind,
  selectGroup,
  selectHeight,
  selectType,
  serializeDraft,
  serializePreferences,
  typesOf,
  withCount,
} from './radiatorModel.ts';

/** Anahtar üretimi başarısız olursa (kart kodunda boşluk gibi) tercih kaydı atlanır, sayım yine çalışır. */
function safeKey(kind: string, id: string): string | null {
  try {
    return draftKey(kind, id);
  } catch {
    return null;
  }
}

/**
 * Radyatör girişi: petek tipi → yükseklik → boy başına artırıcılar, tek toplu
 * kayıt. Seçenek kümesi, satır üretimi ve taslak/tercih anahtarları masaüstü
 * `RadiatorInput` ile aynıdır (`radiator-draft.v1.{id}`, `radiator-options.v1.{cardCode}`).
 * Kaydet yalnız SEÇİLİ tip ve yüksekliği gönderir; diğer gruplardaki adetler bekler.
 */
export function RadiatorEntry({
  placement,
  revisionId,
  locked,
  context,
}: {
  placement: Placement;
  revisionId: string;
  locked: boolean;
  context: MeasureContext;
}) {
  const measurements = useMeasurementsOf(placement.id) as Measurement[];
  const draftStorageKey = draftKey(radiatorDraftKind, placement.id);
  const preferenceKey = safeKey(radiatorOptionsKind, placement.cardCode);
  const [draft, setDraftState] = useState<RadiatorDraft>(() => {
    const initial = hydrateRadiatorDraft(
      placement,
      measurements,
      drafts.read(draftStorageKey),
      preferenceKey ? drafts.read(preferenceKey) : null,
      drafts.read(draftKey(legacyFittingKind, placement.id)),
    );
    // Eski fitting sayımı yalnız bir kez içe alınır: ilk anlık görüntü hemen yazılır.
    if (!drafts.read(draftStorageKey)) drafts.write(draftStorageKey, serializeDraft(initial));
    return initial;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState<{ mode: 'type' | 'height'; type: string; height: string } | null>(null);
  const [length, setLength] = useState('');

  const sectional = isSectionalRadiator(placement);
  const unit = sectional ? 'dilim' : 'adet';
  const group = activeGroup(draft);
  const frozen = locked || saving;

  const update = (next: RadiatorDraft) => {
    setDraftState(next);
    drafts.write(draftStorageKey, serializeDraft(next));
    // Tür/boy seçenekleri kataloğa özeldir (adetsiz); adetler kartlara özeldir.
    if (preferenceKey) drafts.write(preferenceKey, serializePreferences(next));
  };

  if (!group) return null;
  const types = typesOf(draft);
  const heights = heightsOf(draft, group.type);
  const pending = pendingOf(draft, placement, measurements);
  const others = otherPending(draft, placement);

  const submit = async () => {
    if (frozen || !pending.rows.length) return;
    setSaving(true);
    const outcome = await saveMeasurementRows(saveDeps, { revisionId, placement, rows: pending.rows, context });
    setSaving(false);
    if (outcome.ok) {
      haptic('confirm');
      update(afterSubmit(draft));
      setError('');
      void actions.refreshSummaries(revisionId);
      actions.invalidateResources(`report:${revisionId}`);
    } else setError('Kayıt tamamlanamadı. Bekleyen adetler korunuyor; tekrar deneyin.');
  };

  const addLength = () => {
    const result = addCustomLength(draft, length);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    update(result.draft);
    setLength('');
    setError('');
  };

  const submitForm = () => {
    if (!form) return;
    const result = addGroup(draft, placement, form);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    update(result.draft);
    setForm(null);
    setError('');
  };

  return (
    <section className="m-section" aria-labelledby="m-rad-title">
      <h2 id="m-rad-title" className="m-section__title">
        {sectional ? 'Dilim' : 'Radyatör'} sayımı
      </h2>
      <p className="m-proj-note">
        {sectional ? 'Bu kartta 1 adet = 1 dilim.' : 'Tipi ve yüksekliği seçin; saydıkça adetleri artırın.'}
      </p>

      <p className="m-field__label">1. Petek tipi</p>
      <ChipGrid
        mode="single"
        label="Petek tipi"
        columns={3}
        value={group.type}
        onChange={(type) => {
          update(selectType(draft, type));
          setLength('');
          setError('');
        }}
        options={types.map((type) => {
          const option = PANEL_TYPES.find((item) => item.type === type);
          return {
            value: type,
            label: option?.code ?? type,
            hint: option?.type,
            badge: groupCount(draft, placement, type) || undefined,
          };
        })}
      />
      <button
        type="button"
        className="m-btn m-btn--ghost m-btn--small"
        disabled={frozen}
        onClick={() => setForm({ mode: 'type', type: '', height: group.height })}
      >
        + Tip ekle
      </button>

      <p className="m-field__label">2. Yükseklik (mm)</p>
      <ChipGrid
        mode="single"
        label="Radyatör yüksekliği"
        columns={4}
        value={group.height}
        onChange={(height) => {
          update(selectHeight(draft, height));
          setLength('');
          setError('');
        }}
        options={heights.map((height) => ({
          value: height,
          label: height,
          badge: groupCount(draft, placement, group.type, height) || undefined,
        }))}
      />
      <button
        type="button"
        className="m-btn m-btn--ghost m-btn--small"
        disabled={frozen}
        onClick={() => setForm({ mode: 'height', type: group.type, height: '' })}
      >
        + Yükseklik ekle
      </button>

      <h3 className="m-proj-subtitle">
        {radiatorTypeLabel(group.type)} · H{group.height}
      </h3>
      <ul className="m-proj-counters" aria-label={`${radiatorTypeLabel(group.type)}, ${group.height} mm sayımı`}>
        {(sectional ? [''] : group.lengths).map((value) => {
          const label = sectional ? 'Dilim' : `${value} mm`;
          return (
            <li key={value} className="m-proj-counter">
              <span className="m-proj-counter__label">{label}</span>
              <Stepper
                size="compact"
                label={`${label} adedi`}
                value={countFor(draft, group, value)}
                min={0}
                max={MAX_RADIATOR_COUNT}
                disabled={frozen}
                onChange={(next) => update(withCount(draft, group, value, next))}
              />
            </li>
          );
        })}
      </ul>
      {!sectional && !locked && (
        <form
          className="m-proj-addlength"
          onSubmit={(event) => {
            event.preventDefault();
            addLength();
          }}
        >
          <label className="m-field">
            <span className="m-field__label">Özel uzunluk (mm)</span>
            <input
              className="m-input"
              inputMode="decimal"
              placeholder="Örn. 1250"
              value={length}
              disabled={frozen}
              onChange={(event) => {
                setLength(event.target.value);
                setError('');
              }}
            />
          </label>
          <button type="submit" className="m-btn m-btn--secondary" disabled={frozen || !length.trim()}>
            + Uzunluk
          </button>
        </form>
      )}
      {error && (
        <p className="m-proj-error" role="alert">
          {error}
        </p>
      )}
      {others.length > 0 && (
        <details className="m-proj-others">
          <summary>
            Diğer tip / yüksekliklerde {pending.all - pending.active} {unit} bekliyor
          </summary>
          {others.map(({ group: other, text }) => (
            <button
              key={radiatorGroupKey(other)}
              type="button"
              className="m-proj-others__row"
              onClick={() => update(selectGroup(draft, other))}
            >
              {radiatorTypeLabel(other.type)} · H{other.height}: {text}
            </button>
          ))}
        </details>
      )}
      {!locked && (
        <div className="m-proj-savebar">
          <p className="m-muted m-proj-note">
            {radiatorTypeLabel(group.type)} · {group.height} mm · {pending.rows.length} uzunluk — yalnız bu tip ve
            yükseklik kaydedilir.
          </p>
          <button
            type="button"
            className="m-btn m-btn--primary m-btn--large m-btn--block"
            disabled={frozen || pending.active === 0}
            onClick={() => void submit()}
          >
            {saving
              ? 'Kaydediliyor…'
              : pending.active
                ? `${quantity(pending.active)} ${unit} kaydet`
                : 'Adetleri girin'}
          </button>
        </div>
      )}

      <BottomSheet
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.mode === 'type' ? 'Yeni petek tipi' : 'Yeni yükseklik'}
        description="Eklediğiniz seçenekler bu katalog kartında hazır kalır."
        footer={
          <button type="button" className="m-btn m-btn--primary m-btn--large m-btn--block" onClick={submitForm}>
            Seçeneklere ekle
          </button>
        }
      >
        {form && (
          <form
            className="m-form"
            onSubmit={(event) => {
              event.preventDefault();
              submitForm();
            }}
          >
            {form.mode === 'type' ? (
              <label className="m-field">
                <span className="m-field__label">Yeni tip adı</span>
                <input
                  className="m-input"
                  value={form.type}
                  maxLength={40}
                  placeholder="Örn. Dekoratif"
                  onChange={(event) => setForm({ ...form, type: event.target.value })}
                />
              </label>
            ) : (
              <label className="m-field">
                <span className="m-field__label">Yeni yükseklik (mm)</span>
                <input
                  className="m-input"
                  inputMode="decimal"
                  value={form.height}
                  onChange={(event) => setForm({ ...form, height: event.target.value })}
                />
              </label>
            )}
            {form.mode === 'type' && (
              <label className="m-field">
                <span className="m-field__label">Başlangıç yüksekliği (mm)</span>
                <input
                  className="m-input"
                  inputMode="decimal"
                  value={form.height}
                  onChange={(event) => setForm({ ...form, height: event.target.value })}
                />
              </label>
            )}
          </form>
        )}
      </BottomSheet>
    </section>
  );
}
