import { useMemo, useState } from 'react';
import { TYPE_META } from '../../../lib/cardTypes.ts';
import { quantity } from '../../../lib/format';
import type { CatalogCard } from '../../../types';
import { ActionSheet, Icon } from '../../components';
import { EmptyState, ScreenHeader, shellActions } from '../../shell';
import { DeleteCardSheet, deactivateCard } from './cardActions';
import { attributeValueLabel } from './cardDraft';
import { Notice, Section } from './shared/FormParts';
import { useCatalogAttributes, useCatalogCard } from './useCatalog';

const VARIANT_PREVIEW = 20;

function Facts({ rows }: { rows: ReadonlyArray<[string, string | null | undefined]> }) {
  const visible = rows.filter((row): row is [string, string] => Boolean(row[1] && row[1].trim()));
  return (
    <dl className="m-facts">
      {visible.map(([label, value]) => (
        <div key={label} className="m-facts__row">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Kart ayrÄ±ntÄ±sÄ±: sÃ¼rÃ¼m, varyantlar, nitelikler. DÃ¼zenleme yeni bir sÃ¼rÃ¼m oluÅŸturur. */
export function CardDetail({ cardId }: { cardId: string }) {
  const card = useCatalogCard(cardId);
  const attributes = useCatalogAttributes();
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState<CatalogCard | null>(null);
  const [allVariants, setAllVariants] = useState(false);
  const labelOf = useMemo(
    () => new Map((attributes.data ?? []).map((attribute) => [attribute.key.toLowerCase(), attribute.label])),
    [attributes.data],
  );

  if (!card) {
    return (
      <div className="m-detail">
        <ScreenHeader title="Kart bulunamadÄ±" />
        <EmptyState
          icon="library"
          title="Bu kart artÄ±k kÃ¼tÃ¼phanede yok"
          message="SilinmiÅŸ ya da kÃ¼tÃ¼phane yeniden yÃ¼klenmiÅŸ olabilir."
          action={
            <button type="button" className="m-btn m-btn--secondary" onClick={() => shellActions.pop('library')}>
              Listeye dÃ¶n
            </button>
          }
        />
      </div>
    );
  }

  const meta = TYPE_META[card.cardType];
  const variants = card.variants ?? [];
  const shownVariants = allVariants ? variants : variants.slice(0, VARIANT_PREVIEW);
  const attributeEntries = Object.entries(card.attributeValues ?? {}).filter(([, value]) => value !== '');

  return (
    <div className="m-detail">
      <ScreenHeader
        title={card.name}
        subtitle={card.code}
        actions={
          <button
            type="button"
            className="m-icon-button"
            aria-label="Kart iÅŸlemleri"
            aria-haspopup="dialog"
            onClick={() => setMenu(true)}
          >
            <Icon name="more" />
          </button>
        }
      />
      <div className="m-detail__scroll">
        {!card.isActive && (
          <div className="m-detail__notice">
            <Notice tone="warning">
              Bu kart pasif: yeni projelerde seÃ§ilemez ve yeni sÃ¼rÃ¼m eklenemez. Mevcut projelerdeki kullanÄ±mÄ±
              korunur.
            </Notice>
          </div>
        )}
        {card.supersededByCode && (
          <div className="m-detail__notice">
            <Notice tone="info">
              Bu kartÄ±n yerine <strong>{card.supersededByCode}</strong> geÃ§ti; yeni projelerde onu kullanÄ±n.
            </Notice>
          </div>
        )}

        <Section title="Genel">
          <Facts
            rows={[
              ['TÃ¼r', `${meta.label}${card.customTypeName ? ` Â· ${card.customTypeName}` : ''}`],
              ['Birim', card.unit],
              ['Fire payÄ±', `%${quantity(card.wasteRatePct)}`],
              ['Malzeme ailesi', card.materialType],
              ['GiriÅŸ davranÄ±ÅŸÄ±', attributeValueLabel('InputBehavior', card.inputBehavior)],
              ['SatÄ±n alma dÃ¶nÃ¼ÅŸÃ¼mÃ¼', attributeValueLabel('SalesConversion', card.salesConversion)],
              ['Rapor davranÄ±ÅŸÄ±', attributeValueLabel('ReportBehavior', card.reportBehavior)],
              ['Boy / paket kapasitesi', card.containerParameter != null ? quantity(card.containerParameter) : null],
              ['Poz numarasÄ±', card.positionNumber],
              ['Aile kodu', card.familyCode],
            ]}
          />
        </Section>

        <Section title="SÃ¼rÃ¼mler">
          <p>
            GÃ¼ncel sÃ¼rÃ¼m: <strong className="m-num">v{card.latestVersion}</strong>
            {card.isActive ? '' : ' (pasif)'}
          </p>
          <p className="m-muted">
            Her dÃ¼zenleme yeni bir sÃ¼rÃ¼m oluÅŸturur. Projelerde kullanÄ±lan kartlar eklendikleri sÃ¼rÃ¼mÃ¼ korur;
            yeni sÃ¼rÃ¼m yalnÄ±z sonradan eklenen kullanÄ±mlarda geÃ§erlidir.
          </p>
        </Section>

        {card.variantMode && card.variantMode !== 'None' && (
          <Section
            title={
              card.variantMode === 'Pipe' ? `Ã‡aplar ve boylar (${variants.length})` : `Ã‡eÅŸitler (${variants.length})`
            }
          >
            {variants.length === 0 ? (
              <p className="m-muted">TanÄ±mlÄ± varyant yok.</p>
            ) : (
              <ul className="m-variant-list">
                {shownVariants.map((variant) => (
                  <li key={variant.code} className="m-variant">
                    <strong>{variant.label || variant.code}</strong>
                    <small>
                      {variant.code}
                      {variant.standardLength ? ` Â· boy ${quantity(variant.standardLength)} m` : ''}
                      {variant.compatibleDiameters?.length
                        ? ` Â· uyumlu: ${variant.compatibleDiameters.join(', ')}`
                        : ''}
                      {variant.sourceCardName ? ` Â· kaynak: ${variant.sourceCardName}` : ''}
                    </small>
                  </li>
                ))}
              </ul>
            )}
            {variants.length > VARIANT_PREVIEW && (
              <button
                type="button"
                className="m-btn m-btn--secondary"
                aria-expanded={allVariants}
                onClick={() => setAllVariants(!allVariants)}
              >
                {allVariants ? 'Daha az gÃ¶ster' : `TÃ¼mÃ¼nÃ¼ gÃ¶ster (${variants.length})`}
              </button>
            )}
          </Section>
        )}

        <Section title="Nitelikler">
          {attributeEntries.length ? (
            <Facts
              rows={attributeEntries.map(([key, value]) => [
                labelOf.get(key.toLowerCase()) ?? key,
                attributeValueLabel(key, value),
              ])}
            />
          ) : (
            <p className="m-muted">
              {card.customTypeName
                ? 'Bu karta ek nitelik girilmemiÅŸ.'
                : 'Standart tÃ¼r kartlarÄ±nda ek nitelik yoktur; Ã¶zel tÃ¼r seÃ§ilirse alanlar aÃ§Ä±lÄ±r.'}
            </p>
          )}
        </Section>

        {card.notes && (
          <Section title="Not">
            <p className="m-prewrap">{card.notes}</p>
          </Section>
        )}
      </div>
      <div className="m-bottom-actions">
        <button
          type="button"
          className="m-btn m-btn--primary m-btn--large m-btn--block"
          disabled={!card.isActive}
          onClick={() => shellActions.push({ screen: 'card-form', params: { id: card.id } }, 'library')}
        >
          <Icon name="edit" size={20} />
          DÃ¼zenle (yeni sÃ¼rÃ¼m)
        </button>
      </div>

      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={card.name}
        actions={[
          ...(card.isActive
            ? [
                {
                  id: 'deactivate',
                  label: 'Pasife al',
                  icon: 'close' as const,
                  description: 'Yeni projelerde seÃ§ilemez; mevcut kullanÄ±mlar korunur.',
                  onSelect: () => {
                    deactivateCard(card);
                    shellActions.pop('library');
                  },
                },
              ]
            : []),
          {
            id: 'delete',
            label: 'Sil',
            icon: 'trash' as const,
            tone: 'danger' as const,
            description: 'KalÄ±cÄ± olarak kaldÄ±rÄ±r (kullanÄ±mdaysa pasife alÄ±r).',
            onSelect: () => setDeleting(card),
          },
        ]}
      />
      <DeleteCardSheet
        card={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => shellActions.pop('library')}
      />
    </div>
  );
}
