import { visibleCatalogCards } from '../lib/catalogData';
import { TYPE_META } from '../lib/uiTypes';
import type { CatalogCard } from '../types';

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
  const activeCards = visibleCatalogCards(cards);
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
  return (
    <div className={`card-shelf ${compact ? 'compact' : ''}`}>
      {activeCards.map((card) => {
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
  );
}
