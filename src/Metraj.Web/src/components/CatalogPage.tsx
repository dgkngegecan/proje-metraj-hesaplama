import { CardShelf } from './CardShelf';
import type { CardDraftState, TypeDraftState } from '../lib/draftTypes';
import { FITTING_PRESETS, PPRC_DIAMETERS, STEEL_DIAMETERS, visibleCatalogCards } from '../lib/catalogData';
import { TYPE_META } from '../lib/uiTypes';
import { parseDecimal } from '../lib/format';
import type {
  CardType,
  CatalogCard,
  CatalogCardAttributeDescriptor,
  CatalogCardVariant,
  CatalogCardType,
  CatalogVariantMode,
} from '../types';

export function CatalogPage(props: {
  addNewCardToFlow: boolean;
  editingCardId: string | null;
  cardDraft: CardDraftState;
  typeDraft: TypeDraftState;
  cards: CatalogCard[];
  catalogTypes: CatalogCardType[];
  catalogAttributes: CatalogCardAttributeDescriptor[];
  busy: boolean;
  showTypeDialog: boolean;
  onCardDraft: (value: CardDraftState) => void;
  onTypeDraft: (value: TypeDraftState) => void;
  onCreateCard: () => void;
  onEditCard: (card: CatalogCard) => void;
  onCancelEdit: () => void;
  onCreateType: () => void;
  onDeleteType: (type: CatalogCardType) => void;
  onSeed: () => void;
  onAddCard: (id: string) => void;
  onDeactivateCard: (card: CatalogCard) => void;
  onOpenType: () => void;
  onCloseType: () => void;
  onClose: () => void;
  onBackToFlow: () => void;
}) {
  const activeCards = visibleCatalogCards(props.cards);
  const activeTypes = props.catalogTypes.filter((type) => type.isActive);
  const selectedType = activeTypes.find((type) => type.id === props.cardDraft.customTypeId) ?? null;
  const enabledAttributes = selectedType
    ? props.catalogAttributes.filter((attribute) =>
        selectedType.attributeKeys.some((key) => key.toLowerCase() === attribute.key.toLowerCase()),
      )
    : [];
  const separatelyRenderedAttributes = new Set(['Code', 'Name', 'Unit', 'Notes', 'MaterialType', 'WasteRatePct']);
  const updateAttribute = (key: string, value: string) =>
    props.onCardDraft({
      ...props.cardDraft,
      attributeValues: { ...props.cardDraft.attributeValues, [key]: value },
    });
  const selectCustomType = (typeId: string) => {
    const nextType = activeTypes.find((type) => type.id === typeId);
    props.onCardDraft({
      ...props.cardDraft,
      customTypeId: typeId,
      type: nextType?.baseCardType ?? props.cardDraft.type,
      attributeValues: {},
    });
  };
  const toggleTypeList = (field: 'parentCardIds' | 'childCardIds', id: string) => {
    const values = props.typeDraft[field];
    props.onTypeDraft({
      ...props.typeDraft,
      [field]: values.includes(id) ? values.filter((item) => item !== id) : [...values, id],
    });
  };
  const toggleAttribute = (attribute: CatalogCardAttributeDescriptor) => {
    if (attribute.isRequired) return;
    const values = props.typeDraft.attributeKeys;
    props.onTypeDraft({
      ...props.typeDraft,
      attributeKeys: values.includes(attribute.key)
        ? values.filter((key) => key !== attribute.key)
        : [...values, attribute.key],
    });
  };
  const renderAttribute = (attribute: CatalogCardAttributeDescriptor) => {
    const value = props.cardDraft.attributeValues[attribute.key] ?? '';
    if (attribute.key === 'Notes') {
      return (
        <label key={attribute.key} className="dynamic-attribute wide">
          {attribute.label}
          <textarea
            rows={2}
            value={value}
            placeholder={attribute.description}
            onChange={(event) => updateAttribute(attribute.key, event.target.value)}
          />
        </label>
      );
    }
    if (
      attribute.key === 'ItemKind' ||
      attribute.key === 'InputBehavior' ||
      attribute.key === 'SalesConversion' ||
      attribute.key === 'ReportBehavior'
    ) {
      const options: Record<string, string[]> = {
        ItemKind: ['Material', 'Equipment', 'Labor', 'Service', 'Other'],
        InputBehavior: ['Manual', 'Boolean', 'Derived'],
        SalesConversion: ['None', 'StandardLength', 'Package'],
        ReportBehavior: ['Folder', 'Measurable', 'Auxiliary', 'Reference'],
      };
      return (
        <label key={attribute.key} className="dynamic-attribute">
          {attribute.label}
          <select value={value} onChange={(event) => updateAttribute(attribute.key, event.target.value)}>
            <option value="">Varsayılanı kullan</option>
            {(options[attribute.key] ?? []).map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
      );
    }
    return (
      <label
        key={attribute.key}
        className={`dynamic-attribute ${attribute.key === 'CompatibleDiameters' ? 'wide' : ''}`}
      >
        {attribute.label}
        <input
          inputMode={attribute.key === 'WasteRatePct' || attribute.key === 'ContainerParameter' ? 'decimal' : undefined}
          value={value}
          placeholder={attribute.description}
          onChange={(event) => updateAttribute(attribute.key, event.target.value)}
        />
      </label>
    );
  };
  const updateVariant = (index: number, patch: Partial<CatalogCardVariant>) =>
    props.onCardDraft({
      ...props.cardDraft,
      variants: props.cardDraft.variants.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    });
  const addVariant = () =>
    props.onCardDraft({
      ...props.cardDraft,
      variants: [
        ...props.cardDraft.variants,
        props.cardDraft.variantMode === 'Pipe'
          ? { code: `DN-${props.cardDraft.variants.length + 1}`, label: 'Yeni çap', standardLength: 6 }
          : { code: `FITTING-${props.cardDraft.variants.length + 1}`, label: 'Yeni fitting', compatibleDiameters: [] },
      ],
    });
  const removeVariant = (index: number) =>
    props.onCardDraft({
      ...props.cardDraft,
      variants: props.cardDraft.variants.filter((_, itemIndex) => itemIndex !== index),
    });
  const applyDiameterPreset = (preset: 'steel' | 'pprc') =>
    props.onCardDraft({
      ...props.cardDraft,
      variantMode: 'Pipe',
      unit: 'm',
      variants: (preset === 'steel' ? STEEL_DIAMETERS : PPRC_DIAMETERS).map((item) => ({ ...item })),
    });
  const applyFittingPreset = () =>
    props.onCardDraft({
      ...props.cardDraft,
      variantMode: 'Fitting',
      unit: 'adet',
      variants: FITTING_PRESETS.map((item) => ({ ...item })),
    });
  const setVariantMode = (mode: CatalogVariantMode) =>
    props.onCardDraft({
      ...props.cardDraft,
      variantMode: mode,
      unit: mode === 'Pipe' ? 'm' : mode === 'Fitting' ? 'adet' : props.cardDraft.unit,
      variants: mode === 'None' ? [] : props.cardDraft.variants,
    });

  return (
    <section className="catalog-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">KÜTÜPHANE · GLOBAL</span>
          <h2>{props.addNewCardToFlow ? 'Yeni yapı taşı' : 'Kart kütüphanesi'}</h2>
          <p>
            Bu, projelerden bağımsız tek yerel kütüphanedir. Kartı bir kez tanımla; bütün projelerin haritasında tekrar
            kullan. Tür şablonları da burada global tutulur.
          </p>
        </div>
        <div className="intro-actions">
          {!props.addNewCardToFlow && (
            <>
              <button onClick={props.onSeed}>Eksik standartları tamamla</button>
              <button className="primary" onClick={props.onOpenType}>
                + Yeni tür
              </button>
            </>
          )}
          {props.addNewCardToFlow && <button onClick={props.onBackToFlow}>Haritaya dön</button>}
        </div>
      </div>
      <div className="create-card catalog-create-card">
        <div>
          <span className="card-star">✦</span>
          <h3>Yeni kart</h3>
          <p>
            {selectedType
              ? `“${selectedType.name}” türünün seçili alanlarını doldur.`
              : 'Yalnızca adını, türünü ve birimini seç.'}
          </p>
        </div>
        <label>
          {props.editingCardId ? 'Katalog kodu (sabit)' : 'Katalog kodu'}
          <input
            disabled={Boolean(props.editingCardId)}
            placeholder={props.editingCardId ? 'Kart kimliği sürümler arasında korunur' : 'Boş bırakırsan otomatik'}
            value={props.cardDraft.code}
            onChange={(event) => props.onCardDraft({ ...props.cardDraft, code: event.target.value })}
          />
        </label>
        <label>
          Ad
          <input
            aria-label="Kart adı"
            autoFocus
            placeholder="Örn. Siyah boru"
            value={props.cardDraft.name}
            onChange={(event) => props.onCardDraft({ ...props.cardDraft, name: event.target.value })}
          />
        </label>
        <label>
          Temel tür
          <select
            value={props.cardDraft.type}
            onChange={(event) =>
              props.onCardDraft({
                ...props.cardDraft,
                type: event.target.value as CardType,
                customTypeId: '',
                attributeValues: {},
              })
            }
          >
            {Object.entries(TYPE_META).map(([key, item]) => (
              <option key={key} value={key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Birim
          <input
            placeholder="m veya adet"
            value={props.cardDraft.unit}
            onChange={(event) => props.onCardDraft({ ...props.cardDraft, unit: event.target.value })}
          />
        </label>
        <label>
          Özel tür
          <select value={props.cardDraft.customTypeId} onChange={(event) => selectCustomType(event.target.value)}>
            <option value="">Standart tür</option>
            {activeTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name} · {TYPE_META[type.baseCardType].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Varyant davranışı
          <select
            value={props.cardDraft.variantMode}
            onChange={(event) => setVariantMode(event.target.value as CatalogVariantMode)}
          >
            <option value="None">Standart kart</option>
            <option value="Pipe">Boru · çap ve ticari boy</option>
            <option value="Fitting">Fitting · çap ve çeşit</option>
          </select>
        </label>
        <label>
          Malzeme ailesi
          <input
            placeholder="Örn. Galvaniz Çelik Boru"
            value={props.cardDraft.materialType}
            onChange={(event) => props.onCardDraft({ ...props.cardDraft, materialType: event.target.value })}
          />
        </label>
        <label>
          Kart varsayılan fire payı (%)
          <input
            inputMode="decimal"
            placeholder="0"
            value={props.cardDraft.wasteRatePct}
            onChange={(event) => props.onCardDraft({ ...props.cardDraft, wasteRatePct: event.target.value })}
          />
        </label>
        <label className="catalog-note-field">
          Not
          <textarea
            rows={1}
            placeholder="Kartla ilgili kısa not"
            value={props.cardDraft.notes}
            onChange={(event) => props.onCardDraft({ ...props.cardDraft, notes: event.target.value })}
          />
        </label>
        {props.cardDraft.variantMode === 'Pipe' && (
          <div className="variant-editor wide">
            <div className="variant-editor-heading">
              <div>
                <strong>Boru çapları ve ticari boylar</strong>
                <small>
                  Her satır haritada seçilebilir bir çap kutusu oluşturur; metre, boy uzunluğuna bölünüp yukarı
                  yuvarlanır.
                </small>
              </div>
              <div className="inline-actions">
                <button type="button" onClick={() => applyDiameterPreset('steel')}>
                  Çelik / galvaniz standardı
                </button>
                <button type="button" onClick={() => applyDiameterPreset('pprc')}>
                  PPR / PPR-C standardı
                </button>
                <button type="button" onClick={addVariant}>
                  + Özel çap
                </button>
              </div>
            </div>
            <div className="variant-editor-list">
              {props.cardDraft.variants.map((item, index) => (
                <div className="variant-editor-row" key={`${item.code}-${index}`}>
                  <input
                    aria-label="Çap kodu"
                    value={item.code}
                    placeholder="DN25"
                    onChange={(event) => updateVariant(index, { code: event.target.value })}
                  />
                  <input
                    aria-label="Çap etiketi"
                    value={item.label}
                    placeholder={'DN25 / 1"'}
                    onChange={(event) => updateVariant(index, { label: event.target.value })}
                  />
                  <label className="variant-length">
                    Boy (m)
                    <input
                      inputMode="decimal"
                      value={item.standardLength ?? ''}
                      onChange={(event) =>
                        updateVariant(index, { standardLength: parseDecimal(event.target.value) || null })
                      }
                    />
                  </label>
                  <button type="button" className="danger-link" onClick={() => removeVariant(index)}>
                    Sil
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {props.cardDraft.variantMode === 'Fitting' && (
          <div className="variant-editor wide">
            <div className="variant-editor-heading">
              <div>
                <strong>Fitting çeşitleri ve uyumlu çaplar</strong>
                <small>Uyumlu çapları virgülle yaz: DN25, DN32. Boş bırakırsan seçili boru çapında gösterilir.</small>
              </div>
              <div className="inline-actions">
                <button type="button" onClick={applyFittingPreset}>
                  Yaygın fittingleri ekle
                </button>
                <button type="button" onClick={addVariant}>
                  + Özel fitting
                </button>
              </div>
            </div>
            <div className="variant-editor-list">
              {props.cardDraft.variants.map((item, index) => (
                <div className="variant-editor-row fitting-editor-row" key={`${item.code}-${index}`}>
                  <input
                    aria-label="Fitting kodu"
                    value={item.code}
                    placeholder="ELBOW-90"
                    onChange={(event) => updateVariant(index, { code: event.target.value })}
                  />
                  <input
                    aria-label="Fitting adı"
                    value={item.label}
                    placeholder="90° Dirsek"
                    onChange={(event) => updateVariant(index, { label: event.target.value })}
                  />
                  <input
                    className="compat-input"
                    aria-label="Uyumlu çaplar"
                    value={(item.compatibleDiameters ?? []).join(', ')}
                    placeholder="DN25, DN32"
                    onChange={(event) =>
                      updateVariant(index, {
                        compatibleDiameters: event.target.value
                          .split(',')
                          .map((value) => value.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                  <button type="button" className="danger-link" onClick={() => removeVariant(index)}>
                    Sil
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="catalog-form-actions">
          <button className="primary" disabled={props.busy} onClick={props.onCreateCard}>
            {props.addNewCardToFlow ? 'Kaydet ve altına ekle' : props.editingCardId ? 'Kartı güncelle' : 'Kartı kaydet'}
          </button>
          {props.editingCardId && (
            <button type="button" disabled={props.busy} onClick={props.onCancelEdit}>
              Düzenlemeyi iptal et
            </button>
          )}
        </div>
        {selectedType &&
          enabledAttributes.filter((attribute) => !separatelyRenderedAttributes.has(attribute.key)).length > 0 && (
            <div className="dynamic-attributes">
              <div className="dynamic-attributes-heading">
                <strong>Bu türün ek bilgileri</strong>
                <small>İşaretlediğin alanlar kartla birlikte saklanır.</small>
              </div>
              {enabledAttributes
                .filter((attribute) => !separatelyRenderedAttributes.has(attribute.key))
                .map(renderAttribute)}
            </div>
          )}
      </div>
      {activeTypes.length > 0 && (
        <section className="catalog-types">
          <div className="summary-heading">
            <div>
              <span className="eyebrow">TÜR ŞABLONLARI</span>
              <h3>Özel kart türleri</h3>
            </div>
            <span>{activeTypes.length} global tür</span>
          </div>
          <div className="catalog-type-list">
            {activeTypes.map((type) => (
              <article key={type.id} className="catalog-type-row">
                <div>
                  <strong>{type.name}</strong>
                  <small>
                    {type.code} · temel tür: {TYPE_META[type.baseCardType].label}
                  </small>
                  <p>
                    {type.attributeKeys.length} bilgi alanı ·{' '}
                    {type.allowedParentCardIds.length
                      ? `${type.allowedParentCardIds.length} üst kart kısıtı`
                      : 'üst kart kısıtı yok'}{' '}
                    ·{' '}
                    {type.allowedChildCardIds.length
                      ? `${type.allowedChildCardIds.length} alt kart kısıtı`
                      : 'alt kart kısıtı yok'}
                  </p>
                </div>
                <button className="danger-link" disabled={props.busy} onClick={() => props.onDeleteType(type)}>
                  Kaldır
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
      <CardShelf
        cards={props.cards}
        compact
        onAdd={props.onAddCard}
        onDelete={props.onDeactivateCard}
        onEdit={props.onEditCard}
      />
      {props.showTypeDialog && (
        <div className="modal-backdrop" onMouseDown={props.onCloseType}>
          <div
            className="modal type-editor-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Yeni kart türü oluştur"
            onKeyDown={(event) => {
              if (event.key === 'Escape') props.onCloseType();
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" aria-label="Kapat" onClick={props.onCloseType}>
              ×
            </button>
            <span className="eyebrow">GLOBAL KÜTÜPHANE</span>
            <h2>Yeni kart türü oluştur</h2>
            <p>
              Bir tür, aynı bilgileri taşıyan kartlar için şablondur. Üst/alt kart seçimleri ek ağaç kısıtı getirir; boş
              bırakırsan temel beşli kural çalışır.
            </p>
            <div className="type-editor-grid">
              <label>
                Kısa kod
                <input
                  autoFocus
                  placeholder="Örn. RADYATOR"
                  value={props.typeDraft.code}
                  onChange={(event) => props.onTypeDraft({ ...props.typeDraft, code: event.target.value })}
                />
              </label>
              <label>
                Tür adı
                <input
                  placeholder="Örn. Panel radyatör"
                  value={props.typeDraft.name}
                  onChange={(event) => props.onTypeDraft({ ...props.typeDraft, name: event.target.value })}
                />
              </label>
              <label>
                Temel kart davranışı
                <select
                  value={props.typeDraft.baseCardType}
                  onChange={(event) =>
                    props.onTypeDraft({ ...props.typeDraft, baseCardType: event.target.value as CardType })
                  }
                >
                  {Object.entries(TYPE_META).map(([key, item]) => (
                    <option key={key} value={key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="wide">
                Açıklama
                <input
                  placeholder="Bu tür neyi temsil eder?"
                  value={props.typeDraft.description}
                  onChange={(event) => props.onTypeDraft({ ...props.typeDraft, description: event.target.value })}
                />
              </label>
            </div>
            <div className="type-editor-columns">
              <fieldset>
                <legend>İzin verilen üst kartlar</legend>
                <small>Bu tür kartın altına bağlanabileceği global kartlar. Boş liste: kısıt yok.</small>
                {activeCards.length ? (
                  <div className="check-list">
                    {activeCards.map((card) => (
                      <label key={card.id}>
                        <input
                          type="checkbox"
                          checked={props.typeDraft.parentCardIds.includes(card.id)}
                          onChange={() => toggleTypeList('parentCardIds', card.id)}
                        />
                        {card.name}
                        <small>{card.code}</small>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Önce kütüphaneye kart ekleyin.</p>
                )}
              </fieldset>
              <fieldset>
                <legend>İzin verilen alt kartlar</legend>
                <small>Bu tür kartın altında bulunabilecek global kartlar. Boş liste: kısıt yok.</small>
                {activeCards.length ? (
                  <div className="check-list">
                    {activeCards.map((card) => (
                      <label key={card.id}>
                        <input
                          type="checkbox"
                          checked={props.typeDraft.childCardIds.includes(card.id)}
                          onChange={() => toggleTypeList('childCardIds', card.id)}
                        />
                        {card.name}
                        <small>{card.code}</small>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Önce kütüphaneye kart ekleyin.</p>
                )}
              </fieldset>
            </div>
            <fieldset className="attribute-fieldset">
              <legend>Kartta istenecek bilgiler</legend>
              <small>Kod, ad ve birim motorun zorunlu alanlarıdır; diğerlerini ihtiyacına göre işaretle.</small>
              <div className="attribute-check-list">
                {props.catalogAttributes.map((attribute) => (
                  <label key={attribute.key}>
                    <input
                      type="checkbox"
                      checked={attribute.isRequired || props.typeDraft.attributeKeys.includes(attribute.key)}
                      disabled={attribute.isRequired}
                      onChange={() => toggleAttribute(attribute)}
                    />
                    <span>
                      <strong>
                        {attribute.label}
                        {attribute.isRequired ? ' · zorunlu' : ''}
                      </strong>
                      <small>{attribute.description}</small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="inline-actions">
              <button onClick={props.onClose}>Vazgeç</button>
              <button className="primary" disabled={props.busy} onClick={props.onCreateType}>
                Türü kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
