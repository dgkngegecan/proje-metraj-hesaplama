import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../../../api';
import { TYPE_META } from '../../../lib/cardTypes.ts';
import type { CardDraftState } from '../../../lib/draftTypes';
import type { CardType, CatalogCard, CatalogCardVariant } from '../../../types';
import { ChipGrid, Icon, haptic } from '../../components';
import { EmptyState, ScreenHeader, Spinner, shellActions, snackbar } from '../../shell';
import { actions, draftKey, patch, useDraft } from '../../store';
import {
  addVariant,
  applyDiameterPreset,
  applyFittingPreset,
  attributeControl,
  buildCardPayload,
  draftChanged,
  draftFromCard,
  dynamicAttributes,
  emptyCardDraft,
  firstError,
  hasErrors,
  parseDiameterList,
  removeVariant,
  setVariantMode,
  updateVariant,
  validateCardDraft,
} from './cardDraft';
import { DecimalField, Notice, Section, SelectField, TextAreaField, TextField } from './shared/FormParts';
import { perform } from './shared/perform';
import { useCatalog, useCatalogAttributes, useCatalogCard } from './useCatalog';

interface StoredDraft {
  /** TaslaÄŸÄ±n dayandÄ±ÄŸÄ± sÃ¼rÃ¼m: kart bu arada deÄŸiÅŸtiyse eski taslak kullanÄ±lmaz. */
  baseVersion: number;
  draft: CardDraftState;
}

const TYPE_OPTIONS = (Object.keys(TYPE_META) as CardType[]).map((type) => ({
  value: type,
  label: TYPE_META[type].label,
}));

const MODE_OPTIONS = [
  { value: 'None', label: 'Standart', hint: 'Tek kart' },
  { value: 'Pipe', label: 'Boru', hint: 'Ã‡ap ve boy' },
  { value: 'Fitting', label: 'Fitting', hint: 'Ã‡ap ve Ã§eÅŸit' },
] as const;

const UNIT_SUGGESTIONS = ['adet', 'm', 'mÂ²', 'kg', 'takÄ±m', 'dilim'];

/**
 * Tam ekran kart formu: yeni kart ve yeni sÃ¼rÃ¼m. Taslak kalÄ±cÄ±dÄ±r (`useDraft`): geri
 * dÃ¶nmek ya da uygulamanÄ±n kapanmasÄ± yazÄ±lanÄ± kaybettirmez; "TaslaÄŸÄ± sil" ile atÄ±lÄ±r.
 */
