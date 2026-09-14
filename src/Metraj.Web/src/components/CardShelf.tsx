import { useId, useMemo, useState, type CSSProperties } from 'react';
import {
  buildCatalogDecks,
  catalogCardSearchText,
  catalogDeckContentNames,
  normalizeCatalogText,
  type CatalogDeck,
} from '../lib/catalogDecks';
import { TYPE_META } from '../lib/uiTypes';
import type { CardType, CatalogCard } from '../types';
import './catalog-decks.css';

interface CardShelfProps {
  cards: CatalogCard[];
  onAdd: (id: string) => void;
  compact?: boolean;
  onCreate?: () => void;
  onDelete?: (card: CatalogCard) => void;
  onEdit?: (card: CatalogCard) => void;
}

function Deck({
  deck,
  matches,
  expanded,
  onToggle,
  onAdd,
  onEdit,
  onDelete,
}: {
  deck: CatalogDeck;
  matches: CatalogCard[];
  expanded: boolean;
  onToggle: () => void;
} & Pick<CardShelfProps, 'onAdd' | 'onEdit' | 'onDelete'>) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const showTooltip = (hovered || focused) && !dismissed;
  const names = catalogDeckContentNames(matches);
  return (
    <>
      <div
        className={`catalog-deck-slot${expanded ? ' is-open' : ''}`}
        style={{ '--deck-accent': deck.color } as CSSProperties}
        onMouseEnter={() => {
          setHovered(true);
          setDismissed(false);
        }}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && showTooltip) {
            setDismissed(true);
            event.stopPropagation();
          }
        }}
      >
        <button
          type="button"
          className="catalog-deck"
          id={`${id}-button`}
          aria-expanded={expanded}
          aria-controls={`${id}-cards`}
          aria-describedby={showTooltip ? `${id}-tooltip` : undefined}
          onFocus={() => {
            setFocused(true);
            setDismissed(false);
          }}
          onBlur={() => setFocused(false)}
          onClick={() => {
            setDismissed(true);
            onToggle();
          }}
        >
          <span className="catalog-deck-topline">
            <span className="catalog-deck-symbol" aria-hidden="true">
              ▱
            </span>
            <span>
              {matches.length === deck.cards.length
                ? `${matches.length} kart`
                : `${matches.length} / ${deck.cards.length} kart`}
            </span>
          </span>
          <span className="catalog-deck-domain">{deck.domainName}</span>
          <strong>{deck.name}</strong>
          <span className="catalog-deck-toggle">
            {expanded ? 'Açık · Kartları topla' : 'Desteyi aç'}
            <span aria-hidden="true">{expanded ? '−' : '+'}</span>
          </span>
        </button>
        <div className="catalog-deck-tooltip" id={`${id}-tooltip`} role="tooltip" hidden={!showTooltip}>
          {names.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
      </div>
      <div
        className="catalog-deck-cards"
        id={`${id}-cards`}
        role="group"
        aria-labelledby={`${id}-button`}
        hidden={!expanded}
      >
        {expanded &&
          matches.map((card) => {
            const meta = TYPE_META[card.cardType];
            return (
              <article
                key={card.id}
                className="shelf-card catalog-deck-card"
                draggable
                onDragStart={(event) => event.dataTransfer.setData('application/metraj-card', card.latestVersionId)}
                style={{ '--node-accent': meta.color, '--deck-accent': deck.color } as CSSProperties}
              >
                <span>
                  {meta.icon} {meta.label}
                  {card.customTypeName ? ` · ${card.customTypeName}` : ''}
                </span>
                <strong>{card.name}</strong>
                <small>{card.code}</small>
                <small>
                  {card.unit}
                  {card.variantMode === 'Pipe'
                    ? ` · ${card.variants?.length ?? 0} ölçü / sınıf`
                    : card.variantMode === 'Fitting'
                      ? ` · ${card.variants?.length ?? 0} çeşit`
                      : ''}
                  {card.materialType ? ` · ${card.materialType}` : ''}
                </small>
                {card.notes && <p>{card.notes}</p>}
                <div className="shelf-actions">
                  <button type="button" onClick={() => onAdd(card.latestVersionId)}>
                    + Haritaya ekle
                  </button>
                  {onEdit && (
                    <button type="button" onClick={() => onEdit(card)}>
                      Düzenle
                    </button>
                  )}
                  {onDelete && (
                    <button type="button" className="danger-link" onClick={() => onDelete(card)}>
                      Sil
                    </button>
                  )}
                </div>
              </article>
            );
          })}
      </div>
    </>
  );
}

