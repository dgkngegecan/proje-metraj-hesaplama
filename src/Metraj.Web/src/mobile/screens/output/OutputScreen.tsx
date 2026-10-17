import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type DownloadResult } from '../../../api';
import type { ReportData } from '../../../types';
import { Icon, haptic } from '../../components';
import {
  EmptyState,
  ErrorState,
  SkeletonList,
  Spinner,
  notifyError,
  shellActions,
  useActiveTab,
  useTopRoute,
} from '../../shell';
import {
  actions,
  errorMessage,
  loadKeys,
  useAppStore,
  useLoad,
  usePlacements,
  useResource,
  useSelectedProject,
  useSelectedRevision,
} from '../../store';
import { Notice } from '../library/shared/FormParts';
import { CALCULATION_STATUS_LABEL, calculationStatusTone } from '../settings/settingsModel';
import { GroupedList } from './GroupedList';
import { ScopeSheet } from './ScopeSheet';
import {
  REPORT_FORMATS,
  SCOPE_ROUTE,
  buildRadiatorRows,
  formatByteSize,
  groupSummaries,
  materialItemCount,
  materialRows,
  radiatorGrandTotals,
  radiatorTypes,
  reportDataPath,
  reportDownloadPath,
  reportFileName,
  reportStats,
  resolveScope,
  summaryDetail,
  summaryQuantities,
  type MaterialRow,
  type RadiatorRow,
  type ReportFormat,
} from './reportModel';
import './output.css';

type View = 'materials' | 'radiators' | 'checks';

/**
 * Özet / Çıktı: rapor verisi (`GET /revisions/{id}/report`, alt ağaç kapsamında
 * `/report/subtree/{kök}`), gruplu ve yapışkan başlıklı malzeme listesi, radyatör metrajı,
 * hesap kontrolleri ve PDF / Excel / Word indirme.
 *
 * Kapsam: "rapor kapsamı yap" eylemi bu sekmenin yığınına `scope` rotası iter ve sekmeyi açar:
 *
 *   shellActions.push({ screen: 'scope', params: { placementId } }, 'output');
 *   shellActions.setTab('output');
 *
 * Kapsam seçici de aynı rotayı kullanır, yani geri tuşu kapsamı kaldırır.
 */
