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

/** Özel kart türleri: şablon listesi, ekleme ve kaldırma. Kaldırma mevcut kartlara ve projelere dokunmaz. */
export function CardTypesScreen() {
  const { types, load } = useCatalog();
  const active = types.filter((type) => type.isActive);
  const [removing, setRemoving] = useState<CatalogCardType | null>(null);

  return (
    <div className="m-detail">
      <ScreenHeader title="Özel kart türleri" subtitle={`${active.length} tür`} />
      <div className="m-detail__scroll">
        {active.length === 0 ? (
          <EmptyState
            icon="library"
            title={load.status === 'loading' ? 'Yükleniyor…' : 'Henüz özel tür yok'}
            message="Özel tür, kartta hangi bilgilerin isteneceğini ve kartın hangi kartların altına eklenebileceğini belirler."
          />
        ) : (
          <ul className="m-row-list m-lib-types">
            {active.map((type) => (
              <li key={type.id} className="m-lib-type">
                <div className="m-lib-type__text">
                  <strong>{type.name}</strong>
                  <small>
                    {type.code} · temel tür: {TYPE_META[type.baseCardType].label}
                  </small>
                  <small>
                    {type.attributeKeys.length} bilgi alanı ·{' '}
                    {type.allowedParentCardIds.length
                      ? `${type.allowedParentCardIds.length} üst kart sınırı`
                      : 'üst kart sınırı yok'}{' '}
                    ·{' '}
                    {type.allowedChildCardIds.length
                      ? `${type.allowedChildCardIds.length} alt kart sınırı`
                      : 'alt kart sınırı yok'}
                  </small>
                  {type.description && <small>{type.description}</small>}
                </div>
                <button
                  type="button"
                  className="m-icon-button"
                  aria-label={`${type.name} türünü kaldır`}
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
          Yeni kart türü
        </button>
      </div>
      <ConfirmSheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Kart türü kaldırılsın mı?"
        description={
          removing
            ? `“${removing.name}” artık yeni kartlarda seçilemeyecek. Mevcut kartlar ve projeler değişmez.`
            : undefined
        }
        confirmLabel="Türü kaldır"
        onConfirm={async () => {
          if (!removing) return;
          const result = await perform(() => api.delete(`/catalog/types/${removing.id}`), {
            success: 'Kart türü kaldırıldı.',
            error: 'Kart türü kaldırılamadı.',
          });
          if (!result.ok) return false;
          await actions.loadCatalog();
        }}
      />
    </div>
  );
}

/** Yeni kart türü formu. Taslak kalıcıdır; kayıtta temizlenir. */
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
      success: 'Yeni kart türü kütüphaneye eklendi.',
    });
    setSaving(false);
    if (!result.ok) return;
    setStored(null);
    void actions.loadCatalog();
    shellActions.pop('library');
  };

  return (
    <div className="m-detail">
      <ScreenHeader title="Yeni kart türü" subtitle="Kütüphane" />
      <div className="m-detail__scroll">
        <form
          className="m-form m-lib-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Section title="Tür">
            <TextField
              label="Kısa kod"
              value={draft.code}
              error={errors.code}
              placeholder="Örn. RADYATOR"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(code) => set({ code })}
            />
            <TextField
              label="Tür adı"
              value={draft.name}
              error={errors.name}
              placeholder="Örn. Panel radyatör"
              autoComplete="off"
              onChange={(name) => set({ name })}
            />
            <div className="m-field">
              <span className="m-field__label">Temel tür</span>
              <ChipGrid
                mode="single"
                label="Temel tür"
                columns={3}
                value={draft.baseCardType}
                options={TYPE_OPTIONS}
                onChange={(baseCardType) => set({ baseCardType: baseCardType as CardType })}
              />
            </div>
            <TextAreaField
              label="Açıklama"
              rows={2}
              value={draft.description}
              placeholder="Bu tür neyi temsil eder?"
              onChange={(description) => set({ description })}
            />
          </Section>

          <Section title="Eklenebileceği yerler">
            <p className="m-muted">
              Üst/alt kart seçimleri ek ağaç kısıtı getirir. Boş bırakırsanız temel beşli kural çalışır.
            </p>
            <button type="button" className="m-action-row" onClick={() => setPicker('parentCardIds')}>
              <Icon name="chevronRight" />
              <span>
                <strong>İzin verilen üst kartlar</strong>
                <small>{draft.parentCardIds.length ? `${draft.parentCardIds.length} kart seçili` : 'Sınır yok'}</small>
              </span>
            </button>
            <button type="button" className="m-action-row" onClick={() => setPicker('childCardIds')}>
              <Icon name="chevronRight" />
              <span>
                <strong>İzin verilen alt kartlar</strong>
                <small>{draft.childCardIds.length ? `${draft.childCardIds.length} kart seçili` : 'Sınır yok'}</small>
              </span>
            </button>
          </Section>

          <Section title="Kartta istenecek bilgiler">
            <p className="m-muted">
              Kod, ad ve birim motorun zorunlu alanlarıdır; diğerlerini ihtiyacınıza göre işaretleyin.
            </p>
            {attributes.status === 'error' && <Notice tone="error">{attributes.error}</Notice>}
            {(attributes.data ?? []).map((attribute) => (
              <CheckRow
                key={attribute.key}
                label={`${attribute.label}${attribute.isRequired ? ' · zorunlu' : ''}`}
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
            Taslağı sil
          </button>
        )}
        <button
          type="button"
          className="m-btn m-btn--primary m-btn--large"
          disabled={saving}
          onClick={() => void submit()}
        >
          {saving ? <Spinner size={20} /> : <Icon name="check" size={20} />}
          {saving ? 'Kaydediliyor…' : 'Türü kaydet'}
        </button>
      </div>
      <CardPickerSheet
        open={picker !== null}
        title={picker === 'parentCardIds' ? 'İzin verilen üst kartlar' : 'İzin verilen alt kartlar'}
        cards={activeCards}
        selected={picker ? draft[picker] : []}
        onToggle={(id) => picker && set({ [picker]: toggleId(draft[picker], id) })}
        onClear={() => picker && set({ [picker]: [] })}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}

/** Kart seçici: yüzlerce kart olabileceği için aramalı ve sanallaştırılmış. */
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
          emptyState={<EmptyState icon="library" title="Önce kütüphaneye kart ekleyin" />}
          noResultsState={<EmptyState icon="search" title="Eşleşen kart yok" />}
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