export function CardForm({ cardId }: { cardId: string | null }) {
  const card = useCatalogCard(cardId);
  const { types } = useCatalog();
  const attributes = useCatalogAttributes();
  const formId = useId();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const baseVersion = card?.latestVersion ?? 0;
  const initial = useMemo(() => (card ? draftFromCard(card) : emptyCardDraft()), [card]);
  const [stored, setStored] = useDraft<StoredDraft | null>(draftKey('catalog-card', cardId ?? 'new'), null);
  const restored = stored && stored.baseVersion === baseVersion ? stored.draft : null;
  const draft = restored ?? initial;
  const dirty = restored !== null && draftChanged(initial, restored);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  // Form aÃ§Ä±ldÄ±ÄŸÄ±nda zaten bir taslak vardÄ± mÄ± (bilgi bandÄ± iÃ§in); sonradan yazÄ±lan sayÄ±lmaz.
  const [hadDraft] = useState(() => dirty);

  const errors = validateCardDraft(draft);
  const shown = showErrors ? errors : {};
  const activeTypes = types.filter((type) => type.isActive);
  const selectedType = activeTypes.find((type) => type.id === draft.customTypeId) ?? null;
  const dynamic = dynamicAttributes(attributes.data ?? [], selectedType);

  const setDraft = (next: CardDraftState) => setStored({ baseVersion, draft: next });
  const patchDraft = (change: Partial<CardDraftState>) => setDraft({ ...draft, ...change });

  if (cardId && !card) {
    return (
      <div className="m-detail">
        <ScreenHeader title="Kart bulunamadÄ±" />
        <EmptyState icon="library" title="Bu kart artÄ±k kÃ¼tÃ¼phanede yok" />
      </div>
    );
  }
  if (card && !card.isActive) {
    return (
      <div className="m-detail">
        <ScreenHeader title="DÃ¼zenlenemez" />
        <EmptyState
          icon="library"
          title="Pasif karta yeni sÃ¼rÃ¼m eklenemez"
          message="KartÄ± kullanmak iÃ§in yeni bir kart oluÅŸturun."
        />
      </div>
    );
  }

  const selectCustomType = (typeId: string) => {
    const next = activeTypes.find((type) => type.id === typeId);
    setDraft({ ...draft, customTypeId: typeId, type: next?.baseCardType ?? draft.type, attributeValues: {} });
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (saving) return;
    setShowErrors(true);
    if (hasErrors(errors)) {
      haptic('reject');
      snackbar.show({ message: firstError(errors) ?? 'Formu kontrol edin.', tone: 'error' });
      window.setTimeout(() => scrollRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), 0);
      return;
    }
    setSaving(true);
    const payload = buildCardPayload(draft, types);
    const result = await perform(
      () =>
        card
          ? api.post<CatalogCard>(`/catalog/cards/${card.id}/versions`, payload)
          : api.post<CatalogCard>('/catalog/cards', payload),
      {
        success: card
          ? `â€œ${payload.name}â€ yeni sÃ¼rÃ¼m olarak kaydedildi.`
          : `â€œ${payload.name}â€ kÃ¼tÃ¼phaneye eklendi.`,
      },
    );
    setSaving(false);
    if (!result.ok) return;
    actions.patchEntities([patch.upsert('cards', [result.value], 'start')]);
    setStored(null);
    void actions.loadCatalog();
    if (card) shellActions.pop('library');
    else shellActions.replace({ screen: 'card', params: { id: result.value.id } }, 'library');
  };

  const discardDraft = () => {
    setStored(null);
    setShowErrors(false);
  };

  const variantLabel = draft.variantMode === 'Pipe' ? 'Ã‡aplar ve ticari boylar' : 'Fitting Ã§eÅŸitleri';

  return (
    <div className="m-detail">
      <ScreenHeader
        title={card ? 'KartÄ± dÃ¼zenle' : 'Yeni kart'}
        subtitle={card ? `${card.code} Â· v${card.latestVersion} â†’ v${card.latestVersion + 1}` : 'KÃ¼tÃ¼phane'}
      />
      <div className="m-detail__scroll" ref={scrollRef}>
        <form id={formId} className="m-form m-lib-form" onSubmit={(event) => void submit(event)} noValidate>
          {hadDraft && (
            <Notice
              tone="info"
              action={
                <button type="button" className="m-btn m-btn--ghost m-btn--small" onClick={discardDraft}>
                  TaslaÄŸÄ± sil
                </button>
              }
            >
              YarÄ±m kalan taslaÄŸÄ±nÄ±z geri yÃ¼klendi.
            </Notice>
          )}
          {card && (
            <Notice tone="info">
              Kaydedince â€œ{card.name}â€ iÃ§in yeni bir sÃ¼rÃ¼m oluÅŸur. Projelerdeki mevcut kullanÄ±mlar eski
              sÃ¼rÃ¼mde kalÄ±r.
            </Notice>
          )}

          <Section title="Temel bilgiler">
            <TextField
              label="Ad"
              value={draft.name}
              error={shown.name}
              placeholder="Ã–rn. Siyah boru"
              autoComplete="off"
              enterKeyHint="next"
              onChange={(name) => patchDraft({ name })}
            />
            <TextField
              label={card ? 'Katalog kodu (sabit)' : 'Katalog kodu'}
              value={draft.code}
              disabled={Boolean(card)}
              hint={card ? 'Kart kimliÄŸi sÃ¼rÃ¼mler arasÄ±nda korunur.' : 'BoÅŸ bÄ±rakÄ±rsanÄ±z otomatik Ã¼retilir.'}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(code) => patchDraft({ code })}
            />
            <div className="m-field">
              <span className="m-field__label" id={`${formId}-type`}>
                Temel tÃ¼r
              </span>
              <ChipGrid
                mode="single"
                label="Temel tÃ¼r"
                columns={3}
                value={draft.type}
                options={TYPE_OPTIONS}
                onChange={(type) =>
                  setDraft({ ...draft, type: type as CardType, customTypeId: '', attributeValues: {} })
                }
              />
            </div>
            <SelectField
              label="Ã–zel tÃ¼r"
              value={draft.customTypeId}
              hint={
                selectedType ? `â€œ${selectedType.name}â€ tÃ¼rÃ¼nÃ¼n ek alanlarÄ± aÅŸaÄŸÄ±da aÃ§Ä±ldÄ±.` : undefined
              }
              options={[
                { value: '', label: 'Standart tÃ¼r' },
                ...activeTypes.map((type) => ({
                  value: type.id,
                  label: `${type.name} Â· ${TYPE_META[type.baseCardType].label}`,
                })),
              ]}
              onChange={selectCustomType}
            />
            <TextField
              label="Birim"
              value={draft.unit}
              error={shown.unit}
              placeholder="m veya adet"
              autoComplete="off"
              onChange={(unit) => patchDraft({ unit })}
            />
            <div className="m-chip-strip" role="group" aria-label="HazÄ±r birimler">
              {UNIT_SUGGESTIONS.map((unit) => (
                <button
                  key={unit}
                  type="button"
                  className="m-pill"
                  aria-pressed={draft.unit === unit}
                  onClick={() => patchDraft({ unit })}
                >
                  {unit}
                </button>
              ))}
            </div>
            <TextField
              label="Malzeme ailesi"
              value={draft.materialType}
              placeholder="Ã–rn. Galvaniz Ã‡elik Boru"
              hint="AynÄ± ailedeki kartlara ortak fire payÄ± uygulanabilir (Ayarlar â†’ Fire paylarÄ±)."
              autoComplete="off"
              onChange={(materialType) => patchDraft({ materialType })}
            />
            <DecimalField
              label="VarsayÄ±lan fire payÄ±"
              suffix="%"
              value={draft.wasteRatePct.trim() === '' ? null : Number(draft.wasteRatePct.replace(',', '.'))}
              error={shown.wasteRatePct}
              placeholder="0"
              onChange={(value) => patchDraft({ wasteRatePct: value === null ? '' : String(value) })}
            />
            <TextAreaField
              label="Not"
              value={draft.notes}
              rows={2}
              placeholder="Kartla ilgili kÄ±sa not"
              onChange={(notes) => patchDraft({ notes })}
            />
          </Section>

          <Section title="Varyant davranÄ±ÅŸÄ±">
            <ChipGrid
              mode="single"
              label="Varyant davranÄ±ÅŸÄ±"
              columns={3}
              value={draft.variantMode}
              options={MODE_OPTIONS}
              onChange={(mode) => setDraft(setVariantMode(draft, mode as CardDraftState['variantMode']))}
            />
            {draft.variantMode === 'Pipe' && (
              <p className="m-muted">
                Her satÄ±r projede seÃ§ilebilir bir Ã§ap oluÅŸturur; metre, boy uzunluÄŸuna bÃ¶lÃ¼nÃ¼p yukarÄ±
                yuvarlanÄ±r.
              </p>
            )}
            {draft.variantMode === 'Fitting' && (
              <p className="m-muted">
                Uyumlu Ã§aplarÄ± virgÃ¼lle yazÄ±n: DN25, DN32. BoÅŸ bÄ±rakÄ±rsanÄ±z seÃ§ili boru Ã§apÄ±nda gÃ¶sterilir.
              </p>
            )}
            {draft.variantMode !== 'None' && (
              <>
                <div className="m-lib-variant-head">
                  <h3 className="m-section__subtitle">{variantLabel}</h3>
                  <span className="m-badge m-num">{draft.variants.length}</span>
                </div>
                {shown.variants && (
                  <small className="m-field__error" role="alert">
                    {shown.variants}
                  </small>
                )}
                <div className="m-lib-presets">
                  {draft.variantMode === 'Pipe' ? (
                    <>
                      <button
                        type="button"
                        className="m-btn m-btn--secondary m-btn--small"
                        onClick={() => setDraft(applyDiameterPreset(draft, 'steel'))}
                      >
                        Ã‡elik / galvaniz standardÄ±
                      </button>
                      <button
                        type="button"
                        className="m-btn m-btn--secondary m-btn--small"
                        onClick={() => setDraft(applyDiameterPreset(draft, 'pprc'))}
                      >
                        PPR / PPR-C standardÄ±
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="m-btn m-btn--secondary m-btn--small"
                      onClick={() => setDraft(applyFittingPreset(draft))}
                    >
                      YaygÄ±n fittingleri ekle
                    </button>
                  )}
                </div>
                <ul className="m-lib-variants">
                  {draft.variants.map((variant, index) => (
                    <VariantEditor
                      key={index}
                      index={index}
                      mode={draft.variantMode}
                      variant={variant}
                      onChange={(change) => setDraft(updateVariant(draft, index, change))}
                      onRemove={() => setDraft(removeVariant(draft, index))}
                    />
                  ))}
                </ul>
                <button type="button" className="m-btn m-btn--secondary" onClick={() => setDraft(addVariant(draft))}>
                  <Icon name="plus" size={20} />
                  {draft.variantMode === 'Pipe' ? 'Ã–zel Ã§ap ekle' : 'Ã–zel fitting ekle'}
                </button>
              </>
            )}
          </Section>

          {dynamic.length > 0 && (
            <Section title="Bu tÃ¼rÃ¼n ek bilgileri">
              {dynamic.map((attribute) => {
                const control = attributeControl(attribute.key);
                const value = draft.attributeValues[attribute.key] ?? '';
                const set = (next: string) =>
                  patchDraft({ attributeValues: { ...draft.attributeValues, [attribute.key]: next } });
                if (control.kind === 'select')
                  return (
                    <SelectField
                      key={attribute.key}
                      label={attribute.label}
                      hint={attribute.description}
                      value={value}
                      options={[{ value: '', label: 'VarsayÄ±lanÄ± kullan' }, ...control.options]}
                      onChange={set}
                    />
                  );
                if (control.kind === 'decimal')
                  return (
                    <TextField
                      key={attribute.key}
                      label={attribute.label}
                      hint={attribute.description}
                      value={value}
                      inputMode="decimal"
                      autoComplete="off"
                      onChange={set}
                    />
                  );
                return (
                  <TextField
                    key={attribute.key}
                    label={attribute.label}
                    hint={attribute.description}
                    value={value}
                    autoComplete="off"
                    onChange={set}
                  />
                );
              })}
            </Section>
          )}
        </form>
      </div>
      <div className="m-bottom-actions m-bottom-actions--row">
        {dirty && (
          <button
            type="button"
            className="m-btn m-btn--secondary m-btn--large"
            disabled={saving}
            onClick={discardDraft}
          >
            TaslaÄŸÄ± sil
          </button>
        )}
        <button type="submit" form={formId} className="m-btn m-btn--primary m-btn--large" disabled={saving}>
          {saving ? <Spinner size={20} /> : <Icon name="check" size={20} />}
          {saving ? 'Kaydediliyorâ€¦' : card ? 'Yeni sÃ¼rÃ¼m olarak kaydet' : 'KartÄ± kaydet'}
        </button>
      </div>
    </div>
  );
}

