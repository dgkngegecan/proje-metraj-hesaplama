import { useState } from 'react';
import { api } from '../../../api';
import { TYPE_META } from '../../../lib/cardTypes.ts';
import type { CardType, CatalogCard, CatalogCardType } from '../../../types';
import { ChipGrid, Icon, SearchableList, haptic } from '../../components';
import { BottomSheet, EmptyState, ScreenHeader, Spinner, shellActions, snackbar } from '../../shell';
import { actions, draftKey, useDraft } from '../../store';
import {
  buildTypePayload,
  emptyTypeDraft,
  toggleAttributeKey,
  toggleId,
  validateTypeDraft,
  type TypeDraft,
} from './cardDraft';
import { ConfirmSheet } from './shared/ConfirmSheet';
import { CheckRow, Notice, Section, TextAreaField, TextField } from './shared/FormParts';
import { perform } from './shared/perform';
import { useCatalog, useCatalogAttributes } from './useCatalog';

const TYPE_OPTIONS = (Object.keys(TYPE_META) as CardType[]).map((type) => ({
  value: type,
  label: TYPE_META[type].label,
}));

/** Ã–zel kart tÃ¼rleri: ÅŸablon listesi, ekleme ve kaldÄ±rma. KaldÄ±rma mevcut kartlara ve projelere dokunmaz. */
export function CardTypesScreen() {
  const { types, load } = useCatalog();
  const active = types.filter((type) => type.isActive);
  const [removing, setRemoving] = useState<CatalogCardType | null>(null);

  return (
    <div className="m-detail">
      <ScreenHeader title="Ã–zel kart tÃ¼rleri" subtitle={`${active.length} tÃ¼r`} />
      <div className="m-detail__scroll">
        {active.length === 0 ? (
          <EmptyState
            icon="library"
            title={load.status === 'loading' ? 'YÃ¼kleniyorâ€¦' : 'HenÃ¼z Ã¶zel tÃ¼r yok'}
            message="TÃ¼r, aynÄ± bilgileri taÅŸÄ±yan kartlar iÃ§in ÅŸablondur: hangi alanlarÄ±n istendiÄŸini ve hangi kartlarÄ±n altÄ±na baÄŸlanabileceÄŸini belirler."
          />
        ) : (
          <ul className="m-row-list m-lib-types">
            {active.map((type) => (
              <li key={type.id} className="m-lib-type">
                <div className="m-lib-type__text">
                  <strong>{type.name}</strong>
                  <small>
                    {type.code} Â· temel tÃ¼r: {TYPE_META[type.baseCardType].label}
                  </small>
                  <small>
                    {type.attributeKeys.length} bilgi alanÄ± Â·{' '}
                    {type.allowedParentCardIds.length
                      ? `${type.allowedParentCardIds.length} Ã¼st kart kÄ±sÄ±tÄ±`
                      : 'Ã¼st kart kÄ±sÄ±tÄ± yok'}{' '}
                    Â·{' '}
                    {type.allowedChildCardIds.length
                      ? `${type.allowedChildCardIds.length} alt kart kÄ±sÄ±tÄ±`
                      : 'alt kart kÄ±sÄ±tÄ± yok'}
                  </small>
                  {type.description && <small>{type.description}</small>}
                </div>
                <button
                  type="button"
                  className="m-icon-button"
                  aria-label={`${type.name} tÃ¼rÃ¼nÃ¼ kaldÄ±r`}
                  onClick={() => setRemoving(type)}
                >
                  <Icon name="trash" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="m-bottom-actions">
        <button
          type="button"
          className="m-btn m-btn--primary m-btn--large m-btn--block"
          onClick={() => shellActions.push({ screen: 'type-form' }, 'library')}
        >
          <Icon name="plus" size={20} />
          Yeni kart tÃ¼rÃ¼
        </button>
      </div>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Kart tÃ¼rÃ¼ kaldÄ±rÄ±lsÄ±n mÄ±?"
        description={
          removing
            ? `â€œ${removing.name}â€ yeni kart seÃ§imlerinden kaldÄ±rÄ±lacak. Mevcut kartlar ve projeler korunur.`
            : undefined
        }
        confirmLabel="TÃ¼rÃ¼ kaldÄ±r"
        onConfirm={async () => {
          if (!removing) return;
          const result = await perform(() => api.delete(`/catalog/types/${removing.id}`), {
            success: 'Kart tÃ¼rÃ¼ kaldÄ±rÄ±ldÄ±.',
            error: 'Kart tÃ¼rÃ¼ kaldÄ±rÄ±lamadÄ±.',
          });
          if (!result.ok) return false;
          await actions.loadCatalog();
        }}
      />
    </div>
  );
}

/** Yeni kart tÃ¼rÃ¼ formu. Taslak kalÄ±cÄ±dÄ±r; kayÄ±tta temizlenir. */
export function TypeForm() {
  const { cards } = useCatalog();
  const attributes = useCatalogAttributes();
  const [stored, setStored] = useDraft<TypeDraft | null>(draftKey('catalog-type', 'new'), null);
  const draft = stored ?? emptyTypeDraft();
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<'parentCardIds' | 'childCardIds' | null>(null);
  const errors = showErrors ? validateTypeDraft(draft) : {};
  const activeCards = cards.filter((card) => card.isActive);
  const set = (change: Partial<TypeDraft>) => setStored({ ...draft, ...change });

  const submit = async () => {
    if (saving) return;
    setShowErrors(true);
    const found = validateTypeDraft(draft);
    if (found.code || found.name) {
      haptic('reject');
      snackbar.show({ message: found.code ?? found.name ?? '', tone: 'error' });
      return;
    }
    setSaving(true);
    const result = await perform(() => api.post<CatalogCardType>('/catalog/types', buildTypePayload(draft)), {
      success: 'Yeni kart tÃ¼rÃ¼ kÃ¼tÃ¼phaneye eklendi.',
    });
    setSaving(false);
    if (!result.ok) return;
    setStored(null);
    void actions.loadCatalog();
    shellActions.pop('library');
  };

  return (
    <div className="m-detail">
      <ScreenHeader title="Yeni kart tÃ¼rÃ¼" subtitle="Global kÃ¼tÃ¼phane" />
      <div className="m-detail__scroll">
        <form
          className="m-form m-lib-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Section title="TÃ¼r">
            <TextField
              label="KÄ±sa kod"
              value={draft.code}
              error={errors.code}
              placeholder="Ã–rn. RADYATOR"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(code) => set({ code })}
            />
            <TextField
              label="TÃ¼r adÄ±"
              value={draft.name}
              error={errors.name}
              placeholder="Ã–rn. Panel radyatÃ¶r"
              autoComplete="off"
              onChange={(name) => set({ name })}
            />
            <div className="m-field">
              <span className="m-field__label">Temel kart davranÄ±ÅŸÄ±</span>
              <ChipGrid
                mode="single"
                label="Temel kart davranÄ±ÅŸÄ±"
                columns={3}
                value={draft.baseCardType}
                options={TYPE_OPTIONS}
                onChange={(baseCardType) => set({ baseCardType: baseCardType as CardType })}
              />
            </div>
            <TextAreaField
              label="AÃ§Ä±klama"
              rows={2}
              value={draft.description}
              placeholder="Bu tÃ¼r neyi temsil eder?"
              onChange={(description) => set({ description })}
            />
          </Section>

          <Section title="BaÄŸlanabileceÄŸi kartlar">
            <p className="m-muted">
              Ãœst/alt kart seÃ§imleri ek aÄŸaÃ§ kÄ±sÄ±tÄ± getirir. BoÅŸ bÄ±rakÄ±rsanÄ±z temel beÅŸli kural Ã§alÄ±ÅŸÄ±r.
            </p>
            <button type="button" className="m-action-row" onClick={() => setPicker('parentCardIds')}>
              <Icon name="chevronRight" />
              <span>
                <strong>Ä°zin verilen Ã¼st kartlar</strong>
                <small>
                  {draft.parentCardIds.length ? `${draft.parentCardIds.length} kart seÃ§ili` : 'KÄ±sÄ±t yok'}
                </small>
              </span>
            </button>
            <button type="button" className="m-action-row" onClick={() => setPicker('childCardIds')}>
              <Icon name="chevronRight" />
              <span>
                <strong>Ä°zin verilen alt kartlar</strong>
                <small>{draft.childCardIds.length ? `${draft.childCardIds.length} kart seÃ§ili` : 'KÄ±sÄ±t yok'}</small>
              </span>
            </button>
          </Section>

          <Section title="Kartta istenecek bilgiler">
            <p className="m-muted">
              Kod, ad ve birim motorun zorunlu alanlarÄ±dÄ±r; diÄŸerlerini ihtiyacÄ±nÄ±za gÃ¶re iÅŸaretleyin.
            </p>
            {attributes.status === 'error' && <Notice tone="error">{attributes.error}</Notice>}
            {(attributes.data ?? []).map((attribute) => (
              <CheckRow
                key={attribute.key}
                label={`${attribute.label}${attribute.isRequired ? ' Â· zorunlu' : ''}`}
                description={attribute.description}
                checked={attribute.isRequired || draft.attributeKeys.includes(attribute.key)}
                disabled={attribute.isRequired}
                onChange={() => set({ attributeKeys: toggleAttributeKey(draft.attributeKeys, attribute) })}
              />
            ))}
          </Section>
        </form>
      </div>
      <div className="m-bottom-actions m-bottom-actions--row">
        {stored && (
          <button
            type="button"
            className="m-btn m-btn--secondary m-btn--large"
            disabled={saving}
            onClick={() => {
              setStored(null);
              setShowErrors(false);
            }}
          >
            TaslaÄŸÄ± sil
          </button>
        )}
        <button
          type="button"
          className="m-btn m-btn--primary m-btn--large"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? <Spinner size={20} /> : <Icon name="check" size={20} />}
          {saving ? 'Kaydediliyorâ€¦' : 'TÃ¼rÃ¼ kaydet'}
        </button>
      </div>
      <CardPickerSheet
        open={picker !== null}
        title={picker === 'parentCardIds' ? 'Ä°zin verilen Ã¼st kartlar' : 'Ä°zin verilen alt kartlar'}
        cards={activeCards}
        selected={picker ? draft[picker] : []}
        onToggle={(id) => picker && set({ [picker]: toggleId(draft[picker], id) })}
        onClear={() => picker && set({ [picker]: [] })}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}

/** Kart seÃ§ici: yÃ¼zlerce kart olabileceÄŸi iÃ§in aramalÄ± ve sanallaÅŸtÄ±rÄ±lmÄ±ÅŸ. */
function CardPickerSheet({
  open,
  title,
  cards,
  selected,
  onToggle,
  onClear,
  onClose,
}: {
  open: boolean;
  title: string;
  cards: readonly CatalogCard[];
  selected: readonly string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      size="full"
      footer={
        <>
          <button
            type="button"
            className="m-btn m-btn--secondary m-btn--large"
            disabled={!selected.length}
            onClick={onClear}
          >
            Temizle
          </button>
          <button type="button" className="m-btn m-btn--primary m-btn--large" onClick={onClose}>
            Tamam{selected.length ? ` (${selected.length})` : ''}
          </button>
        </>
      }
    >
      <div className="m-lib-picker">
        <SearchableList<CatalogCard>
          items={cards}
          getKey={(card) => card.id}
          ariaLabel="Kartlar"
          searchText={(card) => `${card.name} ${card.code} ${card.materialType ?? ''}`}
          searchPlaceholder="Kart ara"
          estimateSize={64}
          emptyState={<EmptyState icon="library" title="Ã–nce kÃ¼tÃ¼phaneye kart ekleyin" />}
          noResultsState={<EmptyState icon="search" title="EÅŸleÅŸen kart yok" />}
          renderItem={(card) => {
            const checked = selected.includes(card.id);
            return (
              <button
                type="button"
                role="checkbox"
                aria-checked={checked}
                className={`m-card-row m-lib-pick${checked ? ' is-selected' : ''}`}
                onClick={() => {
                  haptic('tick');
                  onToggle(card.id);
                }}
              >
                <span className="m-lib-pick__box" aria-hidden="true">
                  {checked && <Icon name="check" size={18} />}
                </span>
                <span className="m-card-row__text">
                  <strong>{card.name}</strong>
                  <small>{card.code}</small>
                </span>
              </button>
            );
          }}
        />
      </div>
    </BottomSheet>
  );
}
