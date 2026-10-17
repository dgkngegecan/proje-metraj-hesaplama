import { useMemo, useState } from 'react';
import { variantName } from '../../../lib/catalogData';
import { fittingChoices } from '../../../lib/fittingChoices';
import { measurementVariantOf, quantity } from '../../../lib/format';
import type { CatalogCardVariant, Placement } from '../../../types';
import { ChipGrid, KeypadSheet, Stepper, haptic, type KeypadResult } from '../../components';
import { actions, draftKey, useDraft, useMeasurementsOf } from '../../store';
import { saveDeps } from './deps';
import { saveMeasurementRows } from './entrySave.ts';
import {
  countOf,
  fittingSubmission,
  mergeCounts,
  pendingForDiameter,
  pendingTotal,
  readFittingBoxes,
  remainingAfterSubmit,
  setCount,
  toDraftBoxes,
  MAX_FITTING_COUNT,
  type FittingCounts,
} from './fittingModel.ts';
import { matchesVariant, orderByRecentUse } from './pipeModel.ts';
import type { MeasureContext } from './context.ts';

const integerOnly = (result: KeypadResult) =>
  result.number < 0
    ? 'Adet eksi olamaz.'
    : !Number.isInteger(result.number)
      ? 'Adet tam sayı olmalı.'
      : result.number > MAX_FITTING_COUNT
        ? 'Adet çok büyük.'
        : null;

/**
 * Fitting adet girişi: bağlı borunun çaplarından birini seç, her parça türü için
 * büyük artırıcıyla say, "Hepsini ekle" tek toplu kayıttır (`/measurements/batch`).
 * Bekleyen adetler `fitting-draft.v1.{id}` taslağında (masaüstüyle aynı biçim)
 * durur ve yalnız başarıyla eklenince silinir; kayıt başarısız olursa sayım kaybolmaz.
 */