function VariantEditor({
  index,
  mode,
  variant,
  onChange,
  onRemove,
}: {
  index: number;
  mode: 'Pipe' | 'Fitting' | 'None';
  variant: CatalogCardVariant;
  onChange: (change: Partial<CatalogCardVariant>) => void;
  onRemove: () => void;
}) {
  const noun = mode === 'Pipe' ? 'Ã‡ap' : 'Fitting';
  return (
    <li className="m-lib-variant-editor">
      <div className="m-lib-variant-editor__head">
        <strong>
          {noun} {index + 1}
        </strong>
        <button
          type="button"
          className="m-icon-button"
          aria-label={`${noun} ${index + 1} satÄ±rÄ±nÄ± sil`}
          onClick={onRemove}
        >
          <Icon name="trash" />
        </button>
      </div>
      <TextField
        label={mode === 'Pipe' ? 'Ã‡ap kodu' : 'Fitting kodu'}
        value={variant.code}
        placeholder={mode === 'Pipe' ? 'DN25' : 'ELBOW-90'}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        onChange={(code) => onChange({ code })}
      />
      <TextField
        label={mode === 'Pipe' ? 'Ã‡ap etiketi' : 'Fitting adÄ±'}
        value={variant.label}
        placeholder={mode === 'Pipe' ? 'DN25 / 1"' : '90Â° Dirsek'}
        autoComplete="off"
        onChange={(label) => onChange({ label })}
      />
      {mode === 'Pipe' ? (
        <DecimalField
          label="Ticari boy"
          suffix="m"
          value={variant.standardLength ?? null}
          onChange={(standardLength) => onChange({ standardLength })}
        />
      ) : (
        <DiameterListField
          value={variant.compatibleDiameters ?? []}
          onChange={(compatibleDiameters) => onChange({ compatibleDiameters })}
        />
      )}
    </li>
  );
}

/** "DN25, DN32" yazÄ±mÄ±: yazarken virgÃ¼l kaybolmasÄ±n diye metin yerelde tutulur. */
function DiameterListField({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  const external = value.join('|');
  const [seen, setSeen] = useState(external);
  if (seen !== external) {
    setSeen(external);
    if (parseDiameterList(text).join('|') !== external) setText(value.join(', '));
  }
  return (
    <TextField
      label="Uyumlu Ã§aplar"
      value={text}
      placeholder="DN25, DN32"
      autoComplete="off"
      autoCapitalize="characters"
      spellCheck={false}
      hint="VirgÃ¼lle ayÄ±rÄ±n. BoÅŸsa seÃ§ili boru Ã§apÄ±nda gÃ¶sterilir."
      onChange={(next) => {
        setText(next);
        const parsed = parseDiameterList(next);
        setSeen(parsed.join('|'));
        onChange(parsed);
      }}
    />
  );
}
