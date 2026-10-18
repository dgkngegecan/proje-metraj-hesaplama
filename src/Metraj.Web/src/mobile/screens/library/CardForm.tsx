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
  /** Taslağın dayandığı sürüm: kart bu arada değiştiyse eski taslak kullanılmaz. */
  baseVersion: number;
  draft: CardDraftState;
}

const TYPE_OPTIONS = (Object.keys(TYPE_META) as CardType[]).map((type) => ({
  value: type,
  label: TYPE_META[type].label,
}));

const MODE_OPTIONS = [
  { value: 'None', label: 'Standart', hint: 'Tek kart' },
  { value: 'Pipe', label: 'Boru', hint: 'Çap ve boy' },
  { value: 'Fitting', label: 'Fitting', hint: 'Çap ve çeşit' },
] as const;

const UNIT_SUGGESTIONS = ['adet', 'm', 'm²', 'kg', 'takım', 'dilim'];

/**
 * Tam ekran kart formu: yeni kart ve yeni sürüm. Taslak kalıcıdır (`useDraft`): geri
 * dönmek ya da uygulamanın kapanması yazılanı kaybettirmez; "Taslağı sil" ile atılır.
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
  // Form açıldığında zaten bir taslak vardı mı (bilgi bandı için); sonradan yazılan sayılmaz.
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
        <ScreenHeader title="Kart bulunamadı" />
        <EmptyState icon="library" title="Bu kart artık kütüphanede yok" />
      </div>
    );
  }
  if (card && !card.isActive) {
    return (
      <div className="m-detail">
        <ScreenHeader title="Düzenlenemez" />
        <EmptyState
          icon="library"
          title="Pasif kart düzenlenemez"
          message="Kartı kullanmak için yeni bir kart oluşturun."
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
      snackbar.show({ message: firstError(errors) ?? 'Eksik alanları doldurun.', tone: 'error' });
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
        success: card ? `“${payload.name}” güncellendi.` : `“${payload.name}” kütüphaneye eklendi.`,
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

  const variantLabel = draft.variantMode === 'Pipe' ? 'Çaplar ve boylar' : 'Fitting çeşitleri';

  return (
    <div className="m-detail">
      <ScreenHeader
        title={card ? 'Kartı düzenle' : 'Yeni kart'}
        subtitle={card ? `${card.code} · v${card.latestVersion} → v${card.latestVersion + 1}` : 'Kütüphane'}
      />
      <div className="m-detail__scroll" ref={scrollRef}>
        <form id={formId} className="m-form m-lib-form" onSubmit={(event) => void submit(event)} noValidate>
          {hadDraft && (
            <Notice
              tone="info"
              action={
                <button type="button" className="m-btn m-btn--ghost m-btn--small" onClick={discardDraft}>
                  Taslağı sil
                </button>
              }
            >
              Yarım kalan taslağınız geri yüklendi.
            </Notice>
          )}
          {card && (
            <Notice tone="info">
              Kaydedince “{card.name}” için yeni bir sürüm oluşur. Projelerdeki mevcut kullanımlar eski sürümde kalır.
            </Notice>
          )}

          <Section title="Temel bilgiler">
            <TextField
              label="Ad"
              value={draft.name}
              error={shown.name}
              placeholder="Örn. Siyah boru"
              autoComplete="off"
              enterKeyHint="next"
              onChange={(name) => patchDraft({ name })}
            />
            <TextField
              label={card ? 'Kart kodu (değiştirilemez)' : 'Kart kodu'}
              value={draft.code}
              disabled={Boolean(card)}
              hint={card ? 'Kart kodu sonradan değiştirilemez.' : 'Boş bırakırsanız otomatik üretilir.'}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(code) => patchDraft({ code })}
            />
            <div className="m-field">
              <span className="m-field__label" id={`${formId}-type`}>
                Temel tür
              </span>
              <ChipGrid
                mode="single"
                label="Temel tür"
                columns={3}
                value={draft.type}
                options={TYPE_OPTIONS}
                onChange={(type) =>
                  setDraft({ ...draft, type: type as CardType, customTypeId: '', attributeValues: {} })
                }
              />
            </div>
            <SelectField
              label="Özel tür"
              value={draft.customTypeId}
              hint={selectedType ? `“${selectedType.name}” türünün ek bilgileri aşağıda.` : undefined}
              options={[
                { value: '', label: 'Standart tür' },
                ...activeTypes.map((type) => ({
                  value: type.id,
                  label: `${type.name} · ${TYPE_META[type.baseCardType].label}`,
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
            <div className="m-chip-strip" role="group" aria-label="Hazır birimler">
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
              placeholder="Örn. Galvaniz Çelik Boru"
              hint="Aynı ailedeki kartlara Ayarlar > Fire payları ekranından ortak fire tanımlanabilir."
              autoComplete="off"
              onChange={(materialType) => patchDraft({ materialType })}
            />
            <DecimalField
              label="Varsayılan fire payı"
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
              placeholder="Kartla ilgili kısa not"
              onChange={(notes) => patchDraft({ notes })}
            />
          </Section>

          <Section title="Çeşit tipi">
            <ChipGrid
              mode="single"
              label="Çeşit tipi"
              columns={3}
              value={draft.variantMode}
              options={MODE_OPTIONS}
              onChange={(mode) => setDraft(setVariantMode(draft, mode as CardDraftState['variantMode']))}
            />
            {draft.variantMode === 'Pipe' && (
              <p className="m-muted">
                Her satır projede seçilebilir bir çap oluşturur; metre, boy uzunluğuna bölünüp yukarı yuvarlanır.
              </p>
            )}
            {draft.variantMode === 'Fitting' && (
              <p className="m-muted">
                Uyumlu çapları virgülle yazın: DN25, DN32. Boş bırakırsanız seçili boru çapında gösterilir.
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
                        Çelik / galvaniz standardı
                      </button>
                      <button
                        type="button"
                        className="m-btn m-btn--secondary m-btn--small"
                        onClick={() => setDraft(applyDiameterPreset(draft, 'pprc'))}
                      >
                        PPR / PPR-C standardı
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="m-btn m-btn--secondary m-btn--small"
                      onClick={() => setDraft(applyFittingPreset(draft))}
                    >
                      Yaygın fittingleri ekle
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
                  {draft.variantMode === 'Pipe' ? 'Çap ekle' : 'Çeşit ekle'}
                </button>
              </>
            )}
          </Section>

          {dynamic.length > 0 && (
            <Section title="Bu türün ek bilgileri">
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
                      options={[{ value: '', label: 'Varsayılanı kullan' }, ...control.options]}
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
            Taslağı sil
          </button>
        )}
        <button type="submit" form={formId} className="m-btn m-btn--primary m-btn--large" disabled={saving}>
          {saving ? <Spinner size={20} /> : <Icon name="check" size={20} />}
          {saving ? 'Kaydediliyor…' : card ? 'Değişiklikleri kaydet' : 'Kartı kaydet'}
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
  const noun = mode === 'Pipe' ? 'Çap' : 'Fitting';
  return (
    <li className="m-lib-variant-editor">
      <div className="m-lib-variant-editor__head">
        <strong>
          {noun} {index + 1}
        </strong>
        <button
          type="button"
          className="m-icon-button"
          aria-label={`${noun} ${index + 1} satırını sil`}
          onClick={onRemove}
        >
          <Icon name="trash" />
        </button>
      </div>
      <TextField
        label={mode === 'Pipe' ? 'Çap kodu' : 'Fitting kodu'}
        value={variant.code}
        placeholder={mode === 'Pipe' ? 'DN25' : 'ELBOW-90'}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        onChange={(code) => onChange({ code })}
      />
      <TextField
        label={mode === 'Pipe' ? 'Çap etiketi' : 'Fitting adı'}
        value={variant.label}
        placeholder={mode === 'Pipe' ? 'DN25 / 1"' : '90° Dirsek'}
        autoComplete="off"
        onChange={(label) => onChange({ label })}
      />
      {mode === 'Pipe' ? (
        <DecimalField
          label="Standart boy (m)"
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

/** "DN25, DN32" yazımı: yazarken virgül kaybolmasın diye metin yerelde tutulur. */
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
      label="Uyumlu çaplar"
      value={text}
      placeholder="DN25, DN32"
      autoComplete="off"
      autoCapitalize="characters"
      spellCheck={false}
      hint="Virgülle ayırın. Boş bırakılırsa bağlı borunun çapında gösterilir."
      onChange={(next) => {
        setText(next);
        const parsed = parseDiameterList(next);
        setSeen(parsed.join('|'));
        onChange(parsed);
      }}
    />
  );
}