export function FittingEntry({
  placement,
  placements,
  revisionId,
  locked,
  context,
}: {
  placement: Placement;
  placements: readonly Placement[];
  revisionId: string;
  locked: boolean;
  context: MeasureContext;
}) {
  const probe = useMemo(() => fittingChoices(placement, [...placements], []), [placement, placements]);
  const parentMeasurements = useMeasurementsOf(probe.parentPipe?.id ?? null);
  const choices = useMemo(
    () => fittingChoices(placement, [...placements], [...parentMeasurements]),
    [placement, placements, parentMeasurements],
  );
  const ordered = useMemo(() => orderByRecentUse(choices.diameters, parentMeasurements), [choices, parentMeasurements]);
  const compatibleFor = useMemo(
    () => (code: string) => {
      const selected = choices.diameters.find((item) => item.code === code);
      return selected ? choices.compatibleVariants(selected) : [];
    },
    [choices],
  );

  const [raw, setRaw] = useDraft<unknown>(draftKey('fitting-draft', placement.id), null);
  const validDiameters = useMemo(() => {
    const variants = choices.parentPipe?.variants;
    return variants?.length ? new Set(variants.map((item) => item.code.toLowerCase())) : null;
  }, [choices.parentPipe]);
  const boxes = useMemo(
    () =>
      readFittingBoxes(raw, {
        placementId: placement.id,
        firstDiameter: ordered[0]?.code ?? 'GENEL',
        validDiameters,
      }),
    [raw, placement.id, ordered, validDiameters],
  );
  const counts = useMemo(() => mergeCounts(boxes), [boxes]);
  const savedDiameter = boxes[0]?.diameter;
  const [chosen, setChosen] = useState<string | null>(null);
  const active =
    [chosen, savedDiameter].find((code) => code && ordered.some((item) => item.code === code)) ??
    ordered[0]?.code ??
    'GENEL';
  const activeVariant = ordered.find((item) => item.code === active);

  const [saving, setSaving] = useState(false);
  const [typing, setTyping] = useState<{ kind: string; label: string } | null>(null);
  const [expression, setExpression] = useState('');

  const persist = (next: FittingCounts, diameter = active) => {
    const anyPositive = Object.values(next).some((byKind) => Object.values(byKind).some((count) => count > 0));
    setRaw(anyPositive ? toDraftBoxes(placement.id, diameter, next) : null);
  };
  const change = (kind: string, value: number) => {
    const next = setCount(counts, active, kind, value);
    if (next !== counts) persist(next);
  };

  const submission = useMemo(
    () => fittingSubmission(placement, counts, choices.diameters, compatibleFor),
    [placement, counts, choices.diameters, compatibleFor],
  );
  const total = pendingTotal(submission);
  const locked2 = locked || saving;

  const submit = async () => {
    if (locked2 || !submission.rows.length) return;
    setSaving(true);
    const outcome = await saveMeasurementRows(saveDeps, { revisionId, placement, rows: submission.rows, context });
    setSaving(false);
    if (outcome.ok) {
      haptic('confirm');
      persist(remainingAfterSubmit(counts, submission.submitted));
      void actions.refreshSummaries(revisionId);
      actions.invalidateResources(`report:${revisionId}`);
    }
  };

  const enteredFor = (item: CatalogCardVariant) =>
    choices.entered.some((row) => matchesVariant(measurementVariantOf(row), item));

  if (!ordered.length)
    return (
      <section className="m-section">
        <h2 className="m-section__title">Çap ve parça seçenekleri</h2>
        <p className="m-muted">Bağlı borunun malzeme ve çaplarına uygun seçenek bulunamadı.</p>
      </section>
    );

  const kinds = compatibleFor(active);
  return (
    <section className="m-section" aria-labelledby="m-fit-title">
      <h2 id="m-fit-title" className="m-section__title">
        {choices.dimensional ? 'Çap ve parça sayımı' : 'Parça / malzeme sayımı'}
      </h2>
      {choices.dimensional && (
        <>
          <p className="m-proj-note">
            {choices.filtered
              ? `Bağlı boruda ölçümü girilen çaplar gösteriliyor (${ordered.length} çap).`
              : choices.parentPipe
                ? 'Bağlı boruda henüz ölçüm yok; kartta tanımlı tüm çaplar gösteriliyor.'
                : 'Çap seçin; her çapın adetleri ayrı tutulur.'}
          </p>
          <ChipGrid
            mode="single"
            label="Çap"
            columns={3}
            value={active}
            onChange={(code) => {
              setChosen(code);
              if (savedDiameter && savedDiameter !== code) persist(counts, code);
            }}
            options={ordered.map((item) => ({
              value: item.code,
              label: variantName(item),
              hint: enteredFor(item) ? 'girilmiş' : undefined,
              badge: pendingForDiameter(counts, item.code) || undefined,
            }))}
          />
        </>
      )}
      <h3 className="m-proj-subtitle">
        {activeVariant ? variantName(activeVariant) : active}
        {pendingForDiameter(counts, active) > 0 && (
          <span className="m-muted m-num"> · bekleyen {pendingForDiameter(counts, active)}</span>
        )}
      </h3>
      <ul className="m-proj-counters">
        {kinds.map((kind) => {
          const count = countOf(counts, active, kind.code);
          return (
            <li key={kind.code} className="m-proj-counter">
              <span className="m-proj-counter__label">{variantName(kind)}</span>
              <Stepper
                size="compact"
                label={`${variantName(kind)} adedi`}
                value={count}
                min={0}
                max={MAX_FITTING_COUNT}
                disabled={locked2}
                onChange={(value) => change(kind.code, value)}
                onValuePress={() => {
                  if (locked2) return;
                  setExpression(count ? String(count) : '');
                  setTyping({ kind: kind.code, label: variantName(kind) });
                }}
              />
            </li>
          );
        })}
      </ul>
      {!locked && (
        <div className="m-proj-savebar">
          <button
            type="button"
            className="m-btn m-btn--primary m-btn--large m-btn--block"
            disabled={locked2 || total === 0}
            onClick={() => void submit()}
          >
            {saving ? 'Kaydediliyor…' : total ? `Hepsini ekle · ${quantity(total)} adet` : 'Adetleri girin'}
          </button>
        </div>
      )}
      {!locked && (
        <p className="m-muted m-proj-note">
          Bekleyen adetler kart ve çap değiştirseniz de saklanır; yalnız başarıyla eklenince temizlenir.
        </p>
      )}
      <KeypadSheet
        open={typing !== null}
        onClose={() => setTyping(null)}
        title={typing?.label ?? ''}
        label="Adet"
        unit="adet"
        value={expression}
        onChange={setExpression}
        validate={integerOnly}
        saveLabel="Uygula"
        onSave={(result) => {
          if (typing) change(typing.kind, result.number);
          setTyping(null);
        }}
      />
    </section>
  );
}
