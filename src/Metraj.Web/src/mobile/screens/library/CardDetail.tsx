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

/** Kart ayrıntısı: sürüm, varyantlar, nitelikler. Düzenleme yeni bir sürüm oluşturur. */
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
        <ScreenHeader title="Kart bulunamadı" />
        <EmptyState
          icon="library"
          title="Bu kart artık kütüphanede yok"
          message="Silinmiş ya da kütüphane yeniden yüklenmiş olabilir."
          action={
            <button type="button" className="m-btn m-btn--secondary" onClick={() => shellActions.pop('library')}>
              Listeye dön
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
            aria-label="Kart işlemleri"
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
              Bu kart pasif: yeni projelerde seçilemez ve yeni sürüm eklenemez. Mevcut projelerdeki kullanımı korunur.
            </Notice>
          </div>
        )}
        {card.supersededByCode && (
          <div className="m-detail__notice">
            <Notice tone="info">
              Bu kartın yerine <strong>{card.supersededByCode}</strong> geçti; yeni projelerde onu kullanın.
            </Notice>
          </div>
        )}

        <Section title="Genel">
          <Facts
            rows={[
              ['Tür', `${meta.label}${card.customTypeName ? ` · ${card.customTypeName}` : ''}`],
              ['Birim', card.unit],
              ['Fire payı', `%${quantity(card.wasteRatePct)}`],
              ['Malzeme ailesi', card.materialType],
              ['Giriş davranışı', attributeValueLabel('InputBehavior', card.inputBehavior)],
              ['Satın alma dönüşümü', attributeValueLabel('SalesConversion', card.salesConversion)],
              ['Rapor davranışı', attributeValueLabel('ReportBehavior', card.reportBehavior)],
              ['Boy / paket kapasitesi', card.containerParameter != null ? quantity(card.containerParameter) : null],
              ['Poz numarası', card.positionNumber],
              ['Aile kodu', card.familyCode],
            ]}
          />
        </Section>

        <Section title="Sürümler">
          <p>
            Güncel sürüm: <strong className="m-num">v{card.latestVersion}</strong>
            {card.isActive ? '' : ' (pasif)'}
          </p>
          <p className="m-muted">
            Her düzenleme yeni bir sürüm oluşturur. Projelerde kullanılan kartlar eklendikleri sürümü korur; yeni sürüm
            yalnız sonradan eklenen kullanımlarda geçerlidir.
          </p>
        </Section>

        {card.variantMode && card.variantMode !== 'None' && (
          <Section
            title={
              card.variantMode === 'Pipe' ? `Çaplar ve boylar (${variants.length})` : `Çeşitler (${variants.length})`
            }
          >
            {variants.length === 0 ? (
              <p className="m-muted">Tanımlı varyant yok.</p>
            ) : (
              <ul className="m-variant-list">
                {shownVariants.map((variant) => (
                  <li key={variant.code} className="m-variant">
                    <strong>{variant.label || variant.code}</strong>
                    <small>
                      {variant.code}
                      {variant.standardLength ? ` · boy ${quantity(variant.standardLength)} m` : ''}
                      {variant.compatibleDiameters?.length
                        ? ` · uyumlu: ${variant.compatibleDiameters.join(', ')}`
                        : ''}
                      {variant.sourceCardName ? ` · kaynak: ${variant.sourceCardName}` : ''}
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
                {allVariants ? 'Daha az göster' : `Tümünü göster (${variants.length})`}
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
                ? 'Bu karta ek nitelik girilmemiş.'
                : 'Standart tür kartlarında ek nitelik yoktur; özel tür seçilirse alanlar açılır.'}
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
          Düzenle (yeni sürüm)
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
                  description: 'Yeni projelerde seçilemez; mevcut kullanımlar korunur.',
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
            description: 'Kalıcı olarak kaldırır (kullanımdaysa pasife alır).',
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
