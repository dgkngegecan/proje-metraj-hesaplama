import { useMemo, useState } from 'react';
import { api } from '../../../api';
import { purchaseUnit, quantity } from '../../../lib/format';
import { Icon, SearchableList, type IconName } from '../../components';
import { EmptyState, ErrorState, SkeletonList, notifyError, notifySuccess } from '../../shell';
import {
  actions,
  loadKeys,
  sortSummariesForDisplay,
  useLoad,
  usePlacements,
  useRevisionSummaries,
  useSelectedProject,
  useSelectedRevision,
  type SummaryEntity,
} from '../../store';

/*
 * YER TUTUCU — Dalga 2'de Ajan 6 bu klasörü doldurur (radyatör özeti, alt
 * ağaç kapsamı, hesap kontrolleri, rapor verisi `useResource` ile).
 * Buradaki sürüm: depodaki özetler masaüstüyle aynı sırada + rapor dosyalarını
 * `api.download` ile paylaşma/kaydetme.
 */

const FORMATS: ReadonlyArray<{ id: 'excel' | 'pdf' | 'word'; label: string; extension: string; icon: IconName }> = [
  { id: 'excel', label: 'Excel', extension: 'xlsx', icon: 'output' },
  { id: 'pdf', label: 'PDF', extension: 'pdf', icon: 'output' },
  { id: 'word', label: 'Word', extension: 'docx', icon: 'output' },
];

export default function OutputScreen() {
  const project = useSelectedProject();
  const revision = useSelectedRevision();
  const revisionId = revision?.id ?? null;
  const summaries = useRevisionSummaries(revisionId);
  const placements = usePlacements(revisionId);
  const load = useLoad(revisionId ? loadKeys.revision(revisionId) : 'revision:none');
  const sorted = useMemo(() => sortSummariesForDisplay(summaries, placements), [summaries, placements]);
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = async (format: (typeof FORMATS)[number]) => {
    if (!revision || downloading) return;
    setDownloading(format.id);
    try {
      const name = `${project?.code ?? 'Metraj'}-${revision.code}.${format.extension}`;
      const result = await api.download(`/revisions/${revision.id}/report/${format.id}`, name);
      if (result.outcome === 'saveAs' || result.outcome === 'browser') notifySuccess(`${result.name} hazırlandı.`);
    } catch (error) {
      notifyError(error, 'Rapor hazırlanamadı.');
    } finally {
      setDownloading(null);
    }
  };

  if (!revisionId || (!summaries.length && (load.status === 'loading' || load.status === 'idle')))
    return <SkeletonList />;
  if (!summaries.length && load.status === 'error')
    return <ErrorState message={load.error} onRetry={() => void actions.refreshRevision()} />;

  return (
    <div className="m-screen">
      <SearchableList<SummaryEntity>
        items={sorted}
        getKey={(summary) => `${summary.placementId}|${summary.variant ?? ''}|${summary.secondaryVariant ?? ''}`}
        ariaLabel="Malzeme listesi"
        searchText={(summary) => `${summary.placementName} ${summary.placementCode} ${summary.variant ?? ''}`}
        searchPlaceholder="Malzemelerde ara"
        estimateSize={76}
        header={
          <p className="m-list-caption">
            {sorted.length} malzeme satırı · {revision?.code}
          </p>
        }
        emptyState={
          <EmptyState
            icon="output"
            title="Henüz metraj yok"
            message="Proje sekmesinde bir malzeme seçip miktar girdiğinizde özet burada oluşur."
          />
        }
        noResultsState={<EmptyState icon="search" title="Eşleşen malzeme yok" />}
        renderItem={(summary) => (
          <div className="m-summary-row">
            <span className="m-summary-row__name">
              <strong>{summary.placementName}</strong>
              <small>
                {[summary.variant, summary.secondaryVariant].filter(Boolean).join(' · ') || 'Standart'} ·{' '}
                {summary.measurementCount} giriş
              </small>
            </span>
            <span className="m-summary-row__qty m-num">
              <strong>
                {quantity(summary.purchaseQuantity)} {purchaseUnit(summary)}
              </strong>
              <small>
                net {quantity(summary.netQuantity)} · fireli {quantity(summary.withWasteQuantity)} {summary.unit}
              </small>
            </span>
          </div>
        )}
      />
      <div className="m-bottom-actions m-bottom-actions--row" aria-label="Rapor al">
        {FORMATS.map((format) => (
          <button
            key={format.id}
            type="button"
            className={`m-btn ${format.id === 'pdf' ? 'm-btn--primary' : 'm-btn--secondary'}`}
            disabled={downloading !== null || !summaries.length}
            onClick={() => void download(format)}
          >
            <Icon name={downloading === format.id ? 'refresh' : format.icon} size={20} />
            {downloading === format.id ? 'Hazırlanıyor…' : format.label}
          </button>
        ))}
      </div>
    </div>
  );
}