export function CardShelf({ cards, onAdd, compact = false, onCreate, onDelete, onEdit }: CardShelfProps) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<CardType | ''>('');
  const [domainFilter, setDomainFilter] = useState('');
  const [openDecks, setOpenDecks] = useState<Set<string>>(() => new Set());
  // Searching expands matches independently of the user's browsing state.
  const [closedSearchDecks, setClosedSearchDecks] = useState<Set<string>>(() => new Set());
  const decks = useMemo(() => buildCatalogDecks(cards), [cards]);
  const indexed = useMemo(
    () =>
      decks.map((deck) => ({
        deck,
        entries: deck.cards.map((card) => ({ card, text: catalogCardSearchText(card, deck) })),
      })),
    [decks],
  );
  const activeCount = decks.reduce((count, deck) => count + deck.cards.length, 0);
  const presentTypes = (Object.keys(TYPE_META) as CardType[]).filter((type) =>
    decks.some((deck) => deck.cards.some((card) => card.cardType === type)),
  );
  const domains = [...new Map(decks.map((deck) => [deck.domainKey, deck.domainName])).entries()];
  const words = normalizeCatalogText(query.trim()).split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  const filtered = indexed
    .filter(({ deck }) => !domainFilter || deck.domainKey === domainFilter)
    .map(({ deck, entries }) => ({
      deck,
      matches: entries
        .filter(
          ({ card, text }) =>
            (!typeFilter || card.cardType === typeFilter) && words.every((word) => text.includes(word)),
        )
        .map(({ card }) => card),
    }))
    .filter(({ matches }) => matches.length > 0);
  const matchCount = filtered.reduce((count, item) => count + item.matches.length, 0);
  const isOpen = (id: string) => (searching ? !closedSearchDecks.has(id) : openDecks.has(id));
  const anyOpen = filtered.some(({ deck }) => isOpen(deck.id));
  const clearFilters = () => {
    setQuery('');
    setTypeFilter('');
    setDomainFilter('');
    setClosedSearchDecks(new Set());
  };
  const toggleDeck = (id: string) => {
    const update = (previous: Set<string>) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    };
    if (searching) setClosedSearchDecks(update);
    else setOpenDecks(update);
  };

  return (
    <div className={`shelf-wrap catalog-deck-shelf${compact ? ' compact' : ''}`}>
      <div className="catalog-deck-toolbar">
        <div>
          <h3>Kart desteleri</h3>
          <p>İçerik adlarını görmek için destenin üzerine gel; kartları burada açmak ve toplamak için tıkla.</p>
        </div>
        {onCreate && (
          <button type="button" onClick={onCreate}>
            + Yeni kart
          </button>
        )}
      </div>
      {activeCount > 0 ? (
        <>
          <div className="shelf-search">
            <input
              type="search"
              className="shelf-search-input"
              placeholder="Tüm içerikte ara: ad, kod, çap, malzeme, not…"
              aria-label="Kart ara"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setClosedSearchDecks(new Set());
              }}
            />
            <select
              aria-label="Tesisat alanına göre süz"
              value={domainFilter}
              onChange={(event) => setDomainFilter(event.target.value)}
            >
              <option value="">Tüm tesisat alanları</option>
              {domains.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="shelf-search-type"
              aria-label="Kategoriye göre süz"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value as CardType | '')}
            >
              <option value="">Tüm kart türleri</option>
              {presentTypes.map((type) => (
                <option key={type} value={type}>
                  {TYPE_META[type].label}
                </option>
              ))}
            </select>
          </div>
          <div className="catalog-deck-results">
            <span role="status" aria-live="polite" aria-atomic="true">
              {filtered.length} deste · {matchCount} / {activeCount} kart
            </span>
            {(query || typeFilter || domainFilter) && (
              <button type="button" onClick={clearFilters}>
                Filtreleri temizle
              </button>
            )}
            {anyOpen && (
              <button
                type="button"
                onClick={() =>
                  searching ? setClosedSearchDecks(new Set(decks.map((deck) => deck.id))) : setOpenDecks(new Set())
                }
              >
                Açık desteleri topla
              </button>
            )}
          </div>
          {filtered.length ? (
            <div className="catalog-deck-grid">
              {filtered.map(({ deck, matches }) => (
                <Deck
                  key={deck.id}
                  deck={deck}
                  matches={matches}
                  expanded={isOpen(deck.id)}
                  onToggle={() => toggleDeck(deck.id)}
                  onAdd={onAdd}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          ) : (
            <div className="empty-shelf compact">
              <h3>Eşleşen kart yok</h3>
              <p>Aramayı değiştir veya filtreleri temizleyerek tüm destelere dön.</p>
              <button type="button" onClick={clearFilters}>
                Filtreleri temizle
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="empty-shelf compact">
          <h3>Henüz seçilecek kart yok</h3>
          <p>İlk kartını oluşturduğunda burada kendi destesinde görünecek.</p>
          {onCreate && (
            <button type="button" className="primary" onClick={onCreate}>
              + İlk kartı oluştur
            </button>
          )}
        </div>
      )}
    </div>
  );
}