export default function OutputScreen() {
  const project = useSelectedProject();
  const revision = useSelectedRevision();
  const revisionId = revision?.id ?? null;
  const placements = usePlacements(revisionId);
  const placementsLoad = useLoad(revisionId ? loadKeys.revision(revisionId) : 'revision:none');
  const route = useTopRoute('output');
  const requestedScope = route?.screen === SCOPE_ROUTE ? (route.params?.placementId ?? route.params?.id ?? null) : null;
  const scope = useMemo(() => resolveScope(placements, requestedScope), [placements, requestedScope]);
  // Ağaç henüz gelmediyse istenen kapsam doğrulanamaz: bütün projeyi çekip sonra değiştirmek yerine bekle.
  const scopePending = Boolean(requestedScope) && !scope.rootId && placementsLoad.status !== 'ready';

  const dataVersion = useAppStore((state) => state.dataVersion);
  const activeTab = useActiveTab();
  const seenVersion = useRef<number | null>(null);
  useEffect(() => {
    if (activeTab !== 'output' || !revisionId) return;
    // Proje sekmesinde ölçüm değişti: açık ya da önbellekteki rapor bayattır.
    if (seenVersion.current !== null && seenVersion.current !== dataVersion)
      actions.invalidateResources(`report:${revisionId}`);
    seenVersion.current = dataVersion;
  }, [activeTab, dataVersion, revisionId]);

  const report = useResource(revisionId && !scopePending && `report:${revisionId}:${scope.rootId ?? 'all'}`, () =>
    api.get<ReportData>(reportDataPath(revisionId!, scope.rootId)),
  );

  const [view, setView] = useState<View>('materials');
  const [query, setQuery] = useState('');
  const [radiatorType, setRadiatorType] = useState('');
  const [scopeSheet, setScopeSheet] = useState(false);

  const setScope = (placementId: string | null) => {
    if (placementId === null) shellActions.popToRoot('output');
    else if (route?.screen === SCOPE_ROUTE)
      shellActions.replace({ screen: SCOPE_ROUTE, params: { placementId } }, 'output');
    else shellActions.push({ screen: SCOPE_ROUTE, params: { placementId } }, 'output');
  };

  if (!revisionId || scopePending || (!report.data && (report.status === 'loading' || report.status === 'idle')))
    return <SkeletonList label="Rapor hazırlanıyor" />;
  if (!report.data)
    return <ErrorState title="Rapor okunamadı" message={report.error} onRetry={() => report.reload()} />;

  const data = report.data;
  const stats = reportStats(data);
  const hasRadiators = stats.radiatorRows > 0;
  const hasChecks = data.calculationChecks.length > 0;
  const activeView: View =
    (view === 'radiators' && !hasRadiators) || (view === 'checks' && !hasChecks) ? 'materials' : view;

  return (
    <div className="m-screen m-out">
      <div className="m-out-scope-bar">
        <button
          type="button"
          className="m-out-scope-btn"
          onClick={() => setScopeSheet(true)}
          aria-haspopup="dialog"
          aria-label={`Rapor kapsamı: ${scope.root ? `${scope.root.displayName} ve altı` : 'bütün proje'}. Değiştir`}
        >
          <Icon name="project" size={20} />
          <span className="m-out-scope-btn__text">
            <small>Rapor kapsamı</small>
            <strong>{scope.root ? `${scope.root.displayName} ve altı` : 'Bütün proje'}</strong>
          </span>
          <Icon name="chevronDown" size={20} />
        </button>
        {scope.root && (
          <button type="button" className="m-btn m-btn--ghost m-btn--small" onClick={() => setScope(null)}>
            Bütün proje
          </button>
        )}
      </div>

      <dl className="m-out-stats" aria-label="Rapor özeti">
        <div>
          <dt>Malzeme</dt>
          <dd className="m-num">{stats.materials}</dd>
        </div>
        <div>
          <dt>Kaynak satırı</dt>
          <dd className="m-num">{stats.sources}</dd>
        </div>
        <div className={stats.pending ? 'is-attention' : undefined}>
          <dt>Bekleyen hesap</dt>
          <dd className="m-num">{stats.pending}</dd>
        </div>
      </dl>

      {stats.pending > 0 && (
        <div className="m-out-notice">
          <Notice
            tone="warning"
            action={
              <button
                type="button"
                className="m-btn m-btn--secondary m-btn--small"
                onClick={() => {
                  shellActions.popToRoot('settings');
                  shellActions.push({ screen: 'calculations' }, 'settings');
                  shellActions.setTab('settings');
                }}
              >
                Kontrol et
              </button>
            }
          >
            {stats.pending} hesap önerisi kontrol bekliyor. Onaylanana kadar rapora yansımaz.
          </Notice>
        </div>
      )}

      {(hasRadiators || hasChecks) && (
        <div className="m-chip-strip m-out-views" role="group" aria-label="Rapor görünümü">
          {(
            [
              ['materials', `Malzeme ${stats.materials}`],
              ...(hasRadiators ? [['radiators', `Radyatör ${stats.radiatorRows}`]] : []),
              ...(hasChecks ? [['checks', `Hesaplar ${data.calculationChecks.length}`]] : []),
            ] as Array<[View, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="m-pill"
              aria-pressed={activeView === value}
              onClick={() => {
                haptic('tick');
                setView(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="m-out-body">
        {activeView === 'materials' && (
          <MaterialsView
            data={data}
            placements={placements}
            query={query}
            onQuery={setQuery}
            scoped={Boolean(scope.root)}
          />
        )}
        {activeView === 'radiators' && (
          <RadiatorView rows={data.radiatorSummaries} type={radiatorType} onType={setRadiatorType} />
        )}
        {activeView === 'checks' && <ChecksView checks={data.calculationChecks} />}
      </div>

      <DownloadBar
        disabled={!revision}
        onDownload={async (format) => {
          const name = reportFileName(project?.code, revision?.code, format, scope.root?.cardCode);
          return api.download(reportDownloadPath(revisionId, format, scope.rootId), name);
        }}
      />
      <ScopeSheet
        open={scopeSheet}
        onClose={() => setScopeSheet(false)}
        revisionId={revisionId}
        currentId={scope.rootId}
        onSelect={setScope}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Malzeme listesi
// ---------------------------------------------------------------------------

function MaterialsView({
  data,
  placements,
  query,
  onQuery,
  scoped,
}: {
  data: ReportData;
  placements: Parameters<typeof groupSummaries>[1];
  query: string;
  onQuery: (query: string) => void;
  scoped: boolean;
}) {
  const groups = useMemo(() => groupSummaries(data.summaries, placements), [data.summaries, placements]);
  const rows = useMemo(() => materialRows(groups, query), [groups, query]);
  const headers = useMemo(
    () => new Map(rows.filter((row) => row.kind === 'header').map((row) => [row.groupKey, row])),
    [rows],
  );
  const count = materialItemCount(rows);

  if (!data.summaries.length)
    return (
      <EmptyState
        icon="output"
        title={scoped ? 'Bu kapsamda metraj yok' : 'Henüz metraj yok'}
        message={
          scoped
            ? 'Seçili kart ve altındakilerde ölçüm girilmemiş. Kapsamı genişletin.'
            : 'Proje sekmesinde bir malzeme seçip miktar girdiğinizde özet burada oluşur.'
        }
      />
    );

  return (
    <>
      <SearchBox value={query} onChange={onQuery} placeholder="Malzemelerde ara" />
      <p className="m-list-caption" role="status" aria-live="polite">
        {query.trim() ? `${count} / ${data.summaries.length} malzeme satırı` : `${count} malzeme satırı`} ·{' '}
        {data.revisionCode}
      </p>
      {rows.length === 0 ? (
        <EmptyState
          icon="search"
          title="Eşleşen malzeme yok"
          message="Başka bir sözcükle deneyin."
          action={
            <button type="button" className="m-btn m-btn--secondary" onClick={() => onQuery('')}>
              Aramayı temizle
            </button>
          }
        />
      ) : (
        <GroupedList<MaterialRow>
          rows={rows}
          ariaLabel="Malzeme listesi"
          estimateSize={(row) => (row.kind === 'header' ? 44 : 118)}
          renderSticky={(groupKey) => {
            const header = headers.get(groupKey);
            return header && header.kind === 'header' ? (
              <GroupHeader label={header.label} count={header.count} />
            ) : null;
          }}
          renderRow={(row) =>
            row.kind === 'header' ? (
              <GroupHeader label={row.label} count={row.count} />
            ) : (
              <MaterialItem summary={row.summary} />
            )
          }
        />
      )}
    </>
  );
}

function GroupHeader({ label, count, trailing }: { label: string; count?: number; trailing?: string }) {
  return (
    <div className="m-out-group">
      <strong>{label}</strong>
      {count !== undefined && <span className="m-badge m-num">{count}</span>}
      {trailing && <span className="m-out-group__total m-num">{trailing}</span>}
    </div>
  );
}

function MaterialItem({ summary }: { summary: Parameters<typeof summaryQuantities>[0] }) {
  const q = summaryQuantities(summary);
  return (
    <article className="m-out-item" aria-label={summary.placementName}>
      <div className="m-out-item__title">
        <strong>{summary.placementName}</strong>
        <small>{summaryDetail(summary)}</small>
      </div>
      <dl className="m-out-qty">
        <div>
          <dt>Net</dt>
          <dd className="m-num">{q.net}</dd>
        </div>
        <div>
          <dt>Fireli</dt>
          <dd className="m-num">{q.withWaste}</dd>
        </div>
        <div className="is-purchase">
          <dt>Satın alma</dt>
          <dd className="m-num">{q.purchase}</dd>
        </div>
      </dl>
      {(q.remainder || q.wastePct) && (
        <p className="m-out-item__extra">
          {q.remainder ? `Artan ${q.remainder}` : ''}
          {q.remainder && q.wastePct ? ' · ' : ''}
          {q.wastePct ? `fire ${q.wastePct}` : ''}
        </p>
      )}
    </article>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="m-search" role="search">
      <Icon name="search" size={20} />
      <input
        className="m-search__input"
        type="search"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button type="button" className="m-icon-button" aria-label="Aramayı temizle" onClick={() => onChange('')}>
          <Icon name="close" size={20} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Radyatör
// ---------------------------------------------------------------------------

function RadiatorView({
  rows,
  type,
  onType,
}: {
  rows: ReportData['radiatorSummaries'];
  type: string;
  onType: (type: string) => void;
}) {
  const types = useMemo(() => radiatorTypes(rows), [rows]);
  const selected = types.some((item) => item.type === type) ? type : '';
  const flat = useMemo(() => buildRadiatorRows(rows, selected), [rows, selected]);
  const totals = useMemo(() => radiatorGrandTotals(rows), [rows]);
  const headers = useMemo(
    () => new Map(flat.filter((row) => row.kind === 'header').map((row) => [row.groupKey, row])),
    [flat],
  );

  return (
    <>
      <div className="m-out-radtotals" role="status">
        {totals.map((total) => (
          <span key={total.unit}>
            Genel toplam · net <strong className="m-num">{total.net}</strong> {total.unit}
          </span>
        ))}
      </div>
      <div className="m-chip-strip" role="group" aria-label="Radyatör tipi">
        <button type="button" className="m-pill" aria-pressed={!selected} onClick={() => onType('')}>
          Tüm tipler
        </button>
        {types.map((item) => (
          <button
            key={item.type}
            type="button"
            className="m-pill"
            aria-pressed={selected === item.type}
            onClick={() => {
              haptic('tick');
              onType(item.type);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <GroupedList<RadiatorRow>
        rows={flat}
        ariaLabel="Radyatör metrajı"
        estimateSize={(row) => (row.kind === 'header' ? 48 : row.kind === 'height' ? 40 : 52)}
        renderSticky={(groupKey) => {
          const header = headers.get(groupKey);
          return header && header.kind === 'header' ? (
            <GroupHeader label={header.label} trailing={header.total} />
          ) : null;
        }}
        renderRow={(row) => {
          switch (row.kind) {
            case 'header':
              return <GroupHeader label={row.label} trailing={row.total} />;
            case 'height':
              return (
                <div className="m-out-height">
                  <strong>{row.label}</strong>
                  <span aria-hidden="true">Net · Fireli · Satın alma</span>
                </div>
              );
            case 'item':
              return (
                <RadiatorLine
                  label={row.label}
                  net={row.net}
                  withWaste={row.withWaste}
                  purchase={`${row.purchase}`}
                  hint={`${row.unit} · satın alma ${row.purchaseUnit}`}
                />
              );
            default:
              return (
                <RadiatorLine
                  label={row.label}
                  net={row.net}
                  withWaste={row.withWaste}
                  purchase={row.purchase}
                  total={row.kind === 'total'}
                  subtotal
                />
              );
          }
        }}
      />
    </>
  );
}

function RadiatorLine({
  label,
  net,
  withWaste,
  purchase,
  hint,
  subtotal,
  total,
}: {
  label: string;
  net: string;
  withWaste: string;
  purchase: string;
  hint?: string;
  subtotal?: boolean;
  total?: boolean;
}) {
  return (
    <div className={`m-out-radline${subtotal ? ' is-subtotal' : ''}${total ? ' is-total' : ''}`}>
      <span className="m-out-radline__label">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <dl className="m-out-radline__values">
        <div>
          <dt>Net</dt>
          <dd className="m-num">{net}</dd>
        </div>
        <div>
          <dt>Fireli</dt>
          <dd className="m-num">{withWaste}</dd>
        </div>
        <div>
          <dt>Satın alma</dt>
          <dd className="m-num">{purchase}</dd>
        </div>
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hesap kontrolleri
// ---------------------------------------------------------------------------

function ChecksView({ checks }: { checks: ReportData['calculationChecks'] }) {
  return (
    <ul className="m-out-checks" aria-label="Hesap kontrolleri">
      {checks.map((check) => (
        <li key={check.resultId} className="m-out-check">
          <div className="m-out-check__head">
            <strong>{check.targetName}</strong>
            <span className={`m-status m-status--${calculationStatusTone(check.status)}`}>
              {CALCULATION_STATUS_LABEL[check.status]}
            </span>
          </div>
          <small>
            {check.rule} v{check.ruleVersion} · önerilen {check.proposedQuantity.toLocaleString('tr-TR')} · satın alma{' '}
            {check.purchaseQuantity.toLocaleString('tr-TR')}
            {check.usedQuantity != null ? ` · kullanılan ${check.usedQuantity.toLocaleString('tr-TR')}` : ''}
          </small>
          {check.reason && <small className="m-out-check__reason">Gerekçe: {check.reason}</small>}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// İndirme
// ---------------------------------------------------------------------------

const FORMAT_ORDER: ReportFormat[] = ['excel', 'word', 'pdf'];

function downloadNote(result: DownloadResult): string | null {
  const size = result.size ? ` (${formatByteSize(result.size)})` : '';
  switch (result.outcome) {
    case 'cancelled':
      return 'İndirme iptal edildi.';
    case 'share':
      return `${result.name}${size} paylaşıma hazırlandı.`;
    case 'saveAs':
      return `${result.name}${size} cihaza kaydedildi.`;
    default:
      return `${result.name}${size} indirildi.`;
  }
}

function DownloadBar({
  disabled,
  onDownload,
}: {
  disabled: boolean;
  onDownload: (format: ReportFormat) => Promise<DownloadResult>;
}) {
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ format: ReportFormat; message: string } | null>(null);

  const run = async (format: ReportFormat) => {
    if (busy) return;
    setBusy(format);
    setNote(null);
    setFailure(null);
    try {
      const result = await onDownload(format);
      setNote(downloadNote(result));
    } catch (error) {
      setFailure({ format, message: errorMessage(error, 'Rapor hazırlanamadı.') });
      notifyError(error, 'Rapor hazırlanamadı.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="m-out-downloads">
      <div className="m-out-downloads__status" role="status" aria-live="polite">
        {busy ? (
          <span>
            <Spinner size={16} /> {REPORT_FORMATS[busy].label} hazırlanıyor… Büyük raporlar birkaç saniye sürebilir.
          </span>
        ) : failure ? (
          <span className="m-out-downloads__error" role="alert">
            {REPORT_FORMATS[failure.format].label} alınamadı: {failure.message}{' '}
            <button type="button" className="m-link" onClick={() => void run(failure.format)}>
              Tekrar dene
            </button>
          </span>
        ) : (
          (note ?? '')
        )}
      </div>
      <div className="m-bottom-actions m-bottom-actions--row" aria-label="Raporu al">
        {FORMAT_ORDER.map((format) => (
          <button
            key={format}
            type="button"
            className={`m-btn m-btn--large ${format === 'pdf' ? 'm-btn--primary' : 'm-btn--secondary'}`}
            disabled={disabled || busy !== null}
            aria-busy={busy === format}
            onClick={() => void run(format)}
          >
            {busy === format ? <Spinner size={20} /> : <Icon name="download" size={20} />}
            {REPORT_FORMATS[format].label}
          </button>
        ))}
      </div>
    </div>
  );
}
