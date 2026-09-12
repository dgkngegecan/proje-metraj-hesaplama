import { useMemo, useState } from 'react';
import { visibleCatalogCards } from '../lib/catalogData';
import { TYPE_META } from '../lib/uiTypes';
import type { CardType, CatalogCard } from '../types';

// Türkçe arama: büyük/küçük harf ve aksan (ç, ş, ı, ğ, ü, ö) farkını yok sayar.
const normalize = (value: string) =>
  value.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Kartta aranabilir HER şeyi tek bir metinde toplar: ad, kod, birim, not, malzeme
// ailesi, poz, özel tür, kategori adı, çaplar, boru/fitting varyant etiketleri ve
// kartla saklanan tüm ek bilgi alanları. Böylece arama kartın herhangi bir alanında eşleşir.
const buildHaystack = (card: CatalogCard): string => {
  const parts: Array<string | null | undefined> = [
    card.name,
    card.code,
    card.unit,
    card.materialType,
    card.notes,
    card.positionNumber,
    card.customTypeCode,
    card.customTypeName,
    TYPE_META[card.cardType]?.label,
    ...(card.compatibleDiameters ?? []),
  ];
  for (const variant of card.variants ?? []) {
    parts.push(variant.code, variant.label, ...(variant.compatibleDiameters ?? []));
  }
  if (card.attributeValues) {
    for (const [key, value] of Object.entries(card.attributeValues)) parts.push(key, value);
  }
  return normalize(parts.filter(Boolean).join(' '));
};

export function CardShelf({
  cards,
  onAdd,
  compact = false,
  onCreate,
  onDelete,
  onEdit,
}: {
  cards: CatalogCard[];
  onAdd: (id: string) => void;
  compact?: boolean;
  onCreate?: () => void;
  onDelete?: (card: CatalogCard) => void;
  onEdit?: (card: CatalogCard) => void;
}) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<CardType | ''>('');

  const activeCards = useMemo(() => visibleCatalogCards(cards), [cards]);
  const presentTypes = useMemo(
    () => (Object.keys(TYPE_META) as CardType[]).filter((type) => activeCards.some((card) => card.cardType === type)),
    [activeCards],
  );
  // Aranabilir metni kart başına bir kez üret; her tuş vuruşunda yeniden hesaplanmaz.
  const indexed = useMemo(() => activeCards.map((card) => ({ card, haystack: buildHaystack(card) })), [activeCards]);
  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    return indexed
      .filter(({ card }) => !typeFilter || card.cardType === typeFilter)
      .filter(({ haystack }) => !needle || haystack.includes(needle))
      .map(({ card }) => card);
  }, [indexed, query, typeFilter]);

  if (!activeCards.length)
    return (
      <div className={`empty-shelf ${compact ? 'compact' : ''}`}>
        <span>✦</span>
        <h3>Henüz seçilecek kart yok</h3>
        <p>
          {onCreate
            ? 'Önce tek bir kart oluştur. Kaydedince onu doğrudan bu projeye ekleyebilirsin.'
            : 'Yukarıdaki kısa formdan ilk kartını oluşturduğunda burada görünecek.'}
        </p>
        {onCreate && (
          <button className="primary" onClick={onCreate}>
            + İlk kartı oluştur
          </button>
        )}
      </div>
    );

  const hasFilter = Boolean(query || typeFilter);
  const clearFilter = () => {
    setQuery('');
    setTypeFilter('');
  };

  return (
    <div className="shelf-wrap">
      <div className="shelf-search">
        <input
          type="search"
          className="shelf-search-input"
          placeholder="Kartlarda ara: ad, kod, çap, malzeme, not…"
          aria-label="Kart ara"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          className="shelf-search-type"
          aria-label="Kategoriye göre süz"
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as CardType | '')}
        >
          <option value="">Tüm kategoriler</option>
          {presentTypes.map((type) => (
            <option key={type} value={type}>
              {TYPE_META[type].label}
            </option>
          ))}
        </select>
        <span className="shelf-search-count">
          {filtered.length} / {activeCards.length} kart
        </span>
        {hasFilter && (
          <button type="button" className="shelf-search-clear" onClick={clearFilter}>
            Temizle
          </button>
        )}
      </div>
      {filtered.length ? (
        <div className={`card-shelf ${compact ? 'compact' : ''}`}>
          {filtered.map((card) => {
            const meta = TYPE_META[card.cardType];
            const note = (card as CatalogCard & { notes?: string | null }).notes;
            return (
              <article
                key={card.latestVersionId}
                className="shelf-card"
                draggable
                onDragStart={(event) => event.dataTransfer.setData('application/metraj-card', card.latestVersionId)}
                style={{ '--node-accent': meta.color } as React.CSSProperties}
              >
                <span>
                  {meta.icon} {meta.label}
                  {card.customTypeName ? ` · ${card.customTypeName}` : ''}
                </span>
                <strong>{card.name}</strong>
                <small>
                  {card.unit}
                  {card.variantMode === 'Pipe'
                    ? ` · ${card.variants?.length ?? 0} çap`
                    : card.variantMode === 'Fitting'
                      ? ` · ${card.variants?.length ?? 0} çeşit`
                      : ''}
                  {card.materialType ? ` · ${card.materialType}` : ''}
                </small>
                {note && <p>{note}</p>}
                <div className="shelf-actions">
                  <button onClick={() => onAdd(card.latestVersionId)}>+ Haritaya ekle</button>
                  {onEdit && <button onClick={() => onEdit(card)}>Düzenle</button>}
                  {onDelete && (
                    <button className="danger-link" onClick={() => onDelete(card)}>
                      Sil
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={`empty-shelf ${compact ? 'compact' : ''}`}>
          <span>🔍</span>
          <h3>Eşleşen kart yok</h3>
          <p>Aradığın ölçütlere uyan kart bulunamadı. Aramayı değiştir ya da temizle.</p>
          <button onClick={clearFilter}>Aramayı temizle</button>
        </div>
      )}
    </div>
  );
}
