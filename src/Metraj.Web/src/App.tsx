import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, ApiError } from './api';
import type {
  CalculationResult,
  CalculationRule,
  CardType,
  CatalogCard,
  CatalogCardAttributeDescriptor,
  CatalogCardVariant,
  CatalogCardType,
  CatalogVariantMode,
  DatabaseBackup,
  DatabaseIntegrity,
  Measurement,
  MeasurementSummary,
  MaterialWasteSetting,
  Placement,
  Project,
  ReportData,
  ResponsibilityData,
  Revision,
  StarterCatalogSeedResult,
} from './types';

type View = 'flow' | 'catalog' | 'settings' | 'control';
type PlacementNode = Node<Placement, 'placement'>;
type FlowBreakdownEntry = { id: string; quantity: number; createdAtUtc: string; notes?: string | null };
type FlowBreakdown = { label: string; quantity: number; entries: FlowBreakdownEntry[] };

const TYPE_META: Record<CardType, { label: string; color: string; icon: string }> = {
  Category: { label: 'Kategori', color: '#b58cff', icon: '◆' },
  Scope: { label: 'Kapsam', color: '#ffc65b', icon: '◈' },
  System: { label: 'Sistem', color: '#50caff', icon: '◉' },
  Material: { label: 'Malzeme', color: '#62e3ad', icon: '●' },
  Accessory: { label: 'Ek parça', color: '#ff86aa', icon: '✦' },
};

function BreakdownRow({ item, unit, active, displayLabel }: { item: FlowBreakdown; unit: string; active: boolean; displayLabel?: string }) {
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();

  const cancelTimer = () => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  const scheduleTooltip = () => {
    if (!active) return;
    cancelTimer();
    hoverTimer.current = window.setTimeout(() => {
      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect) return;
      const panelWidth = 248;
      const panelHeightLimit = 280;
      const gap = 10;
      const left = rect.right + gap + panelWidth <= window.innerWidth - 12
        ? rect.right + gap
        : Math.max(12, rect.left - panelWidth - gap);
      const top = Math.min(
        Math.max(12, rect.top - 12),
        Math.max(12, window.innerHeight - panelHeightLimit - 12),
      );
      setTooltipPosition({ left, top });
      hoverTimer.current = null;
    }, 900);
  };
  const closeTooltip = () => {
    cancelTimer();
    setTooltipPosition(null);
  };

  useEffect(() => {
    if (!active) closeTooltip();
    return () => cancelTimer();
  }, [active]);

  return <>
    <div
      ref={rowRef}
      className="breakdown-summary-row nodrag"
      tabIndex={active ? 0 : -1}
      aria-describedby={tooltipPosition ? tooltipId : undefined}
      onMouseEnter={scheduleTooltip}
      onMouseLeave={closeTooltip}
      onFocus={scheduleTooltip}
      onBlur={closeTooltip}
    >
      <span>{displayLabel ?? item.label}</span>
      <b>{quantity(item.quantity)} {unit}</b>
    </div>
    {tooltipPosition && createPortal(
      <aside
        id={tooltipId}
        role="tooltip"
        className="measurement-hover-card"
        style={{ left: tooltipPosition.left, top: tooltipPosition.top }}
      >
        <div className="measurement-hover-heading">
          <span>GİRİŞ GEÇMİŞİ</span>
          <strong>{item.label}</strong>
          <small>{item.entries.length} ayrı giriş · kronolojik</small>
        </div>
        <div className="measurement-hover-list">
          {item.entries.map((entry, index) => {
            const createdAt = Date.parse(entry.createdAtUtc);
            return <div key={entry.id}>
              <i>{index + 1}</i>
              <b>{quantity(entry.quantity)} {unit}</b>
              <time>{Number.isFinite(createdAt) ? new Date(createdAt).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</time>
              {entry.notes && <small>{entry.notes}</small>}
            </div>;
          })}
        </div>
        <footer>Toplam <b>{quantity(item.quantity)} {unit}</b></footer>
      </aside>,
      document.body,
    )}
  </>;
}

function FlowCard({ data, selected }: NodeProps<PlacementNode>) {
  const meta = TYPE_META[data.cardType];
  const expanded = Boolean(data.expanded);
  const nodeSummary = data.uiSummary as MeasurementSummary | undefined;
  const breakdown = data.uiBreakdown as FlowBreakdown[] | undefined;
  const placementNote = typeof data.notes === 'string' ? data.notes.trim() : '';
  // Varyantlı kartlarda (boru, fitting ve radyatör) toplamı kaynak kırılımından
  // üret. Böylece aynı kartta birden fazla yükseklik/genişlik veya çap varsa
  // genişletilmiş karttaki toplam bütün girişleri kapsar.
  const aggregateQuantity = breakdown?.length ? breakdown.reduce((total, item) => total + item.quantity, 0) : nodeSummary?.netQuantity;
  return (
    <div className={`flow-card ${selected ? 'selected' : ''} ${expanded ? 'expanded' : ''} ${expanded && data.variantMode === 'Fitting' ? 'fitting-expanded' : ''}`} style={{ '--node-accent': meta.color } as React.CSSProperties}>
      <Handle type="target" position={Position.Left} className="flow-handle" aria-label="Bu karta bağla" />
      <div className="flow-card-top"><span className="node-kind">{meta.icon} {meta.label}</span>{data.positionNumber && <span className="node-poz">{data.positionNumber}</span>}</div>
      <strong>{data.displayName}</strong>
      <span className="node-code">{data.cardCode}</span>
      <span className="node-work">{data.isMeasurable ? `Metraj gir · ${data.unit}` : 'Düzenleme kartı'}</span>
      <div className={`node-summary-shell ${expanded ? 'open' : ''}`} aria-hidden={!expanded}>
        <div className="node-summary">
          {placementNote && <div className="node-card-note"><span>KARTA ÖZEL NOT</span><p>{placementNote}</p></div>}
          {aggregateQuantity !== undefined
            ? <b className="node-summary-total">{quantity(aggregateQuantity)} {nodeSummary?.unit ?? data.unit}</b>
            : data.isMeasurable
              ? <b className="node-summary-total">Henüz giriş yok</b>
              : !placementNote && <small>Bu kartta ölçüm girişi bulunmuyor.</small>}
          {data.variantMode === 'Fitting' && breakdown?.length
            ? <div className="fitting-summary-grid">{[...new Set(breakdown.map((item) => item.label.split(' · ')[0]))].map((diameter) => <div className="fitting-summary-tile" key={diameter}><strong>{diameter}</strong>{breakdown.filter((item) => item.label === diameter || item.label.startsWith(`${diameter} · `)).map((item) => <BreakdownRow key={item.label} item={item} displayLabel={item.label.split(' · ').slice(1).join(' · ') || item.label} unit={data.unit} active={expanded} />)}</div>)}</div>
            : data.variantMode === 'Pipe' && breakdown?.length
              ? <div className="pipe-summary-list">{breakdown.map((item) => <BreakdownRow key={item.label} item={item} unit={data.unit} active={expanded} />)}</div>
              : breakdown?.length
                ? <div className="generic-summary-list">{breakdown.map((item) => <BreakdownRow key={item.label} item={item} unit={data.unit} active={expanded} />)}</div>
                : null}
          <em>{breakdown?.length ? 'Bir satırda bekleyerek tarihli girişleri gör · daraltmak için çift tıkla' : 'Daraltmak için çift tıkla'}</em>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="flow-handle" aria-label="Bu karttan bağla" />
    </div>
  );
}

const nodeTypes: NodeTypes = { placement: FlowCard };

function buildFlow(placements: Placement[]): { nodes: PlacementNode[]; edges: Edge[] } {
  const children = new Map<string | null, Placement[]>();
  for (const item of placements) {
    const key = item.parentPlacementId ?? null;
    children.set(key, [...(children.get(key) ?? []), item]);
  }
  const nodes: PlacementNode[] = [];
  let leaf = 0;
  const visit = (placement: Placement, depth: number): number => {
    const ownChildren = children.get(placement.id) ?? [];
    const childY = ownChildren.map((child) => visit(child, depth + 1));
    const y = childY.length ? childY.reduce((sum, value) => sum + value, 0) / childY.length : leaf++ * 172;
    nodes.push({ id: placement.id, type: 'placement', position: { x: depth * 300, y }, data: placement });
    return y;
  };
  (children.get(null) ?? []).forEach((root) => visit(root, 0));
  const edges: Edge[] = placements
    .filter((item) => item.parentPlacementId)
    .map((item) => ({
      id: `${item.parentPlacementId}-${item.id}`,
      source: item.parentPlacementId!,
      target: item.id,
      type: 'smoothstep',
      animated: false,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#7787a7' },
      style: { stroke: '#7787a7', strokeWidth: 2 },
    }));
  return { nodes, edges };
}

function quantity(value: number) {
  // Rapor çıktılarıyla aynı hassasiyet. 3 basamakla sınırlıyken 0,0004 gibi
  // küçük ama geçerli bir miktar ekranda ve Excel'de 0 görünüyor, PDF'te
  // görünüyordu; kullanıcı ya sıfır sanıp veriyi siliyor ya da iki çıktının
  // çeliştiğini görüyordu. Sondaki sıfırlar yine gösterilmez.
  return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 6 }).format(value);
}

function purchaseUnit(summary: MeasurementSummary) {
  return summary.purchaseUnit || (summary.unit === 'm' && summary.variant ? 'boy' : summary.unit);
}

function makeCardCode(name: string) {
  const stem = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toUpperCase().slice(0, 18);
  return `${stem || 'KART'}-${Date.now().toString(36).toUpperCase()}`;
}

function measurementLabel(notes?: string | null) {
  const radiator = notes?.match(/Radyatör:\s*([^·]+)\s*·\s*Yükseklik:\s*([^·]+)\s*·\s*Genişlik:\s*(.+)$/i);
  if (radiator) return `${radiator[1].trim()} · H${radiator[2].trim()} · W${radiator[3].trim()}`;
  return notes?.split(' · ')[0]?.trim() || 'Standart';
}

export default function App() {
  const [view, setView] = useState<View>('flow');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem('metraj.sidebar-collapsed') === '1');
  const [projects, setProjects] = useState<Project[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [catalogTypes, setCatalogTypes] = useState<CatalogCardType[]>([]);
  const [catalogAttributes, setCatalogAttributes] = useState<CatalogCardAttributeDescriptor[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [summaries, setSummaries] = useState<MeasurementSummary[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  const [rules, setRules] = useState<CalculationRule[]>([]);
  const [calculationResults, setCalculationResults] = useState<CalculationResult[]>([]);
  const [responsibilities, setResponsibilities] = useState<ResponsibilityData | null>(null);
  const [backups, setBackups] = useState<DatabaseBackup[]>([]);
  const [integrity, setIntegrity] = useState<DatabaseIntegrity | null>(null);
  const [wasteSettings, setWasteSettings] = useState<MaterialWasteSetting[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedRevisionId, setSelectedRevisionId] = useState<string>('');
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<PlacementNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [flow, setFlow] = useState<ReactFlowInstance<PlacementNode, Edge> | null>(null);
  const viewportNudgeTimers = useRef<number[]>([]);
  // Kullanıcının sürüklediği konumlar yerleşim kimliğine göre hatırlanır.
  // Önceden her loadRevision buildFlow ile konumları sıfırdan üretiyordu: bir
  // ölçüm kaydedince bütün kartlar eski yerine sıçrıyordu.
  const nodePositions = useRef<Map<string, { x: number; y: number }>>(new Map());
  const [showProjectDialog, setShowProjectDialog] = useState(false);
  const [showCardShelf, setShowCardShelf] = useState(false);
  const [showTypeDialog, setShowTypeDialog] = useState(false);
  const [showContext, setShowContext] = useState(false);
  // Birden fazla kart aynı anda açık kalabilir; bu özellikle yan yana
  // karşılaştırılan boru ve fitting kartlarında akışı hızlandırır.
  const [expandedPlacementIds, setExpandedPlacementIds] = useState<Set<string>>(() => new Set());
  const expandedPlacementIdsRef = useRef<Set<string>>(new Set());
  const [reportScopeId, setReportScopeId] = useState<string | null>(null);
  const [addNewCardToFlow, setAddNewCardToFlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [projectDraft, setProjectDraft] = useState({ code: '', name: '' });
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [cardDraft, setCardDraft] = useState<CardDraftState>({ code: '', name: '', type: 'Material', unit: 'adet', customTypeId: '', attributeValues: {}, variantMode: 'None', variants: [], notes: '', materialType: '', wasteRatePct: '0' });
  const [typeDraft, setTypeDraft] = useState({ code: '', name: '', baseCardType: 'Material' as CardType, description: '', parentCardIds: [] as string[], childCardIds: [] as string[], attributeKeys: [] as string[] });
  const [measurementDraft, setMeasurementDraft] = useState({ quantity: '', block: '', floor: '', room: '', sheet: '', notes: '' });
  const [placementNotesDraft, setPlacementNotesDraft] = useState('');
  const [ruleDraft, setRuleDraft] = useState({ code: '', name: '', multiplier: '1' });
  const [calculationTargetId, setCalculationTargetId] = useState('');
  const [calculationSourceId, setCalculationSourceId] = useState('');
  const [dimensionDraft, setDimensionDraft] = useState({ code: '', name: '' });
  const [partyDraft, setPartyDraft] = useState({ code: '', name: '' });
  const [assignmentDraft, setAssignmentDraft] = useState({ dimensionId: '', partyId: '', placementId: '', state: 'Assigned' });
  const [wasteDraft, setWasteDraft] = useState({ materialType: '', wasteRatePct: '0' });
  const revisionLoadSequence = useRef(0);
  const advancedLoadSequence = useRef(0);

  const selectedProject = projects.find((item) => item.id === selectedProjectId) ?? null;
  const selectedRevision = revisions.find((item) => item.id === selectedRevisionId) ?? null;
  const selectedPlacement = placements.find((item) => item.id === selectedPlacementId) ?? null;
  const canEdit = selectedRevision?.status === 'Draft';
  const measurablePlacements = placements.filter((item) => item.isMeasurable && item.inputBehavior !== 'Derived');

  // Tek bir zamanlayıcı tutulur. Önceden her çağrı yeni bir setTimeout kuruyor
  // ve iptal etmiyordu; arka arkaya iki bildirimde ilkinin zamanlayıcısı
  // ikincisini erken siliyordu (özellikle hata mesajlarını).
  const toastTimer = useRef<number | null>(null);
  const notify = useCallback((message: string) => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => {
      setToast('');
      toastTimer.current = null;
    }, 3200);
  }, []);
  useEffect(() => () => { if (toastTimer.current !== null) window.clearTimeout(toastTimer.current); }, []);

  // Yükleyiciler hatayı kendi içlerinde yakalayıp normal dönüyor; bu yüzden
  // çağıran, başarısız bir yenilemeden sonra "başarılı" mesajı gösterebiliyordu.
  // Kullanıcı arka arkaya hem hata hem başarı toast'ı görüp hangisinin geçerli
  // olduğunu bilemiyordu.
  const operationFailed = useRef(false);
  const fail = useCallback((error: unknown) => {
    operationFailed.current = true;
    notify(error instanceof ApiError ? error.message : 'Bir şey ters gitti. Tekrar deneyin.');
  }, [notify]);
  const notifySuccess = (message: string) => { if (!operationFailed.current) notify(message); };

  const clearProjectView = useCallback(() => {
    revisionLoadSequence.current += 1;
    advancedLoadSequence.current += 1;
    setRevisions([]);
    setSelectedRevisionId('');
    setPlacements([]);
    setMeasurements([]);
    setSummaries([]);
    setReport(null);
    setSelectedPlacementId(null);
    setNodes([]);
    setEdges([]);
    // Önceki projeye ait BAĞIMLI seçimler de temizlenmeli. Bunlar kalınca
    // "Bu daldan metraj" başlığı eski projenin kartını gösteriyor, hesap
    // komutları eski proje kimlikleriyle gönderiliyordu.
    setReportScopeId(null);
    setCalculationTargetId('');
    setCalculationSourceId('');
    setAssignmentDraft({ dimensionId: '', partyId: '', placementId: '', state: 'Assigned' });
    setRules([]);
    setCalculationResults([]);
    setResponsibilities(null);
    nodePositions.current = new Map();
    const emptyExpanded = new Set<string>();
    expandedPlacementIdsRef.current = emptyExpanded;
    setExpandedPlacementIds(emptyExpanded);
  }, []);

  const selectProject = useCallback((projectId: string) => {
    clearProjectView();
    setSelectedProjectId(projectId);
  }, [clearProjectView]);

  const loadProjects = useCallback(async () => {
    try {
      const next = await api.get<Project[]>('/projects');
      setProjects(next);
      // Geri yükleme sonrası, artık var olmayan bir projede kalınmamalı.
      // Önceki sürüm dolu bir seçimi koşulsuz koruyordu; kullanıcı silinmiş bir
      // projenin adını üst çubukta görüp boş ekranlarla kalıyordu.
      setSelectedProjectId((current) => next.some((project) => project.id === current) ? current : next[0]?.id ?? '');
    } catch (error) { fail(error); }
  }, []);

  const loadCards = useCallback(async () => {
    try { setCards(await api.get<CatalogCard[]>('/catalog/cards')); } catch (error) { fail(error); }
  }, []);
  const loadCatalogTypeSettings = useCallback(async () => {
    try {
      const [nextTypes, nextAttributes] = await Promise.all([
        api.get<CatalogCardType[]>('/catalog/types'),
        api.get<CatalogCardAttributeDescriptor[]>('/catalog/attributes'),
      ]);
      setCatalogTypes(nextTypes);
      setCatalogAttributes(nextAttributes);
    } catch (error) { fail(error); }
  }, []);

  const loadRevision = useCallback(async (revisionId: string) => {
    const requestSequence = ++revisionLoadSequence.current;
    if (!revisionId) return;
    try {
      const [nextPlacements, nextMeasurements, nextSummaries, nextReport] = await Promise.all([
        api.get<Placement[]>(`/revisions/${revisionId}/placements`),
        api.get<Measurement[]>(`/revisions/${revisionId}/measurements`),
        api.get<MeasurementSummary[]>(`/revisions/${revisionId}/measurement-summaries`),
        api.get<ReportData>(`/revisions/${revisionId}/report`),
      ]);
      // Geç kalmış bir önceki proje/sürüm yanıtı, aktif görünümü ezmemelidir.
      if (requestSequence !== revisionLoadSequence.current) return;
      setPlacements(nextPlacements);
      setMeasurements(nextMeasurements);
      setSummaries(nextSummaries);
      setReport(nextReport);
      const nextFlow = buildFlow(nextPlacements);
      // Silinmiş kartların konumlarını taşımaya gerek yok.
      const liveIds = new Set(nextPlacements.map((item) => item.id));
      nodePositions.current = new Map([...nodePositions.current].filter(([id]) => liveIds.has(id)));
      nextFlow.nodes = nextFlow.nodes.map((node) => {
        const itemSummary = nextSummaries.find((item) => item.placementId === node.id);
        const groups = new Map<string, FlowBreakdown>();
        nextMeasurements.filter((item) => item.placementId === node.id).forEach((item) => {
          const label = [item.variant, item.secondaryVariant].filter(Boolean).join(' · ') || measurementLabel(item.notes);
          const existing = groups.get(label);
          const entry = { id: item.id, quantity: item.inputQuantity, createdAtUtc: item.createdAtUtc, notes: item.notes };
          if (existing) {
            existing.quantity += item.inputQuantity;
            existing.entries.push(entry);
          } else {
            groups.set(label, { label, quantity: item.inputQuantity, entries: [entry] });
          }
        });
        const uiBreakdown = [...groups.values()].map((group) => ({
          ...group,
          entries: [...group.entries].sort((a, b) => {
            const left = Date.parse(a.createdAtUtc);
            const right = Date.parse(b.createdAtUtc);
            return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0) || a.id.localeCompare(b.id);
          }),
        }));
        const remembered = nodePositions.current.get(node.id);
        return { ...node, position: remembered ?? node.position, data: { ...node.data, expanded: expandedPlacementIdsRef.current.has(node.id), uiSummary: itemSummary, uiBreakdown } };
      });
      setNodes(nextFlow.nodes);
      setEdges(nextFlow.edges);
      setSelectedPlacementId((current) => nextPlacements.some((item) => item.id === current) ? current : nextPlacements[0]?.id ?? null);
      window.setTimeout(() => flow?.fitView({ padding: 0.24, duration: 420 }), 80);
    } catch (error) { fail(error); }
  }, [flow]);

  const loadAdvanced = useCallback(async () => {
    if (!selectedRevisionId) return;
    // loadRevision'daki yarış koruması burada da gerekli: geç gelen bir önceki
    // projenin yanıtı, aktif projenin kural ve sonuç listelerini ezmemeli.
    const requestSequence = ++advancedLoadSequence.current;
    try {
      const [nextRules, nextResults, nextResponsibilities, nextBackups, nextIntegrity, nextWasteSettings] = await Promise.all([
        api.get<CalculationRule[]>(`/revisions/${selectedRevisionId}/calculations/rules`),
        api.get<CalculationResult[]>(`/revisions/${selectedRevisionId}/calculations/results`),
        api.get<ResponsibilityData>(`/revisions/${selectedRevisionId}/responsibilities`),
        api.get<DatabaseBackup[]>('/database/backups'),
        api.get<DatabaseIntegrity>('/database/integrity'),
        api.get<MaterialWasteSetting[]>('/settings/material-waste'),
      ]);
      if (requestSequence !== advancedLoadSequence.current) return;
      setRules(nextRules); setCalculationResults(nextResults); setResponsibilities(nextResponsibilities);
      setBackups(nextBackups); setIntegrity(nextIntegrity); setWasteSettings(nextWasteSettings);
    } catch (error) { fail(error); }
  }, [selectedRevisionId]);

  useEffect(() => { void loadProjects(); void loadCards(); void loadCatalogTypeSettings(); }, [loadCards, loadCatalogTypeSettings, loadProjects]);
  useEffect(() => {
    if (!selectedProjectId) { clearProjectView(); return; }
    let cancelled = false;
    void api.get<Revision[]>(`/projects/${selectedProjectId}/revisions`).then((next) => {
      if (cancelled) return;
      setRevisions(next);
      setSelectedRevisionId(next[0]?.id ?? '');
    }).catch(fail);
    return () => { cancelled = true; };
  }, [clearProjectView, selectedProjectId]);
  useEffect(() => { void loadRevision(selectedRevisionId); }, [loadRevision, selectedRevisionId]);
  useEffect(() => { if (view === 'settings') void loadAdvanced(); }, [loadAdvanced, view]);
  useEffect(() => { window.localStorage.setItem('metraj.sidebar-collapsed', sidebarCollapsed ? '1' : '0'); }, [sidebarCollapsed]);
  useEffect(() => { setPlacementNotesDraft(selectedPlacement?.notes ?? ''); }, [selectedPlacementId, selectedPlacement?.notes]);

  const reload = async () => { await Promise.all([loadProjects(), loadCards(), loadCatalogTypeSettings(), loadRevision(selectedRevisionId)]); };
  const withBusy = async (work: () => Promise<void>) => {
    setBusy(true);
    operationFailed.current = false;
    try { await work(); } catch (error) { fail(error); } finally { setBusy(false); }
  };

  const createDraftRevision = () => withBusy(async () => {
    if (!selectedProjectId) throw new ApiError('Önce bir proje seçin.');
    const created = await api.post<Revision>(`/projects/${selectedProjectId}/revisions`);
    const next = await api.get<Revision[]>(`/projects/${selectedProjectId}/revisions`);
    setRevisions(next); setSelectedRevisionId(created.id); notifySuccess(`${created.code} düzenleme kopyası hazır.`);
  });
  const approveRevision = () => withBusy(async () => {
    if (!selectedRevisionId) return;
    await api.post(`/revisions/${selectedRevisionId}/approve`);
    const next = await api.get<Revision[]>(`/projects/${selectedProjectId}/revisions`);
    setRevisions(next); await loadRevision(selectedRevisionId); notifySuccess('Bu sürüm onaylandı ve kilitlendi.');
  });
  const createRule = () => withBusy(async () => {
    const multiplier = Number(ruleDraft.multiplier.replace(',', '.'));
    if (!ruleDraft.code.trim() || !ruleDraft.name.trim() || !Number.isFinite(multiplier) || multiplier < 0) throw new ApiError('Kuralın kodunu, adını ve çarpanını yazın.');
    await api.post(`/revisions/${selectedRevisionId}/calculations/rules`, { code: ruleDraft.code, name: ruleDraft.name, mode: 'FixedMultiplier', multiplier, sourceQuantityKind: 'Net' });
    setRuleDraft({ code: '', name: '', multiplier: '1' }); await loadAdvanced(); notifySuccess('Hesap kuralı eklendi.');
  });
  const runCalculation = (ruleId: string) => withBusy(async () => {
    const targetPlacementId = calculationTargetId || selectedPlacementId;
    if (!targetPlacementId) throw new ApiError('Önce hesaplanacak kartı seçin.');
    await api.post(`/revisions/${selectedRevisionId}/calculations/results`, { targetPlacementId, ruleVersionId: ruleId });
    await Promise.all([loadAdvanced(), loadRevision(selectedRevisionId)]); notifySuccess('Hesap önerisi kontrol listesine eklendi.');
  });
  const linkCalculationSource = () => withBusy(async () => {
    const targetPlacementId = calculationTargetId || selectedPlacementId;
    if (!targetPlacementId) throw new ApiError('Önce hesaplanacak ek parça kartını seçin.');
    if (!calculationSourceId) throw new ApiError('Bu hesabın kaynak kartını seçin.');
    if (targetPlacementId === calculationSourceId) throw new ApiError('Kaynak kartı ile hesaplanacak kart aynı olamaz.');
    await api.post(`/placements/${targetPlacementId}/calculated-from`, { sourcePlacementId: calculationSourceId, notes: null });
    setCalculationSourceId('');
    notifySuccess('Hesap kaynağı bağlandı. Artık öneri üretebilirsin.');
  });
  const reviewCalculation = (resultId: string, decision: 'approve' | 'reject') => withBusy(async () => {
    if (decision === 'approve') await api.post(`/calculations/results/${resultId}/approve`);
    else {
      const reason = window.prompt('Neden uygulanmasın?', 'Kontrol sonrası uygulanmadı');
      if (reason === null) return;
      await api.post(`/calculations/results/${resultId}/reject`, { reason });
    }
    await Promise.all([loadAdvanced(), loadRevision(selectedRevisionId)]); notify(decision === 'approve' ? 'Hesap önerisi onaylandı.' : 'Hesap önerisi uygulanmadı.');
  });
  const overrideCalculation = (result: CalculationResult) => withBusy(async () => {
    const enteredQuantity = window.prompt(`${result.targetPlacementName} için kullanılacak miktar (${result.unit})`, String(result.proposedQuantity));
    if (enteredQuantity === null) return;
    const usedQuantity = Number(enteredQuantity.replace(',', '.'));
    const reason = window.prompt('Bu miktar neden elle değiştirildi?', 'Saha kontrolü sonrası düzeltildi');
    if (reason === null) return;
    if (!Number.isFinite(usedQuantity) || usedQuantity < 0) throw new ApiError('Kullanılacak miktarı sayı olarak yazın.');
    await api.post(`/calculations/results/${result.id}/override`, { usedQuantity, reason });
    await Promise.all([loadAdvanced(), loadRevision(selectedRevisionId)]); notifySuccess('Hesap önerisi elle güncellendi.');
  });
  const createDimension = () => withBusy(async () => {
    if (!dimensionDraft.code.trim() || !dimensionDraft.name.trim()) throw new ApiError('Boyut için kod ve ad yazın.');
    await api.post(`/revisions/${selectedRevisionId}/responsibilities/dimensions`, dimensionDraft);
    setDimensionDraft({ code: '', name: '' }); await loadAdvanced(); notifySuccess('Sorumluluk boyutu eklendi.');
  });
  const createParty = () => withBusy(async () => {
    if (!partyDraft.code.trim() || !partyDraft.name.trim()) throw new ApiError('Taraf için kod ve ad yazın.');
    await api.post(`/revisions/${selectedRevisionId}/responsibilities/parties`, partyDraft);
    setPartyDraft({ code: '', name: '' }); await loadAdvanced(); notifySuccess('Taraf eklendi.');
  });
  const assignResponsibility = () => withBusy(async () => {
    const placementId = assignmentDraft.placementId || selectedPlacementId;
    if (!assignmentDraft.dimensionId || !placementId) throw new ApiError('Boyut ve kart seçin.');
    await api.post(`/revisions/${selectedRevisionId}/responsibilities/assignments`, { ...assignmentDraft, placementId, partyId: assignmentDraft.partyId || null, notes: null });
    await loadAdvanced(); notifySuccess('Sorumluluk atandı.');
  });
  const createBackup = () => withBusy(async () => { await api.post('/database/backups'); await loadAdvanced(); notifySuccess('Güvenli yedek alındı.'); });
  const checkIntegrity = () => withBusy(async () => { const result = await api.get<DatabaseIntegrity>('/database/integrity'); setIntegrity(result); notify(result.isHealthy ? 'Veritabanı kontrolü temiz.' : 'Veritabanı kontrolü uyarı verdi.'); });
  const restoreBackup = (backup: DatabaseBackup) => withBusy(async () => {
    if (!window.confirm(`${backup.fileName} yedeğine dönülsün mü? Önce mevcut hal ayrıca yedeklenir.`)) return;
    await api.post('/database/backups/restore', { fullPath: backup.fullPath });
    await reload(); await loadAdvanced(); notifySuccess('Yedek geri yüklendi.');
  });
  const saveWasteSetting = () => withBusy(async () => {
    const materialType = wasteDraft.materialType.trim();
    const wasteRatePct = Number(wasteDraft.wasteRatePct.replace(',', '.'));
    if (!materialType) throw new ApiError('Fire payı için malzeme ailesi yazın.');
    if (!Number.isFinite(wasteRatePct) || wasteRatePct < 0 || wasteRatePct > 1000) throw new ApiError('Fire payını 0 ile 1000 arasında yazın.');
    await api.put('/settings/material-waste', { materialType, wasteRatePct });
    setWasteDraft({ materialType: '', wasteRatePct: '0' });
    // Fire politikası özetleri etkiler. Yalnızca loadAdvanced çağırmak, ekrandaki
    // tabloyu eski sayılarla bırakıyor ama indirilen dosya yeni sayılarla
    // üretiliyordu; kullanıcı hangisinin doğru olduğunu anlayamıyordu.
    await Promise.all([loadAdvanced(), loadRevision(selectedRevisionId)]);
    notifySuccess(`${materialType} için %${quantity(wasteRatePct)} fire payı kaydedildi.`);
  });
  const removeWasteSetting = (setting: MaterialWasteSetting) => withBusy(async () => {
    if (!window.confirm(`“${setting.materialType}” fire kuralı kaldırılsın mı?`)) return;
    await api.delete(`/settings/material-waste/${setting.id}`);
    await Promise.all([loadAdvanced(), loadRevision(selectedRevisionId)]);
    notifySuccess('Malzeme fire kuralı kaldırıldı.');
  });
  const editWasteSetting = (setting: MaterialWasteSetting) => setWasteDraft({ materialType: setting.materialType, wasteRatePct: String(setting.wasteRatePct) });

  const createProject = () => withBusy(async () => {
    const created = await api.post<Project>('/projects', { code: projectDraft.code, name: projectDraft.name, description: null });
    // İlk ağ yenilemesi tamamlanana kadar karşılama ekranına geri düşmemesi için
    // oluşturulan projeyi yerel seçim durumuna hemen ekle.
    setProjects((current) => current.some((project) => project.id === created.id) ? current : [created, ...current]);
    selectProject(created.id);
    setShowProjectDialog(false);
    setProjectDraft({ code: '', name: '' });
    void loadProjects();
    notifySuccess('Proje hazır. Şimdi kartlarını ekleyelim.');
  });
  const importExample = () => withBusy(async () => {
    await api.post('/synthetic-clean-water');
    // Örnek proje kartları da katalogya eklendiğinden, akış kartlığı anında
    // seçilebilir kartları göstermek için her iki listeyi birlikte yenile.
    await Promise.all([loadProjects(), loadCards()]);
    notifySuccess('Örnek Temiz Su projesi hazır.');
  });
  const seedStarterCatalog = () => withBusy(async () => {
    const result = await api.post<StarterCatalogSeedResult>('/catalog/starter-pack');
    await loadCards();
    notify(result.addedCount ? `${result.addedCount} standart kart kütüphaneye eklendi.` : 'Standart kütüphane zaten yüklü.');
  });
  const createCatalogType = () => withBusy(async () => {
    if (!typeDraft.code.trim() || !typeDraft.name.trim()) throw new ApiError('Yeni tür için kod ve ad yazın.');
    await api.post<CatalogCardType>('/catalog/types', {
      code: typeDraft.code.trim(), name: typeDraft.name.trim(), baseCardType: typeDraft.baseCardType,
      allowedParentCardIds: typeDraft.parentCardIds, allowedChildCardIds: typeDraft.childCardIds,
      attributeKeys: typeDraft.attributeKeys, description: typeDraft.description.trim() || null,
    });
    setTypeDraft({ code: '', name: '', baseCardType: 'Material', description: '', parentCardIds: [], childCardIds: [], attributeKeys: [] });
    setShowTypeDialog(false);
    await loadCatalogTypeSettings();
    notifySuccess('Yeni kart türü global kütüphaneye eklendi.');
  });
  const deleteCatalogType = (type: CatalogCardType) => withBusy(async () => {
    if (!window.confirm(`“${type.name}” türü yeni kart seçimlerinden kaldır? Mevcut kartlar korunur.`)) return;
    await api.delete(`/catalog/types/${type.id}`);
    await Promise.all([loadCatalogTypeSettings(), loadCards()]);
    notifySuccess('Kart türü kaldırıldı.');
  });
  const createCard = () => withBusy(async () => {
    if (!cardDraft.name.trim() || !cardDraft.unit.trim()) throw new ApiError('Kart adı ve birimi gerekli.');
    const selectedType = catalogTypes.find((type) => type.id === cardDraft.customTypeId);
    const wasteRatePct = Number(cardDraft.wasteRatePct.replace(',', '.'));
    if (!Number.isFinite(wasteRatePct) || wasteRatePct < 0) throw new ApiError('Fire payını sıfır veya daha büyük bir sayı olarak yazın.');
    const attributeValues = selectedType ? { ...cardDraft.attributeValues } : null;
    if (selectedType && attributeValues) {
      const enabled = new Set(selectedType.attributeKeys.map((key) => key.toLowerCase()));
      if (enabled.has('notes')) {
        if (cardDraft.notes.trim()) attributeValues.Notes = cardDraft.notes.trim(); else delete attributeValues.Notes;
      }
      if (enabled.has('materialtype')) {
        if (cardDraft.materialType.trim()) attributeValues.MaterialType = cardDraft.materialType.trim(); else delete attributeValues.MaterialType;
      }
      if (enabled.has('wasteratepct')) attributeValues.WasteRatePct = String(wasteRatePct);
    }
    // Yalnızca kullanıcının gerçekten değiştirdiği kontrollere bağlı alanlar
    // yeniden çıkarılır; geri kalanı kartın mevcut hâlinden taşınır.
    const carried = cardDraft.carried;
    const effectiveType = selectedType?.baseCardType ?? cardDraft.type;
    const typeChanged = !carried || carried.cardType !== effectiveType;
    const variantModeChanged = !carried || carried.variantMode !== cardDraft.variantMode;
    const payload = {
      code: cardDraft.code.trim() || makeCardCode(cardDraft.name),
      name: cardDraft.name.trim(),
      cardType: effectiveType,
      unit: cardDraft.unit.trim(),
      inputBehavior: carried?.inputBehavior ?? 'Manual',
      salesConversion: cardDraft.variantMode === 'Pipe'
        ? 'StandardLength'
        : variantModeChanged ? 'None' : carried?.salesConversion ?? 'None',
      reportBehavior: typeChanged
        ? (effectiveType === 'Material' || effectiveType === 'Accessory' ? 'Measurable' : 'Folder')
        : carried!.reportBehavior,
      wasteRatePct,
      containerParameter: cardDraft.variantMode === 'Pipe' && cardDraft.variants[0]?.standardLength
        ? cardDraft.variants[0].standardLength
        : variantModeChanged ? null : carried?.containerParameter ?? null,
      positionNumber: carried?.positionNumber ?? null,
      notes: cardDraft.notes.trim() || null, materialType: cardDraft.materialType.trim() || null,
      customTypeId: selectedType?.id ?? null, attributeValues, variantMode: cardDraft.variantMode, variants: cardDraft.variants,
    };
    const created = editingCardId
      ? await api.post<CatalogCard>(`/catalog/cards/${editingCardId}/versions`, payload)
      : await api.post<CatalogCard>('/catalog/cards', payload);
    const wasEditing = Boolean(editingCardId);
    setEditingCardId(null);
    setCardDraft({ code: '', name: '', type: 'Material', unit: 'adet', customTypeId: '', attributeValues: {}, variantMode: 'None', variants: [], notes: '', materialType: '', wasteRatePct: '0' });
    await loadCards();
    if (addNewCardToFlow && !wasEditing) {
      if (!selectedRevisionId) throw new ApiError('Kartı akışa eklemek için önce bir proje seçin.');
      const placement = await api.post<Placement>(`/revisions/${selectedRevisionId}/placements`, { cardVersionId: created.latestVersionId, parentPlacementId: selectedPlacementId, displayNameOverride: null, procurementScope: null });
      setAddNewCardToFlow(false);
      await loadRevision(selectedRevisionId);
      setSelectedPlacementId(placement.id);
      setView('flow');
      notifySuccess('Kart hazır ve haritaya eklendi.');
      return;
    }
    notify(wasEditing ? 'Kart özellikleri yeni sürüm olarak kaydedildi.' : 'Kart kataloğa eklendi.');
  });
  const editCatalogCard = (card: CatalogCard) => {
    setEditingCardId(card.id);
    setCardDraft({
      code: card.code,
      name: card.name,
      type: card.cardType,
      unit: card.unit,
      customTypeId: card.customTypeId ?? '',
      attributeValues: { ...(card.attributeValues ?? {}) },
      variantMode: card.variantMode ?? 'None',
      variants: (card.variants ?? []).map((item) => ({ ...item, compatibleDiameters: item.compatibleDiameters ? [...item.compatibleDiameters] : item.compatibleDiameters })),
      notes: card.notes ?? '',
      materialType: card.materialType ?? '',
      wasteRatePct: String(card.wasteRatePct ?? 0),
      carried: {
        cardType: card.cardType,
        variantMode: card.variantMode ?? 'None',
        inputBehavior: card.inputBehavior,
        salesConversion: card.salesConversion,
        reportBehavior: card.reportBehavior,
        positionNumber: card.positionNumber ?? null,
        containerParameter: card.containerParameter ?? null,
      },
    });
    setAddNewCardToFlow(false);
    setView('catalog');
    window.setTimeout(() => document.querySelector('.catalog-create-card input[aria-label="Kart adı"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  };
  const cancelEditCatalogCard = () => {
    setEditingCardId(null);
    setCardDraft({ code: '', name: '', type: 'Material', unit: 'adet', customTypeId: '', attributeValues: {}, variantMode: 'None', variants: [], notes: '', materialType: '', wasteRatePct: '0' });
  };
  const addCardToFlow = (cardVersionId: string) => withBusy(async () => {
    if (!selectedRevisionId) throw new ApiError('Önce bir proje seçin.');
    const placement = await api.post<Placement>(`/revisions/${selectedRevisionId}/placements`, { cardVersionId, parentPlacementId: selectedPlacementId, displayNameOverride: null, procurementScope: null });
    setShowCardShelf(false); await loadRevision(selectedRevisionId); setSelectedPlacementId(placement.id); notifySuccess('Kart akışa eklendi.');
  });

  const deactivateCard = (card: CatalogCard) => withBusy(async () => {
    if (!window.confirm(`“${card.name}” kartı kütüphaneden kaldırılsın mı? Projelerdeki mevcut kullanımları korunur.`)) return;
    await api.post(`/catalog/cards/${card.id}/deactivate`);
    await loadCards();
    notifySuccess('Kart kütüphaneden kaldırıldı.');
  });
  const deletePlacement = () => withBusy(async () => {
    const placement = selectedPlacement;
    if (!placement || !selectedRevisionId) return;
    if (!window.confirm(`“${placement.displayName}” ve altındaki tüm kartlar silinsin mi?`)) return;
    await api.delete(`/placements/${placement.id}`);
    setSelectedPlacementId(null);
    setExpandedPlacementIds((current) => {
      const next = new Set(current);
      next.delete(placement.id);
      expandedPlacementIdsRef.current = next;
      return next;
    });
    await loadRevision(selectedRevisionId);
    notifySuccess('Seçili kart ve altındaki kartlar silindi.');
  });
  // Backend PUT/DELETE /measurements/{id} uçlarını zaten sunuyordu ama arayüz
  // hiçbirini çağırmıyordu: 12,4 yerine 124 yazan bir kullanıcının o satırı
  // düzeltmesinin veya silmesinin yolu yoktu; tek çare kartın tamamını silmekti.
  const updateMeasurementQuantity = (measurement: Measurement, inputQuantity: number) => withBusy(async () => {
    await api.put(`/measurements/${measurement.id}`, {
      revisionId: measurement.revisionId,
      placementId: measurement.placementId,
      inputQuantity,
      inputUnit: measurement.inputUnit,
      block: measurement.block ?? null,
      floor: measurement.floor ?? null,
      room: measurement.room ?? null,
      zone: measurement.zone ?? null,
      sheet: measurement.sheet ?? null,
      drawingRevision: measurement.drawingRevision ?? null,
      notes: measurement.notes ?? null,
      sourceKind: measurement.sourceKind,
      variant: measurement.variant ?? null,
      secondaryVariant: measurement.secondaryVariant ?? null,
    });
    await loadRevision(selectedRevisionId);
    notifySuccess('Metraj satırı güncellendi.');
  });
  const deleteMeasurement = (measurement: Measurement) => withBusy(async () => {
    await api.delete(`/measurements/${measurement.id}`);
    await loadRevision(selectedRevisionId);
    notifySuccess('Metraj satırı silindi.');
  });
  const savePlacementNotes = () => withBusy(async () => {
    if (!selectedPlacement || !selectedRevisionId) return;
    await api.put(`/placements/${selectedPlacement.id}`, {
      displayNameOverride: selectedPlacement.displayNameOverride ?? null,
      procurementScope: selectedPlacement.procurementScope ?? null,
      notes: placementNotesDraft.trim() || null,
    });
    await loadRevision(selectedRevisionId);
    notifySuccess('Bu karta özel not kaydedildi.');
  });
  const reparent = (connection: Connection) => withBusy(async () => {
    if (!canEdit || !connection.source || !connection.target || connection.source === connection.target) return;
    await api.put(`/placements/${connection.target}/parent`, { parentPlacementId: connection.source });
    await loadRevision(selectedRevisionId); notifySuccess('Bağlantı güncellendi.');
  });
  const addMeasurementRows = async (rows: Array<{ quantity: number; notes?: string | null; variant?: string | null; secondaryVariant?: string | null }>) => {
    let saved = false;
    await withBusy(async () => {
      const target = selectedPlacement?.isMeasurable && selectedPlacement.inputBehavior !== 'Derived' ? selectedPlacement : measurablePlacements[0];
      if (!target) throw new ApiError('Önce ölçülebilir bir malzeme kartı seçin.');
      if (!rows.length || rows.some((row) => !Number.isFinite(row.quantity) || row.quantity <= 0)) throw new ApiError('Miktarı sıfırdan büyük bir sayı olarak yazın.');
      await api.post(`/revisions/${selectedRevisionId}/measurements/batch`, rows.map((row) => ({
        placementId: target.id, inputQuantity: row.quantity, inputUnit: target.unit, block: measurementDraft.block || null,
        floor: measurementDraft.floor || null, room: measurementDraft.room || null, zone: null, sheet: measurementDraft.sheet || null,
        drawingRevision: null, notes: [row.notes, measurementDraft.notes].filter(Boolean).join(' · ') || null, sourceKind: 'USER', variant: row.variant ?? null, secondaryVariant: row.secondaryVariant ?? null,
      })));
      // Yalnızca miktar temizlenir. Blok/kat/mahal/pafta, kullanıcının o an
      // çalıştığı yeri tarif eder; art arda satır girerken her seferinde yeniden
      // yazdırmak hızlı giriş akışını kırıyordu.
      setMeasurementDraft((current) => ({ ...current, quantity: '' }));
      await loadRevision(selectedRevisionId);
      notifySuccess('Metraj satırı eklendi.');
      saved = true;
    });
    return saved;
  };
  const addMeasurement = () => {
    const values = measurementDraft.quantity.split(/[\n;]/).map((value) => Number(value.trim().replace(',', '.'))).filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) { fail(new ApiError('Miktarı sayı olarak yazın. Örneğin: 12,5')); return; }
    void addMeasurementRows(values.map((value) => ({ quantity: value })));
  };
  const clearViewportNudges = useCallback(() => {
    viewportNudgeTimers.current.forEach((timer) => window.clearTimeout(timer));
    viewportNudgeTimers.current = [];
  }, []);

  const nudgeNodeIntoView = useCallback((nodeId: string, delay = 24) => {
    const timer = window.setTimeout(() => {
      viewportNudgeTimers.current = viewportNudgeTimers.current.filter((item) => item !== timer);
      if (!flow) return;
      const nodeElement = [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
        .find((element) => element.dataset.id === nodeId);
      const cardElement = nodeElement?.querySelector<HTMLElement>('.flow-card') ?? nodeElement;
      const stageElement = nodeElement?.closest<HTMLElement>('.react-flow');
      if (!cardElement || !stageElement) return;

      const cardRect = cardElement.getBoundingClientRect();
      const stageRect = stageElement.getBoundingClientRect();
      const margin = 18;
      let deltaX = 0;
      let deltaY = 0;
      if (cardRect.left < stageRect.left + margin) deltaX = stageRect.left + margin - cardRect.left;
      else if (cardRect.right > stageRect.right - margin) deltaX = stageRect.right - margin - cardRect.right;
      if (cardRect.top < stageRect.top + margin) deltaY = stageRect.top + margin - cardRect.top;
      else if (cardRect.bottom > stageRect.bottom - margin) deltaY = stageRect.bottom - margin - cardRect.bottom;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return;

      const viewport = flow.getViewport();
      void flow.setViewport(
        { x: viewport.x + deltaX, y: viewport.y + deltaY, zoom: viewport.zoom },
        { duration: 210, ease: (progress) => 1 - Math.pow(1 - progress, 3) },
      );
    }, delay);
    viewportNudgeTimers.current.push(timer);
  }, [flow]);

  useEffect(() => () => clearViewportNudges(), [clearViewportNudges]);

  const selectNode = (_: React.MouseEvent, node: PlacementNode) => {
    clearViewportNudges();
    setSelectedPlacementId(node.id);
    nudgeNodeIntoView(node.id);
  };
  const expandNode = (_: React.MouseEvent, node: PlacementNode) => {
    clearViewportNudges();
    const next = new Set(expandedPlacementIdsRef.current);
    const willExpand = !next.has(node.id);
    if (willExpand) next.add(node.id); else next.delete(node.id);
    expandedPlacementIdsRef.current = next;
    setExpandedPlacementIds(next);
    setSelectedPlacementId(node.id);
    setNodes((current) => current.map((item) => ({ ...item, data: { ...item.data, expanded: next.has(item.id) } })));
    // Kart büyürken erken bir küçük düzeltme, geçiş bittiğinde de son sınır
    // kontrolü yapılır. Harita yalnız kırpılan miktar kadar kayar; zoom değişmez.
    nudgeNodeIntoView(node.id, willExpand ? 90 : 32);
    if (willExpand) nudgeNodeIntoView(node.id, 360);
  };
  // React Flow'un yerel değişiklikleri kalıcılaştırılmadığı için harita
  // "gerçek" değilmiş gibi davranıyordu: klavyeyle silinen kart yenilemede geri
  // geliyor, sürüklenen kart eski yerine sıçrıyordu.
  const handleNodesChange = (changes: NodeChange<PlacementNode>[]) => {
    for (const change of changes) {
      if (change.type === 'position' && change.position) {
        nodePositions.current.set(change.id, change.position);
      }
    }
    // Silme yalnızca açık "Seçili kartı ve altını sil" işlemiyle yapılır;
    // klavye kısayolu yanlışlıkla bütün bir dalı yok edebilirdi.
    const removals = changes.filter((change) => change.type === 'remove');
    if (removals.length > 0) {
      notify('Kartı silmek için sağdaki “Seçili kartı ve altını sil” düğmesini kullanın.');
    }
    const applicable = changes.filter((change) => change.type !== 'remove');
    if (applicable.length > 0) setNodes((current) => applyNodeChanges<PlacementNode>(applicable, current));
  };
  const handleEdgesChange = (changes: EdgeChange<Edge>[]) => {
    // Kenarlar üst–alt ilişkisini temsil eder; bağlantı yalnızca yeni bir
    // ebeveyne sürükleyerek değiştirilir.
    const applicable = changes.filter((change) => change.type !== 'remove');
    if (applicable.length > 0) setEdges((current) => applyEdgeChanges<Edge>(applicable, current));
  };
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const cardVersionId = event.dataTransfer.getData('application/metraj-card');
    if (cardVersionId && canEdit) void addCardToFlow(cardVersionId);
  };
  const startFirstCardForFlow = () => {
    setShowCardShelf(false);
    cancelEditCatalogCard();
    setAddNewCardToFlow(true);
    setView('catalog');
  };
  // Bir yerleşimin her varyantı (çap/çeşit) ayrı bir özet satırıdır. Tek satır
  // seçmek, varyantlı kartlarda kullanıcıya toplam diye ilk çapın rakamını
  // gösteriyordu; panel de kendi aritmetiğini yapıyordu. İkisi de backend'in
  // decimal sonuçlarından beslenir.
  const activeSummaries = summaries.filter((item) => item.placementId === selectedPlacementId);
  const scopedPlacementIds = useMemo(() => {
    if (!reportScopeId) return null;
    const ids = new Set<string>([reportScopeId]);
    let changed = true;
    while (changed) {
      changed = false;
      placements.forEach((placement) => {
        if (placement.parentPlacementId && ids.has(placement.parentPlacementId) && !ids.has(placement.id)) { ids.add(placement.id); changed = true; }
      });
    }
    return ids;
  }, [placements, reportScopeId]);
  const visibleSummaries = scopedPlacementIds ? summaries.filter((item) => scopedPlacementIds.has(item.placementId)) : summaries;
  const visibleMeasurements = scopedPlacementIds ? measurements.filter((item) => scopedPlacementIds.has(item.placementId)) : measurements;
  const nav: Array<[View, string, string]> = [['flow', 'Proje haritası', 'Kur, seç ve metraj gir'], ['catalog', 'Kütüphane', 'Kartlarını yönet'], ['settings', 'Ayarlar', 'Proje ve kurallar'], ['control', 'Metraj çıktısı', 'Kontrol et ve dışa aktar']];

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◇</span><span className="brand-name">metraj</span><button className="sidebar-toggle" onClick={() => setSidebarCollapsed((current) => !current)} aria-label={sidebarCollapsed ? 'Sol menüyü aç' : 'Sol menüyü daralt'} title={sidebarCollapsed ? 'Sol menüyü aç' : 'Sol menüyü daralt'}>{sidebarCollapsed ? '›' : '‹'}</button></div>
          <div className="project-picker"><span className="eyebrow">AÇIK PROJE</span><select value={selectedProjectId} onChange={(event) => selectProject(event.target.value)}><option value="">Proje seç</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button className="text-button" onClick={() => setShowProjectDialog(true)}>+ Yeni proje</button></div>
        <nav>{nav.map(([target, title, caption], index) => <button key={target} title={title} aria-label={`${title}: ${caption}`} className={`nav-item ${view === target ? 'active' : ''}`} onClick={() => setView(target)}><span className="nav-number">0{index + 1}</span><span><strong>{title}</strong><small>{caption}</small></span></button>)}</nav>
        <div className="sidebar-footer"><button onClick={importExample}>Örnek proje aç</button><p>Takıldın mı? Kartı seç, sonra tek parlak düğmeye bas.</p></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><span className="eyebrow">{selectedProject?.code ?? 'BAŞLAMAYA HAZIR'}</span><h1>{selectedProject?.name ?? 'İlk projeni oluşturalım'}</h1></div><div className="topbar-actions"><div className="revision-chip">{selectedRevision ? `${selectedRevision.code} · ${selectedRevision.status === 'Draft' ? 'Düzenlenebilir' : 'Onaylandı'}` : 'Proje seçilmedi'}</div>{selectedProject && <button className="quiet-action" onClick={() => setView('settings')}>⚙ Ayarlar</button>}</div></header>

        {!selectedProject ? <Welcome onCreate={() => setShowProjectDialog(true)} onExample={importExample} /> : <>
          {view === 'flow' && <section className="flow-page">
            <div className="page-intro"><div><span className="eyebrow">1. KARTLARI KUR</span><h2>Projenin haritası</h2><p>Kartı tutup sahneye bırak. Kartların yanındaki noktalardan sürükleyerek üst–alt ilişkisini değiştir.</p></div><div className="intro-actions"><button onClick={() => flow?.fitView({ padding: 0.24, duration: 360 })}>Haritayı sığdır</button><button className="primary" disabled={!canEdit} onClick={() => setShowCardShelf(true)}>+ Kart ekle</button></div></div>
            <div className="flow-layout">
              <div className="flow-stage" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
                <ReactFlow<PlacementNode, Edge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} onInit={setFlow} onNodeClick={selectNode} onNodeDoubleClick={expandNode} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onConnect={reparent} fitView fitViewOptions={{ padding: 0.24 }} nodesDraggable={canEdit} nodesConnectable={canEdit} elementsSelectable>
                  <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#31415d" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={(node) => TYPE_META[(node.data as Placement).cardType]?.color ?? '#9bacbf'} />
                </ReactFlow>
                {!placements.length && <div className="empty-flow"><span>✦</span><h3>Harita boş</h3><p>Sağdaki kartlıktan bir kartı bu alana bırak.</p></div>}
              </div>
              <Inspector key={selectedPlacement?.id ?? 'empty-inspector'} placement={selectedPlacement} placements={placements} summaries={activeSummaries} measurements={measurements.filter((item) => item.placementId === selectedPlacementId)} allMeasurements={measurements} canEdit={Boolean(canEdit)} busy={busy} draft={measurementDraft} onDraft={setMeasurementDraft} onSubmit={addMeasurement} onSubmitRows={addMeasurementRows} onToggleContext={() => setShowContext(!showContext)} showContext={showContext} placementNotes={placementNotesDraft} onPlacementNotes={setPlacementNotesDraft} onSavePlacementNotes={savePlacementNotes} onUpdateMeasurement={updateMeasurementQuantity} onDeleteMeasurement={deleteMeasurement} onAdd={() => setShowCardShelf(true)} onDelete={deletePlacement} onScope={() => { if (selectedPlacementId) { setReportScopeId(selectedPlacementId); setView('control'); } }} />
            </div>
          </section>}

          {view === 'catalog' && <CatalogPage
            addNewCardToFlow={addNewCardToFlow} editingCardId={editingCardId} cardDraft={cardDraft} typeDraft={typeDraft}
            cards={cards} catalogTypes={catalogTypes} catalogAttributes={catalogAttributes} busy={busy}
            showTypeDialog={showTypeDialog}
            onCardDraft={setCardDraft} onTypeDraft={setTypeDraft} onCreateCard={createCard}
            onEditCard={editCatalogCard} onCancelEdit={cancelEditCatalogCard}
            onCreateType={createCatalogType} onDeleteType={deleteCatalogType} onSeed={seedStarterCatalog}
            onAddCard={addCardToFlow} onDeactivateCard={deactivateCard}
            onOpenType={() => setShowTypeDialog(true)} onCloseType={() => setShowTypeDialog(false)}
            onClose={() => setShowTypeDialog(false)}
            onBackToFlow={() => { setAddNewCardToFlow(false); setView('flow'); }}
          />}

          {view === 'settings' && <section className="settings-page"><AdvancedControls
            inline revisions={revisions} selectedRevisionId={selectedRevisionId} canEdit={Boolean(canEdit)} busy={busy}
            rules={rules} results={calculationResults} responsibilities={responsibilities} backups={backups} integrity={integrity} wasteSettings={wasteSettings}
            wasteDraft={wasteDraft} placements={placements} selectedPlacementId={selectedPlacementId} calculationTargetId={calculationTargetId} calculationSourceId={calculationSourceId}
            ruleDraft={ruleDraft} dimensionDraft={dimensionDraft} partyDraft={partyDraft} assignmentDraft={assignmentDraft}
            onClose={() => setView('flow')} onSelectRevision={setSelectedRevisionId} onCreateDraft={createDraftRevision} onApproveRevision={approveRevision}
            onRuleDraft={setRuleDraft} onCreateRule={createRule} onCalculationTarget={setCalculationTargetId} onCalculationSource={setCalculationSourceId} onLinkCalculationSource={linkCalculationSource} onRunCalculation={runCalculation} onReviewCalculation={reviewCalculation} onOverrideCalculation={overrideCalculation}
            onDimensionDraft={setDimensionDraft} onPartyDraft={setPartyDraft} onAssignmentDraft={setAssignmentDraft} onCreateDimension={createDimension} onCreateParty={createParty} onAssign={assignResponsibility}
            onWasteDraft={setWasteDraft} onSaveWaste={saveWasteSetting} onEditWaste={editWasteSetting} onDeleteWaste={removeWasteSetting}
            onCreateBackup={createBackup} onCheckIntegrity={checkIntegrity} onRestoreBackup={restoreBackup}
          /></section>}

          {view === 'control' && <section className="control-page"><div className="page-intro"><div><span className="eyebrow">METRAJ ÇIKTISI</span><h2>{reportScopeId ? `${placements.find((item) => item.id === reportScopeId)?.displayName ?? 'Seçili kart'} ve altı` : 'Bütün proje'}</h2><p>Net, fireli ve satın alma miktarlarını kontrol et; sonra çıktını al.</p></div><div className="intro-actions">{reportScopeId && <button onClick={() => setReportScopeId(null)}>Bütün projeyi göster</button>}<a className="download" href={`/api/revisions/${selectedRevisionId}/report/excel${reportScopeId ? `?placementId=${reportScopeId}` : ''}`}>Excel al</a><a className="download" href={`/api/revisions/${selectedRevisionId}/report/word${reportScopeId ? `?placementId=${reportScopeId}` : ''}`}>Word al</a><a className="primary download" href={`/api/revisions/${selectedRevisionId}/report/pdf${reportScopeId ? `?placementId=${reportScopeId}` : ''}`}>PDF al</a></div></div><div className="stat-grid"><Stat label="Malzeme" value={String(visibleSummaries.length)} /><Stat label="Kaynak satırı" value={String(visibleMeasurements.length)} /><Stat label="Bekleyen hesap" value={String(report?.calculationChecks.filter((item) => item.status === 'PendingReview').length ?? 0)} /></div><SummaryTable summaries={visibleSummaries} measurements={visibleMeasurements} placements={placements} /></section>}
        </>}
      </section>

      {showCardShelf && <div className="modal-backdrop" onMouseDown={() => setShowCardShelf(false)}><div className="modal shelf-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowCardShelf(false)}>×</button><span className="eyebrow">KÜTÜPHANE</span><h2>{selectedPlacement ? `“${selectedPlacement.displayName}” altına ekle` : 'Haritaya kart ekle'}</h2><p>Bir kart seç veya ihtiyacın olan yeni kartı hemen oluştur.</p><button className="primary new-card-button" onClick={startFirstCardForFlow}>+ Yeni kart oluştur</button><CardShelf cards={cards} onAdd={addCardToFlow} onCreate={startFirstCardForFlow} /></div></div>}
      {showProjectDialog && <div className="modal-backdrop"><div className="modal"><button className="modal-close" onClick={() => setShowProjectDialog(false)}>×</button><span className="eyebrow">YENİ PROJE</span><h2>Projenin adını ver</h2><p>Sonra kartlarını haritaya sürükleyerek kurarsın.</p><label>Proje kodu<input autoFocus placeholder="Örn. P-001" value={projectDraft.code} onChange={(event) => setProjectDraft({ ...projectDraft, code: event.target.value })} /></label><label>Proje adı<input placeholder="Örn. Villa Temiz Su" value={projectDraft.name} onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })} /></label><button className="primary full" disabled={busy} onClick={createProject}>Projeyi oluştur →</button></div></div>}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

type CardDraftState = {
  code: string;
  name: string;
  type: CardType;
  unit: string;
  customTypeId: string;
  attributeValues: Record<string, string>;
  variantMode: CatalogVariantMode;
  variants: CatalogCardVariant[];
  notes: string;
  materialType: string;
  wasteRatePct: string;
  /**
   * Düzenleyicide GÖSTERİLMEYEN ama korunması gereken alanlar. Bunlar olmadan
   * bir kartın yalnızca adını değiştirmek, kartın giriş davranışını, paket
   * dönüşümünü, rapor davranışını ve poz numarasını sessizce varsayılana
   * döndürüyordu; kullanıcı neyi kaybettiğini göremiyordu.
   */
  carried?: CarriedCardFields;
};

type CarriedCardFields = {
  cardType: CardType;
  variantMode: CatalogVariantMode;
  inputBehavior: CatalogCard['inputBehavior'];
  salesConversion: CatalogCard['salesConversion'];
  reportBehavior: CatalogCard['reportBehavior'];
  positionNumber: string | null;
  containerParameter: number | null;
};

type TypeDraftState = {
  code: string;
  name: string;
  baseCardType: CardType;
  description: string;
  parentCardIds: string[];
  childCardIds: string[];
  attributeKeys: string[];
};

const STEEL_DIAMETERS: CatalogCardVariant[] = [
  ['DN15', 'DN15 / 1/2"'], ['DN20', 'DN20 / 3/4"'], ['DN25', 'DN25 / 1"'], ['DN32', 'DN32 / 1 1/4"'],
  ['DN40', 'DN40 / 1 1/2"'], ['DN50', 'DN50 / 2"'], ['DN65', 'DN65 / 2 1/2"'], ['DN80', 'DN80 / 3"'],
  ['DN100', 'DN100 / 4"'], ['DN125', 'DN125 / 5"'], ['DN150', 'DN150 / 6"'],
].map(([code, label]) => ({ code, label, standardLength: 6 }));
const PPRC_DIAMETERS: CatalogCardVariant[] = [
  ['DN16', 'DN16 / 1/2"'], ['DN20', 'DN20 / 1/2"'], ['DN25', 'DN25 / 3/4"'], ['DN32', 'DN32 / 1"'],
  ['DN40', 'DN40 / 1 1/4"'], ['DN50', 'DN50 / 1 1/2"'], ['DN63', 'DN63 / 2"'], ['DN75', 'DN75 / 2 1/2"'],
  ['DN90', 'DN90 / 3"'], ['DN110', 'DN110 / 4"'],
].map(([code, label]) => ({ code, label, standardLength: 4 }));
const FITTING_PRESETS: CatalogCardVariant[] = [
  ['ELBOW-90', '90° Dirsek'], ['ELBOW-45', '45° Dirsek'], ['TEE', 'Te'], ['REDUCER', 'Redüksiyon'],
  ['UNION', 'Rakor'], ['NIPPLE', 'Muşon'], ['VALVE', 'Vana'], ['FLANGE', 'Flanş'],
].map(([code, label]) => ({ code, label, compatibleDiameters: [] }));

function variantName(card: CatalogCardVariant) {
  return card.label || card.code;
}

function visibleCatalogCards(cards: CatalogCard[]) {
  const active = cards.filter((card) => card.isActive);
  const hasFamily = (code: string) => active.some((card) => card.variantMode !== 'None' && card.code === code);
  return active.filter((card) => {
    const code = card.code.toUpperCase();
    const legacyPprcPipe = (code.startsWith('STD-PPRC-DN') || code.startsWith('SYN-CW-PPR')) && hasFamily('STD-PIPE-PPRC');
    const legacySteelPipe = code.startsWith('STD-STEEL-DN') && hasFamily('STD-PIPE-STEEL');
    const legacyPprcFitting = ((code.startsWith('STD-PPRC-') && /ELBOW|TEE|RED-|UNION|VALVE/.test(code)) ||
      code.startsWith('SYN-CW-ELB') || code.startsWith('SYN-CW-TEE') || code.startsWith('SYN-CW-VAL')) && hasFamily('STD-FIT-PPRC');
    const legacySteelFitting = code.startsWith('STD-STEEL-') && /ELBOW|TEE|FLANGE|VALVE|DIRSEK|TE|VANA/.test(`${code} ${card.name.toUpperCase()}`) && hasFamily('STD-FIT-STEEL');
    return !(legacyPprcPipe || legacySteelPipe || legacyPprcFitting || legacySteelFitting);
  });
}

function CatalogPage(props: {
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
    ? props.catalogAttributes.filter((attribute) => selectedType.attributeKeys.some((key) => key.toLowerCase() === attribute.key.toLowerCase()))
    : [];
  const separatelyRenderedAttributes = new Set(['Code', 'Name', 'Unit', 'Notes', 'MaterialType', 'WasteRatePct']);
  const updateAttribute = (key: string, value: string) => props.onCardDraft({
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
    props.onTypeDraft({ ...props.typeDraft, [field]: values.includes(id) ? values.filter((item) => item !== id) : [...values, id] });
  };
  const toggleAttribute = (attribute: CatalogCardAttributeDescriptor) => {
    if (attribute.isRequired) return;
    const values = props.typeDraft.attributeKeys;
    props.onTypeDraft({ ...props.typeDraft, attributeKeys: values.includes(attribute.key) ? values.filter((key) => key !== attribute.key) : [...values, attribute.key] });
  };
  const renderAttribute = (attribute: CatalogCardAttributeDescriptor) => {
    const value = props.cardDraft.attributeValues[attribute.key] ?? '';
    if (attribute.key === 'Notes') {
      return <label key={attribute.key} className="dynamic-attribute wide">{attribute.label}<textarea rows={2} value={value} placeholder={attribute.description} onChange={(event) => updateAttribute(attribute.key, event.target.value)} /></label>;
    }
    if (attribute.key === 'ItemKind' || attribute.key === 'InputBehavior' || attribute.key === 'SalesConversion' || attribute.key === 'ReportBehavior') {
      const options: Record<string, string[]> = {
        ItemKind: ['Material', 'Equipment', 'Labor', 'Service', 'Other'],
        InputBehavior: ['Manual', 'Boolean', 'Derived'],
        SalesConversion: ['None', 'StandardLength', 'Package'],
        ReportBehavior: ['Folder', 'Measurable', 'Auxiliary', 'Reference'],
      };
      return <label key={attribute.key} className="dynamic-attribute">{attribute.label}<select value={value} onChange={(event) => updateAttribute(attribute.key, event.target.value)}><option value="">Varsayılanı kullan</option>{options[attribute.key].map((option) => <option key={option}>{option}</option>)}</select></label>;
    }
    return <label key={attribute.key} className={`dynamic-attribute ${attribute.key === 'CompatibleDiameters' ? 'wide' : ''}`}>{attribute.label}<input inputMode={attribute.key === 'WasteRatePct' || attribute.key === 'ContainerParameter' ? 'decimal' : undefined} value={value} placeholder={attribute.description} onChange={(event) => updateAttribute(attribute.key, event.target.value)} /></label>;
  };
  const updateVariant = (index: number, patch: Partial<CatalogCardVariant>) => props.onCardDraft({
    ...props.cardDraft,
    variants: props.cardDraft.variants.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
  });
  const addVariant = () => props.onCardDraft({
    ...props.cardDraft,
    variants: [...props.cardDraft.variants, props.cardDraft.variantMode === 'Pipe'
      ? { code: `DN-${props.cardDraft.variants.length + 1}`, label: 'Yeni çap', standardLength: 6 }
      : { code: `FITTING-${props.cardDraft.variants.length + 1}`, label: 'Yeni fitting', compatibleDiameters: [] }],
  });
  const removeVariant = (index: number) => props.onCardDraft({ ...props.cardDraft, variants: props.cardDraft.variants.filter((_, itemIndex) => itemIndex !== index) });
  const applyDiameterPreset = (preset: 'steel' | 'pprc') => props.onCardDraft({
    ...props.cardDraft,
    variantMode: 'Pipe',
    unit: 'm',
    variants: (preset === 'steel' ? STEEL_DIAMETERS : PPRC_DIAMETERS).map((item) => ({ ...item })),
  });
  const applyFittingPreset = () => props.onCardDraft({
    ...props.cardDraft,
    variantMode: 'Fitting',
    unit: 'adet',
    variants: FITTING_PRESETS.map((item) => ({ ...item })),
  });
  const setVariantMode = (mode: CatalogVariantMode) => props.onCardDraft({
    ...props.cardDraft,
    variantMode: mode,
    unit: mode === 'Pipe' ? 'm' : mode === 'Fitting' ? 'adet' : props.cardDraft.unit,
    variants: mode === 'None' ? [] : props.cardDraft.variants,
  });

  return <section className="catalog-page">
    <div className="page-intro"><div><span className="eyebrow">KÜTÜPHANE · GLOBAL</span><h2>{props.addNewCardToFlow ? 'Yeni yapı taşı' : 'Kart kütüphanesi'}</h2><p>Bu, projelerden bağımsız tek yerel kütüphanedir. Kartı bir kez tanımla; bütün projelerin haritasında tekrar kullan. Tür şablonları da burada global tutulur.</p></div><div className="intro-actions">{!props.addNewCardToFlow && <><button onClick={props.onSeed}>Eksik standartları tamamla</button><button className="primary" onClick={props.onOpenType}>+ Yeni tür</button></>}{props.addNewCardToFlow && <button onClick={props.onBackToFlow}>Haritaya dön</button>}</div></div>
    <div className="create-card catalog-create-card">
      <div><span className="card-star">✦</span><h3>Yeni kart</h3><p>{selectedType ? `“${selectedType.name}” türünün seçili alanlarını doldur.` : 'Yalnızca adını, türünü ve birimini seç.'}</p></div>
      <label>{props.editingCardId ? 'Katalog kodu (sabit)' : 'Katalog kodu'}<input disabled={Boolean(props.editingCardId)} placeholder={props.editingCardId ? 'Kart kimliği sürümler arasında korunur' : 'Boş bırakırsan otomatik'} value={props.cardDraft.code} onChange={(event) => props.onCardDraft({ ...props.cardDraft, code: event.target.value })} /></label>
      <label>Ad<input aria-label="Kart adı" autoFocus placeholder="Örn. Siyah boru" value={props.cardDraft.name} onChange={(event) => props.onCardDraft({ ...props.cardDraft, name: event.target.value })} /></label>
      <label>Temel tür<select value={props.cardDraft.type} onChange={(event) => props.onCardDraft({ ...props.cardDraft, type: event.target.value as CardType, customTypeId: '', attributeValues: {} })}>{Object.entries(TYPE_META).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
      <label>Birim<input placeholder="m veya adet" value={props.cardDraft.unit} onChange={(event) => props.onCardDraft({ ...props.cardDraft, unit: event.target.value })} /></label>
      <label>Özel tür<select value={props.cardDraft.customTypeId} onChange={(event) => selectCustomType(event.target.value)}><option value="">Standart tür</option>{activeTypes.map((type) => <option key={type.id} value={type.id}>{type.name} · {TYPE_META[type.baseCardType].label}</option>)}</select></label>
      <label>Varyant davranışı<select value={props.cardDraft.variantMode} onChange={(event) => setVariantMode(event.target.value as CatalogVariantMode)}><option value="None">Standart kart</option><option value="Pipe">Boru · çap ve ticari boy</option><option value="Fitting">Fitting · çap ve çeşit</option></select></label>
      <label>Malzeme ailesi<input placeholder="Örn. Galvaniz Çelik Boru" value={props.cardDraft.materialType} onChange={(event) => props.onCardDraft({ ...props.cardDraft, materialType: event.target.value })} /></label>
      <label>Kart varsayılan fire payı (%)<input inputMode="decimal" placeholder="0" value={props.cardDraft.wasteRatePct} onChange={(event) => props.onCardDraft({ ...props.cardDraft, wasteRatePct: event.target.value })} /></label>
      <label className="catalog-note-field">Not<textarea rows={1} placeholder="Kartla ilgili kısa not" value={props.cardDraft.notes} onChange={(event) => props.onCardDraft({ ...props.cardDraft, notes: event.target.value })} /></label>
      {props.cardDraft.variantMode === 'Pipe' && <div className="variant-editor wide">
        <div className="variant-editor-heading"><div><strong>Boru çapları ve ticari boylar</strong><small>Her satır haritada seçilebilir bir çap kutusu oluşturur; metre, boy uzunluğuna bölünüp yukarı yuvarlanır.</small></div><div className="inline-actions"><button type="button" onClick={() => applyDiameterPreset('steel')}>Çelik / galvaniz standardı</button><button type="button" onClick={() => applyDiameterPreset('pprc')}>PPR / PPR-C standardı</button><button type="button" onClick={addVariant}>+ Özel çap</button></div></div>
        <div className="variant-editor-list">{props.cardDraft.variants.map((item, index) => <div className="variant-editor-row" key={`${item.code}-${index}`}><input aria-label="Çap kodu" value={item.code} placeholder="DN25" onChange={(event) => updateVariant(index, { code: event.target.value })} /><input aria-label="Çap etiketi" value={item.label} placeholder={'DN25 / 1"'} onChange={(event) => updateVariant(index, { label: event.target.value })} /><label className="variant-length">Boy (m)<input inputMode="decimal" value={item.standardLength ?? ''} onChange={(event) => updateVariant(index, { standardLength: Number(event.target.value.replace(',', '.')) || null })} /></label><button type="button" className="danger-link" onClick={() => removeVariant(index)}>Sil</button></div>)}</div>
      </div>}
      {props.cardDraft.variantMode === 'Fitting' && <div className="variant-editor wide">
        <div className="variant-editor-heading"><div><strong>Fitting çeşitleri ve uyumlu çaplar</strong><small>Uyumlu çapları virgülle yaz: DN25, DN32. Boş bırakırsan seçili boru çapında gösterilir.</small></div><div className="inline-actions"><button type="button" onClick={applyFittingPreset}>Yaygın fittingleri ekle</button><button type="button" onClick={addVariant}>+ Özel fitting</button></div></div>
        <div className="variant-editor-list">{props.cardDraft.variants.map((item, index) => <div className="variant-editor-row fitting-editor-row" key={`${item.code}-${index}`}><input aria-label="Fitting kodu" value={item.code} placeholder="ELBOW-90" onChange={(event) => updateVariant(index, { code: event.target.value })} /><input aria-label="Fitting adı" value={item.label} placeholder="90° Dirsek" onChange={(event) => updateVariant(index, { label: event.target.value })} /><input className="compat-input" aria-label="Uyumlu çaplar" value={(item.compatibleDiameters ?? []).join(', ')} placeholder="DN25, DN32" onChange={(event) => updateVariant(index, { compatibleDiameters: event.target.value.split(',').map((value) => value.trim()).filter(Boolean) })} /><button type="button" className="danger-link" onClick={() => removeVariant(index)}>Sil</button></div>)}</div>
      </div>}
      <div className="catalog-form-actions"><button className="primary" disabled={props.busy} onClick={props.onCreateCard}>{props.addNewCardToFlow ? 'Kaydet ve altına ekle' : props.editingCardId ? 'Kartı güncelle' : 'Kartı kaydet'}</button>{props.editingCardId && <button type="button" disabled={props.busy} onClick={props.onCancelEdit}>Düzenlemeyi iptal et</button>}</div>
      {selectedType && enabledAttributes.filter((attribute) => !separatelyRenderedAttributes.has(attribute.key)).length > 0 && <div className="dynamic-attributes"><div className="dynamic-attributes-heading"><strong>Bu türün ek bilgileri</strong><small>İşaretlediğin alanlar kartla birlikte saklanır.</small></div>{enabledAttributes.filter((attribute) => !separatelyRenderedAttributes.has(attribute.key)).map(renderAttribute)}</div>}
    </div>
    {activeTypes.length > 0 && <section className="catalog-types"><div className="summary-heading"><div><span className="eyebrow">TÜR ŞABLONLARI</span><h3>Özel kart türleri</h3></div><span>{activeTypes.length} global tür</span></div><div className="catalog-type-list">{activeTypes.map((type) => <article key={type.id} className="catalog-type-row"><div><strong>{type.name}</strong><small>{type.code} · temel tür: {TYPE_META[type.baseCardType].label}</small><p>{type.attributeKeys.length} bilgi alanı · {type.allowedParentCardIds.length ? `${type.allowedParentCardIds.length} üst kart kısıtı` : 'üst kart kısıtı yok'} · {type.allowedChildCardIds.length ? `${type.allowedChildCardIds.length} alt kart kısıtı` : 'alt kart kısıtı yok'}</p></div><button className="danger-link" disabled={props.busy} onClick={() => props.onDeleteType(type)}>Kaldır</button></article>)}</div></section>}
    <CardShelf cards={props.cards} compact onAdd={props.onAddCard} onDelete={props.onDeactivateCard} onEdit={props.onEditCard} />
    {props.showTypeDialog && <div className="modal-backdrop" onMouseDown={props.onCloseType}><div className="modal type-editor-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={props.onCloseType}>×</button><span className="eyebrow">GLOBAL KÜTÜPHANE</span><h2>Yeni kart türü oluştur</h2><p>Bir tür, aynı bilgileri taşıyan kartlar için şablondur. Üst/alt kart seçimleri ek ağaç kısıtı getirir; boş bırakırsan temel beşli kural çalışır.</p><div className="type-editor-grid"><label>Kısa kod<input autoFocus placeholder="Örn. RADYATOR" value={props.typeDraft.code} onChange={(event) => props.onTypeDraft({ ...props.typeDraft, code: event.target.value })} /></label><label>Tür adı<input placeholder="Örn. Panel radyatör" value={props.typeDraft.name} onChange={(event) => props.onTypeDraft({ ...props.typeDraft, name: event.target.value })} /></label><label>Temel kart davranışı<select value={props.typeDraft.baseCardType} onChange={(event) => props.onTypeDraft({ ...props.typeDraft, baseCardType: event.target.value as CardType })}>{Object.entries(TYPE_META).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label><label className="wide">Açıklama<input placeholder="Bu tür neyi temsil eder?" value={props.typeDraft.description} onChange={(event) => props.onTypeDraft({ ...props.typeDraft, description: event.target.value })} /></label></div><div className="type-editor-columns"><fieldset><legend>İzin verilen üst kartlar</legend><small>Bu tür kartın altına bağlanabileceği global kartlar. Boş liste: kısıt yok.</small>{activeCards.length ? <div className="check-list">{activeCards.map((card) => <label key={card.id}><input type="checkbox" checked={props.typeDraft.parentCardIds.includes(card.id)} onChange={() => toggleTypeList('parentCardIds', card.id)} />{card.name}<small>{card.code}</small></label>)}</div> : <p className="muted">Önce kütüphaneye kart ekleyin.</p>}</fieldset><fieldset><legend>İzin verilen alt kartlar</legend><small>Bu tür kartın altında bulunabilecek global kartlar. Boş liste: kısıt yok.</small>{activeCards.length ? <div className="check-list">{activeCards.map((card) => <label key={card.id}><input type="checkbox" checked={props.typeDraft.childCardIds.includes(card.id)} onChange={() => toggleTypeList('childCardIds', card.id)} />{card.name}<small>{card.code}</small></label>)}</div> : <p className="muted">Önce kütüphaneye kart ekleyin.</p>}</fieldset></div><fieldset className="attribute-fieldset"><legend>Kartta istenecek bilgiler</legend><small>Kod, ad ve birim motorun zorunlu alanlarıdır; diğerlerini ihtiyacına göre işaretle.</small><div className="attribute-check-list">{props.catalogAttributes.map((attribute) => <label key={attribute.key}><input type="checkbox" checked={attribute.isRequired || props.typeDraft.attributeKeys.includes(attribute.key)} disabled={attribute.isRequired} onChange={() => toggleAttribute(attribute)} /><span><strong>{attribute.label}{attribute.isRequired ? ' · zorunlu' : ''}</strong><small>{attribute.description}</small></span></label>)}</div></fieldset><div className="inline-actions"><button onClick={props.onClose}>Vazgeç</button><button className="primary" disabled={props.busy} onClick={props.onCreateType}>Türü kaydet</button></div></div></div>}
  </section>;
}

function Welcome({ onCreate, onExample }: { onCreate: () => void; onExample: () => void }) {
  return <section className="welcome"><span className="welcome-mark">◇</span><span className="eyebrow">BAŞLAYALIM</span><h2>Metrajı kartlarla kur.</h2><p>Önce proje oluştur. Sonra malzemeleri sürükleyip bağla. En sonunda miktarları yaz.</p><div><button className="primary welcome-action" onClick={onCreate}>Yeni proje oluştur →</button><button onClick={onExample}>Örnekle dene</button></div><ol><li><b>1</b> Projeyi aç</li><li><b>2</b> Kartları bağla</li><li><b>3</b> Miktarı yaz</li><li><b>4</b> Raporu al</li></ol></section>;
}

type MeasurementDraft = { quantity: string; block: string; floor: string; room: string; sheet: string; notes: string };

function Inspector({ placement, placements, summaries, measurements, allMeasurements, canEdit, busy, draft, onDraft, onSubmit, onSubmitRows, onToggleContext, showContext, placementNotes, onPlacementNotes, onSavePlacementNotes, onUpdateMeasurement, onDeleteMeasurement, onAdd, onDelete, onScope }: {
  placement: Placement | null; placements: Placement[]; summaries: MeasurementSummary[]; measurements: Measurement[]; allMeasurements: Measurement[]; canEdit: boolean; busy: boolean;
  draft: MeasurementDraft; onDraft: (value: MeasurementDraft) => void; onSubmit: () => void;
  onSubmitRows: (rows: Array<{ quantity: number; notes?: string | null; variant?: string | null; secondaryVariant?: string | null }>) => Promise<boolean>;
  onToggleContext: () => void; showContext: boolean; placementNotes: string; onPlacementNotes: (value: string) => void; onSavePlacementNotes: () => void;
  onUpdateMeasurement: (measurement: Measurement, inputQuantity: number) => Promise<void>;
  onDeleteMeasurement: (measurement: Measurement) => Promise<void>;
  onAdd: () => void; onDelete: () => void; onScope: () => void;
}) {
  type PipeBox = { id: string; diameter: string; pending: string };
  type FittingBox = { id: string; diameter: string; countsByDiameter: Record<string, Record<string, number>> };
  const [diameter, setDiameter] = useState('DN25');
  const [radiatorType, setRadiatorType] = useState('Panel');
  const [radiatorHeight, setRadiatorHeight] = useState('600');
  const [radiatorWidth, setRadiatorWidth] = useState('');
  const [fittingCounts, setFittingCounts] = useState<Record<string, number>>({ Dirsek: 0, Muşon: 0, Te: 0, Vana: 0 });
  const [pipeBoxes, setPipeBoxes] = useState<PipeBox[]>([]);
  const [fittingBoxes, setFittingBoxes] = useState<FittingBox[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // Satır içi düzenleme/silme onayı. window.prompt / window.confirm yerine
  // arayüzün kendi kontrolleri kullanılır: kopyalanabilir, tema uyumlu ve
  // uygulamayı bloklamaz.
  const [editingMeasurementId, setEditingMeasurementId] = useState<string | null>(null);
  const [editingQuantity, setEditingQuantity] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const pipeHydratedPlacementId = useRef<string | null>(null);
  const fittingHydratedPlacementId = useRef<string | null>(null);

  // Bu efekt, seçili kart değiştiği anda eski kartın kutularını yeni kartın
  // anahtarına yazmayı önler. Yapısal değişiklikler bir sonraki render'da
  // yerleşim kimliği altında kalıcılaştırılır.
  useEffect(() => {
    if (!placement || placement.variantMode !== 'Pipe' || pipeHydratedPlacementId.current !== placement.id || !pipeBoxes.length) return;
    window.localStorage.setItem(`metraj.pipe-boxes.v1.${placement.id}`, JSON.stringify(pipeBoxes.map(({ id, diameter }) => ({ id, diameter }))));
  }, [placement?.id, placement?.variantMode, pipeBoxes]);

  useEffect(() => {
    if (!placement || placement.variantMode !== 'Fitting' || fittingHydratedPlacementId.current !== placement.id || !fittingBoxes.length) return;
    window.localStorage.setItem(`metraj.fitting-draft.v1.${placement.id}`, JSON.stringify(fittingBoxes));
  }, [placement?.id, placement?.variantMode, fittingBoxes]);

  useEffect(() => {
    if (!placement) return;
    let ancestor = placements.find((item) => item.id === placement.parentPlacementId);
    let guard = 0;
    while (ancestor && guard++ < 24 && ancestor.variantMode !== 'Pipe') ancestor = placements.find((item) => item.id === ancestor?.parentPlacementId);
    const enteredParent = ancestor ? allMeasurements.filter((item) => item.placementId === ancestor?.id) : [];
    const preferredParentDiameter = ancestor?.variants?.find((variant) => enteredParent.some((measurement) => {
      const value = (measurement.variant || measurement.notes?.match(/(?:Çap|Boyut):\s*([^·]+)/i)?.[1]?.trim() || '').trim().toLowerCase();
      return value === variant.code.toLowerCase() || value === variant.label.toLowerCase();
    }))?.code;
    const first = placement.variantMode === 'Fitting'
      ? preferredParentDiameter ?? ancestor?.variants?.[0]?.code ?? 'DN25'
      : placement.variants?.[0]?.code ?? 'DN25';
    let savedPipeBoxes: Array<{ id?: string; diameter?: string }> = [];
    let savedFittingBoxes: Array<{ id?: string; diameter?: string; counts?: unknown; countsByDiameter?: unknown }> = [];
    if (placement.variantMode === 'Pipe') {
      try {
        const raw = window.localStorage.getItem(`metraj.pipe-boxes.v1.${placement.id}`);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          savedPipeBoxes = parsed.filter((item): item is { id?: string; diameter?: string } => Boolean(item && typeof item === 'object' && typeof (item as { diameter?: unknown }).diameter === 'string'));
        }
      } catch {
        savedPipeBoxes = [];
      }
    }
    if (placement.variantMode === 'Fitting') {
      try {
        const raw = window.localStorage.getItem(`metraj.fitting-draft.v1.${placement.id}`);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          savedFittingBoxes = parsed.filter((item): item is { id?: string; diameter?: string; counts?: unknown; countsByDiameter?: unknown } => Boolean(item && typeof item === 'object'));
        }
      } catch {
        savedFittingBoxes = [];
      }
    }
    const validDiameters = placement.variants?.length ? new Set(placement.variants.map((item) => item.code.toLowerCase())) : null;
    const normalizedPipeBoxes = savedPipeBoxes.reduce<Array<{ id: string; diameter: string }>>((items, item, index) => {
      const diameter = item.diameter?.trim();
      if (!diameter || (validDiameters && !validDiameters.has(diameter.toLowerCase())) || items.some((current) => current.diameter.toLowerCase() === diameter.toLowerCase())) return items;
      items.push({ id: item.id || `${placement.id}-pipe-${index}`, diameter });
      return items;
    }, []);
    if (placement.variantMode === 'Pipe' && !normalizedPipeBoxes.length) normalizedPipeBoxes.push({ id: `${placement.id}-pipe-0`, diameter: first });
    const validFittingDiameters = ancestor?.variants?.length ? new Set(ancestor.variants.map((item) => item.code.toLowerCase())) : null;
    const normalizeCounts = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as Record<string, number>;
      return Object.entries(value as Record<string, unknown>).reduce<Record<string, number>>((result, [kind, count]) => {
        if (typeof count === 'number' && Number.isFinite(count) && count > 0) result[kind] = Math.floor(count);
        return result;
      }, {});
    };
    const normalizedFittingBoxes = savedFittingBoxes.reduce<FittingBox[]>((items, item, index) => {
      const diameter = item.diameter?.trim() || first;
      if (validFittingDiameters && !validFittingDiameters.has(diameter.toLowerCase())) return items;
      const rawByDiameter = item.countsByDiameter && typeof item.countsByDiameter === 'object' && !Array.isArray(item.countsByDiameter)
        ? item.countsByDiameter as Record<string, unknown>
        : item.counts && typeof item.counts === 'object'
          ? { [diameter]: item.counts }
          : {};
      const countsByDiameter = Object.entries(rawByDiameter).reduce<Record<string, Record<string, number>>>((result, [savedDiameter, counts]) => {
        if (!validFittingDiameters || validFittingDiameters.has(savedDiameter.toLowerCase())) result[savedDiameter] = normalizeCounts(counts);
        return result;
      }, {});
      items.push({ id: item.id || `${placement.id}-fit-${index}`, diameter, countsByDiameter });
      return items;
    }, []);
    if (placement.variantMode === 'Fitting' && !normalizedFittingBoxes.length) normalizedFittingBoxes.push({ id: `${placement.id}-fit-0`, diameter: first, countsByDiameter: {} });
    pipeHydratedPlacementId.current = placement.variantMode === 'Pipe' ? placement.id : null;
    fittingHydratedPlacementId.current = placement.variantMode === 'Fitting' ? placement.id : null;
    setPipeBoxes((placement.variantMode === 'Pipe' ? normalizedPipeBoxes : [{ id: `${placement.id}-pipe-0`, diameter: first }]).map((item) => ({ ...item, pending: '' })));
    setFittingBoxes(placement.variantMode === 'Fitting' ? normalizedFittingBoxes : [{ id: `${placement.id}-fit-0`, diameter: first, countsByDiameter: {} }]);
    setDiameter(first);
    setFittingCounts({ Dirsek: 0, Muşon: 0, Te: 0, Vana: 0 });
  }, [placement?.id, placement?.variantMode, placement?.parentPlacementId, placement?.variants]);
  useEffect(() => {
    setShowHistory(false);
    setEditingMeasurementId(null);
    setConfirmingDeleteId(null);
  }, [placement?.id]);
  if (!placement) return <aside className="inspector empty-inspector"><span>←</span><h3>Bir kart seç</h3><p>Kartın ne yaptığını ve sonraki en kolay adımı burada göstereceğim.</p></aside>;
  const meta = TYPE_META[placement.cardType];
  // Yerleşimin toplamı, varyantların TAMAMINDAN gelir. Tek satır göstermek,
  // dört çap girilmiş bir boru kartında "Şu ana kadar" başlığı altında yalnızca
  // ilk çapın rakamını toplam gibi sunuyordu.
  const placementTotals = summaries.length
    ? {
      net: summaries.reduce((sum, item) => sum + item.netQuantity, 0),
      purchase: summaries.reduce((sum, item) => sum + item.purchaseQuantity, 0),
      unit: summaries[0].unit,
      purchaseUnit: purchaseUnit(summaries[0]),
      variantCount: summaries.length,
    }
    : null;
  const summaryForVariant = (code: string, label?: string) => summaries.find((item) => {
    const variant = (item.variant ?? '').toLowerCase();
    return variant === code.toLowerCase() || (label !== undefined && variant === label.toLowerCase());
  });
  const isRadiator = /radyat[öo]r/i.test(placement.displayName);
  const isPipe = placement.variantMode === 'Pipe';
  const isFitting = placement.variantMode === 'Fitting';
  const isCount = !isFitting && (placement.cardType === 'Accessory' || /adet/i.test(placement.unit));
  const knownDiameters = [...new Set(measurements.map((item) => item.variant || item.notes?.match(/(?:Çap|Boyut):\s*([^·]+)/i)?.[1]?.trim()).filter(Boolean) as string[])];
  const fallbackDiameters: CatalogCardVariant[] = knownDiameters.length ? knownDiameters.map((item) => ({ code: item, label: item })) : STEEL_DIAMETERS;
  const variantDiameters = placement.variants?.length ? placement.variants : fallbackDiameters;
  const findAncestor = (mode: CatalogVariantMode) => {
    let current = placements.find((item) => item.id === placement.parentPlacementId);
    let guard = 0;
    while (current && guard++ < 24) {
      if (current.variantMode === mode) return current;
      current = placements.find((item) => item.id === current?.parentPlacementId);
    }
    return undefined;
  };
  const parentPipe = isFitting ? findAncestor('Pipe') : undefined;
  const parentDiameterMeasurements = parentPipe ? allMeasurements.filter((item) => item.placementId === parentPipe.id && (item.variant || item.notes?.match(/(?:Çap|Boyut):\s*([^·]+)/i)?.[1]?.trim())) : [];
  const parentDiameterBase = parentPipe?.variants?.length ? parentPipe.variants : fallbackDiameters;
  const parentEnteredDiameters = parentPipe && parentDiameterMeasurements.length
    ? parentDiameterBase.filter((item) => parentDiameterMeasurements.some((measurement) => {
      const entered = (measurement.variant || measurement.notes?.match(/(?:Çap|Boyut):\s*([^·]+)/i)?.[1]?.trim() || '').trim().toLowerCase();
      return entered === item.code.toLowerCase() || entered === item.label.toLowerCase();
    }))
    : [];
  const parentDiameters = parentEnteredDiameters.length ? parentEnteredDiameters : parentDiameterBase;
  const parentDiameterFiltered = Boolean(parentPipe && parentEnteredDiameters.length && parentEnteredDiameters.length < parentDiameterBase.length);
  const fittingVariants = placement.variants?.length ? placement.variants : FITTING_PRESETS;
  const compatibleFittings = (diameterCode: string) => fittingVariants.filter((item) => {
    const compatible = item.compatibleDiameters ?? [];
    return compatible.length === 0 || compatible.some((itemDiameter) => itemDiameter.toLowerCase() === diameterCode.toLowerCase() || itemDiameter.toLowerCase() === variantDiameters.find((item) => item.code === diameterCode)?.label.toLowerCase());
  });
  // Girilen değer, kayıt BAŞARILI olmadan temizlenmez. Aksi hâlde bir doğrulama
  // veya yazma hatasında kutu boşalıyor, kısa bir toast geçiyor ve kullanıcının
  // sahadan okuyup yazdığı sayı hiçbir yerde kalmıyordu.
  const submitPipeBox = async (box: PipeBox) => {
    const parsed = Number(box.pending.replace(',', '.'));
    if (parsed <= 0 || !Number.isFinite(parsed)) return;
    const profile = variantDiameters.find((item) => item.code === box.diameter);
    const saved = await onSubmitRows([{ quantity: parsed, variant: box.diameter, notes: `Çap: ${profile?.label ?? box.diameter}` }]);
    if (!saved) return;
    // Kayıt sürerken kullanıcı yeni bir değer yazmış olabilir; onu ezme.
    setPipeBoxes((current) => current.map((item) => item.id === box.id && item.pending === box.pending ? { ...item, pending: '' } : item));
    onDraft({ ...draft, quantity: '' });
  };
  const submitRadiator = async () => {
    const width = Number(radiatorWidth.replace(',', '.'));
    if (!Number.isFinite(width) || width <= 0) return;
    const saved = await onSubmitRows([{
      quantity: 1,
      variant: `${radiatorType} · H${radiatorHeight}`,
      secondaryVariant: `W${width}`,
      notes: `Radyatör: ${radiatorType} · Yükseklik: ${radiatorHeight} · Genişlik: ${width}`,
    }]);
    if (saved) setRadiatorWidth('');
  };
  const hasPendingFittings = fittingBoxes.some((box) => Object.values(box.countsByDiameter).some((counts) => Object.values(counts).some((count) => count > 0)));
  const submitFittings = async () => {
    const totals = new Map<string, { diameter: string; kind: string; count: number }>();
    fittingBoxes.forEach((box) => Object.entries(box.countsByDiameter).forEach(([diameter, counts]) => {
      Object.entries(counts).filter(([, count]) => count > 0).forEach(([kind, count]) => {
        const key = `${diameter}\u0000${kind}`;
        const current = totals.get(key);
        totals.set(key, { diameter, kind, count: (current?.count ?? 0) + count });
      });
    }));
    const rows = [...totals.values()].map(({ diameter, kind, count }) => ({ quantity: count, variant: diameter, secondaryVariant: kind, notes: `${kind} · Çap: ${diameter}` }));
    if (!rows.length) return;
    const saved = await onSubmitRows(rows);
    if (saved) {
      setFittingBoxes((current) => current.map((box) => ({ ...box, countsByDiameter: {} })));
      window.localStorage.removeItem(`metraj.fitting-draft.v1.${placement.id}`);
    }
  };
  const updateFittingCount = (boxId: string, diameterCode: string, code: string, delta: number) => setFittingBoxes((current) => current.map((box) => {
    if (box.id !== boxId) return box;
    const diameterCounts = box.countsByDiameter[diameterCode] ?? {};
    return { ...box, countsByDiameter: { ...box.countsByDiameter, [diameterCode]: { ...diameterCounts, [code]: Math.max(0, (diameterCounts[code] ?? 0) + delta) } } };
  }));
  const setFittingCount = (boxId: string, diameterCode: string, code: string, value: string) => {
    const parsed = Number(value.replace(',', '.'));
    const normalized = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    setFittingBoxes((current) => current.map((box) => {
      if (box.id !== boxId) return box;
      const diameterCounts = box.countsByDiameter[diameterCode] ?? {};
      return { ...box, countsByDiameter: { ...box.countsByDiameter, [diameterCode]: { ...diameterCounts, [code]: normalized } } };
    }));
  };
  const submitSimpleCounts = async () => {
    const rows = Object.entries(fittingCounts)
      .filter(([, count]) => count > 0)
      .map(([kind, count]) => ({ quantity: count, variant: diameter, secondaryVariant: kind, notes: `${kind} · Çap: ${diameter}` }));
    if (!rows.length) return;
    const saved = await onSubmitRows(rows);
    // Sayaçlar yalnızca kayıt gerçekten başarılı olduğunda sıfırlanır.
    if (saved) setFittingCounts({ Dirsek: 0, Muşon: 0, Te: 0, Vana: 0 });
  };
  const setSimpleCount = (kind: string, value: string) => {
    const parsed = Number(value.replace(',', '.'));
    setFittingCounts((current) => ({ ...current, [kind]: Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0 }));
  };
  const addFittingBox = () => setFittingBoxes((current) => [...current, { id: `${placement.id}-fit-${Date.now()}`, diameter: parentDiameters[0]?.code ?? 'DN25', countsByDiameter: {} }]);
  const history = [...measurements].sort((a, b) => {
    const left = Date.parse(a.createdAtUtc);
    const right = Date.parse(b.createdAtUtc);
    return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0) || a.id.localeCompare(b.id);
  });
  return <aside className="inspector"><div className="inspector-head"><div><div className="inspector-kind" style={{ color: meta.color }}>{meta.icon} {meta.label}</div><h3>{placement.displayName}</h3></div><button className="scope-button" onClick={onScope}>Bu daldan metraj →</button></div><p className="muted">{placement.isMeasurable ? `${placement.unit} ile ölçülür` : 'Alt kartları düzenleyen başlık'}</p>
    <div className="placement-note-panel"><div className="placement-note-heading"><strong>Bu karta özel not</strong><small>Yalnızca bu proje yerleşiminde saklanır.</small></div><textarea rows={3} value={placementNotes} disabled={!canEdit || busy} placeholder="Örn. 120 kW, marka/model, pompa basıncı…" onChange={(event) => onPlacementNotes(event.target.value)} /><button className="full" disabled={!canEdit || busy} onClick={onSavePlacementNotes}>Notu kaydet</button></div>
    {placementTotals && <div className="quantity-card"><span>Şu ana kadar</span><strong>{quantity(placementTotals.net)} {placementTotals.unit}</strong><small>Satın alma: {quantity(placementTotals.purchase)} {placementTotals.purchaseUnit}{placementTotals.variantCount > 1 ? ` · ${placementTotals.variantCount} çap/çeşit toplamı` : ''}</small></div>}
    {placement.isMeasurable && <div className="history-panel"><button type="button" className="history-toggle" disabled={!history.length} aria-expanded={showHistory} onClick={() => setShowHistory((current) => !current)}><span aria-hidden="true">◷</span><span>Giriş geçmişi</span><b>{history.length}</b></button><div className={`panel-collapse history-collapse ${showHistory ? 'open' : ''}`} aria-hidden={!showHistory}><div className="panel-collapse-inner"><div className="history-list">{history.map((item, index) => {
              const isEditing = editingMeasurementId === item.id;
              const isConfirmingDelete = confirmingDeleteId === item.id;
              const commitEdit = async () => {
                const parsed = Number(editingQuantity.replace(',', '.'));
                if (!Number.isFinite(parsed) || parsed <= 0) return;
                await onUpdateMeasurement(item, parsed);
                setEditingMeasurementId(null);
              };
              return <article className={`history-row${isEditing || isConfirmingDelete ? ' history-row-active' : ''}`} key={item.id}>
                <div>
                  {isEditing
                    ? <label className="history-edit"><span className="sr-only">Miktar</span><input autoFocus inputMode="decimal" aria-label={`${index + 1}. satırın miktarı`} value={editingQuantity} onChange={(event) => setEditingQuantity(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !busy) { event.preventDefault(); void commitEdit(); } if (event.key === 'Escape') setEditingMeasurementId(null); }} /><b>{item.inputUnit}</b></label>
                    : <strong>{index + 1}. {quantity(item.inputQuantity)} {item.inputUnit}</strong>}
                  <small>{new Date(item.createdAtUtc).toLocaleString('tr-TR')}{item.updatedAtUtc ? ' · düzeltildi' : ''}</small>
                </div>
                {isConfirmingDelete
                  ? <div className="history-actions"><span className="history-confirm">Silinsin mi?</span><button type="button" className="danger-link" disabled={busy} onClick={() => { void onDeleteMeasurement(item).then(() => setConfirmingDeleteId(null)); }}>Evet, sil</button><button type="button" disabled={busy} onClick={() => setConfirmingDeleteId(null)}>Vazgeç</button></div>
                  : isEditing
                    ? <div className="history-actions"><button type="button" className="primary" disabled={busy} onClick={() => void commitEdit()}>Kaydet</button><button type="button" disabled={busy} onClick={() => setEditingMeasurementId(null)}>Vazgeç</button></div>
                    : <div className="history-actions"><span className="history-variant">{[item.variant, item.secondaryVariant].filter(Boolean).join(' · ') || measurementLabel(item.notes)}</span>{canEdit && <><button type="button" title="Miktarı düzelt" aria-label={`${index + 1}. satırın miktarını düzelt`} disabled={busy} onClick={() => { setConfirmingDeleteId(null); setEditingMeasurementId(item.id); setEditingQuantity(String(item.inputQuantity)); }}>Düzelt</button><button type="button" className="danger-link" title="Satırı sil" aria-label={`${index + 1}. satırı sil`} disabled={busy} onClick={() => { setEditingMeasurementId(null); setConfirmingDeleteId(item.id); }}>Sil</button></>}</div>}
              </article>;
            })}</div></div></div></div>}
    {placement.isMeasurable && placement.inputBehavior !== 'Derived' && isPipe && <div className="quick-measure variant-input-panel"><div className="variant-panel-heading"><div><strong>Boru çapları</strong><small>Bir çap kutusunu seç, metreyi yazıp Enter'a bas.</small></div><button type="button" onClick={() => setPipeBoxes((current) => [...current, { id: `${placement.id}-pipe-${Date.now()}`, diameter: variantDiameters[0]?.code ?? 'DN25', pending: '' }])}>+ Çap kutusu</button></div>{pipeBoxes.map((box) => { const profile = variantDiameters.find((item) => item.code === box.diameter); /* Toplam ve satin alma adedi backend'in decimal sonucundan okunur. Panelde JavaScript kayan noktasiyla yeniden hesaplamak, 40 adet 0,1 girisinde 4 m boy icin 1 yerine 2 boy gosteriyordu; ekran ile rapor celisiyordu. */ const variantSummary = summaryForVariant(box.diameter, profile?.label); const entered = variantSummary?.netQuantity ?? 0; const stockLength = profile?.standardLength ?? 0; const barsPurchase = (variantSummary?.purchaseUnit ?? '') === 'boy'; const bars = barsPurchase ? variantSummary?.purchaseQuantity ?? 0 : 0; return <div className="pipe-variant-box" key={box.id}><div className="variant-box-head"><label>Çap / boyut<select value={box.diameter} onChange={(event) => setPipeBoxes((current) => current.map((item) => item.id === box.id ? { ...item, diameter: event.target.value } : item))}>{variantDiameters.map((item) => <option key={item.code} value={item.code}>{variantName(item)}</option>)}</select></label>{pipeBoxes.length > 1 && <button type="button" className="danger-link" onClick={() => setPipeBoxes((current) => current.filter((item) => item.id !== box.id))}>Kaldır</button>}</div><label className="large-input-label">Metre yaz, Enter'a bas<input autoFocus={pipeBoxes[0]?.id === box.id} className="large-measure-input" inputMode="decimal" placeholder="0,00" value={box.pending} onChange={(event) => setPipeBoxes((current) => current.map((item) => item.id === box.id ? { ...item, pending: event.target.value } : item))} onKeyDown={(event) => { if (event.key === 'Enter' && !busy) { event.preventDefault(); void submitPipeBox(box); } }} /></label><div className="variant-box-summary"><span>Toplam <b>{quantity(entered)} {variantSummary?.unit ?? placement.unit}</b></span><span>{stockLength > 0 ? `${stockLength} m boy` : 'Boy girilmemiş'} · <b>{barsPurchase && bars > 0 ? `${quantity(bars)} boy` : '—'}</b></span></div></div>; })}<small>Her Enter ayrı kaynak satırı olarak kaydolur; aynı çapın toplamı ve satın alınacak boy otomatik hesaplanır.</small></div>}
    {placement.isMeasurable && placement.inputBehavior !== 'Derived' && isFitting && <div className="quick-measure variant-input-panel fitting-input-panel">
      <div className="variant-panel-heading"><div><strong>Fitting çap grupları</strong><small>Çaplar arasında geçiş yapabilirsin; gönderilmeyen adetler kaybolmaz.</small></div><button type="button" onClick={addFittingBox}>+ Çap kutusu</button></div>
      {parentDiameterFiltered && <div className="diameter-filter-note">Bağlı boruda ölçümü girilen çaplar gösteriliyor. <span>{parentDiameters.length} çap hazır</span></div>}
      {!parentDiameterFiltered && parentPipe && <div className="diameter-filter-note muted-filter">Bağlı boruda henüz ölçüm yok; kartta tanımlı tüm çaplar gösteriliyor.</div>}
      {fittingBoxes.map((box) => {
        const activeDiameter = parentDiameters.some((item) => item.code === box.diameter) ? box.diameter : parentDiameters[0]?.code ?? box.diameter;
        const activeCounts = box.countsByDiameter[activeDiameter] ?? {};
        return <div className="fitting-variant-box" key={box.id}>
          <div className="diameter-chip-row">{parentDiameters.map((item) => {
            const entered = parentDiameterMeasurements.some((measurement) => {
              const value = (measurement.variant || measurement.notes?.match(/(?:Çap|Boyut):\s*([^·]+)/i)?.[1]?.trim() || '').trim().toLowerCase();
              return value === item.code.toLowerCase() || value === item.label.toLowerCase();
            });
            const pending = Object.values(box.countsByDiameter[item.code] ?? {}).reduce((sum, count) => sum + count, 0);
            return <button type="button" key={item.code} className={`${activeDiameter === item.code ? 'selected ' : ''}${entered ? 'entered' : ''}${pending > 0 ? ' pending' : ''}`} onClick={() => setFittingBoxes((current) => current.map((entry) => entry.id === box.id ? { ...entry, diameter: item.code } : entry))}>{variantName(item)}{pending > 0 && <b>{pending}</b>}</button>;
          })}</div>
          <strong className="fitting-box-title">{variantName(parentDiameters.find((item) => item.code === activeDiameter) ?? { code: activeDiameter, label: activeDiameter })}</strong>
          <div className="counter-list">{compatibleFittings(activeDiameter).map((item) => <div className="counter-row" key={item.code}><strong>{variantName(item)}</strong><button type="button" onClick={() => updateFittingCount(box.id, activeDiameter, item.code, -1)}>−</button><input className="counter-input" type="number" min="0" step="1" inputMode="numeric" aria-label={`${variantName(item)} adedi`} value={activeCounts[item.code] ?? 0} onChange={(event) => setFittingCount(box.id, activeDiameter, item.code, event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitFittings(); } }} /><button type="button" onClick={() => updateFittingCount(box.id, activeDiameter, item.code, 1)}>+</button></div>)}</div>
        </div>;
      })}
      <button className="primary full" disabled={!canEdit || busy || !hasPendingFittings} onClick={() => void submitFittings()}>Hepsini ekle ↵</button>
      <small>Bekleyen adetler bu kart, diğer kartlar ve ekranlar arasında saklanır; yalnız başarıyla eklenince temizlenir.</small>
    </div>}
    {placement.isMeasurable && isRadiator && <div className="quick-measure"><div className="variant-grid"><label>Tür<select value={radiatorType} onChange={(event) => setRadiatorType(event.target.value)}><option>Panel</option><option>Döküm</option><option>Havlupan</option></select></label><label>Yükseklik<select value={radiatorHeight} onChange={(event) => setRadiatorHeight(event.target.value)}><option>300</option><option>400</option><option>500</option><option>600</option><option>900</option></select></label></div><label className="large-input-label">Genişlik yaz, Enter'a bas<input autoFocus className="large-measure-input" inputMode="decimal" value={radiatorWidth} onChange={(event) => setRadiatorWidth(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !busy) { event.preventDefault(); void submitRadiator(); } }} placeholder="1000" /></label><button className="primary full" disabled={!canEdit || busy} onClick={() => void submitRadiator()}>Radyatörü ekle</button></div>}
    {placement.isMeasurable && !isPipe && !isFitting && !isRadiator && !isCount && <div className="quick-measure"><label>Çap / boyut<select value={diameter} onChange={(event) => setDiameter(event.target.value)}>{fallbackDiameters.map((item) => <option key={item.code}>{item.code}</option>)}</select></label><label className="large-input-label">Metre yaz, Enter'a bas<input autoFocus className="large-measure-input" inputMode="decimal" placeholder="0,00" value={draft.quantity} onChange={(event) => onDraft({ ...draft, quantity: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); const parsed = Number(draft.quantity.replace(',', '.')); if (parsed > 0) onSubmitRows([{ quantity: parsed, variant: diameter, notes: `Çap: ${diameter}` }]); } }} /></label><button className="primary full" disabled={!canEdit || busy} onClick={() => { const parsed = Number(draft.quantity.replace(',', '.')); if (parsed > 0) onSubmitRows([{ quantity: parsed, variant: diameter, notes: `Çap: ${diameter}` }]); else onSubmit(); }}>Metreyi ekle</button><small>Her Enter ayrı bir ölçüm olarak kaydolur; toplam otomatik güncellenir.</small></div>}
    {placement.isMeasurable && isCount && <div className="quick-measure"><label>Çap / boyut<select value={diameter} onChange={(event) => setDiameter(event.target.value)}>{fallbackDiameters.map((item) => <option key={item.code}>{item.code}</option>)}</select></label><div className="counter-list">{Object.entries(fittingCounts).map(([kind, count]) => <div className="counter-row" key={kind}><strong>{kind}</strong><button type="button" onClick={() => setFittingCounts({ ...fittingCounts, [kind]: Math.max(0, count - 1) })}>−</button><input className="counter-input" type="number" min="0" step="1" inputMode="numeric" aria-label={`${kind} adedi`} value={count} onChange={(event) => setSimpleCount(kind, event.target.value)} /><button type="button" onClick={() => setFittingCounts({ ...fittingCounts, [kind]: count + 1 })}>+</button></div>)}</div><button className="primary full" disabled={!canEdit || busy || !Object.values(fittingCounts).some(Boolean)} onClick={() => void submitSimpleCounts()}>Hepsini ekle ↵</button></div>}
    {placement.isMeasurable && <><button className="details-toggle" aria-expanded={showContext} onClick={onToggleContext}>{showContext ? '− Yer ve notu gizle' : '+ Kat / mahal / not ekle'}</button><div className={`panel-collapse context-collapse ${showContext ? 'open' : ''}`} aria-hidden={!showContext}><div className="panel-collapse-inner"><div className="inspector-context"><label>Blok<input value={draft.block} onChange={(event) => onDraft({ ...draft, block: event.target.value })} /></label><label>Kat<input value={draft.floor} onChange={(event) => onDraft({ ...draft, floor: event.target.value })} /></label><label>Mahal<input value={draft.room} onChange={(event) => onDraft({ ...draft, room: event.target.value })} /></label><label>Pafta<input value={draft.sheet} onChange={(event) => onDraft({ ...draft, sheet: event.target.value })} /></label><label className="wide">Not<input value={draft.notes} onChange={(event) => onDraft({ ...draft, notes: event.target.value })} /></label></div></div></div></>}
    <div className="inspector-actions"><button className="full add-child" disabled={!canEdit || busy} onClick={onAdd}>+ Bunun altına kart ekle</button><button className="full danger-link delete-placement" disabled={!canEdit || busy} onClick={onDelete}>Seçili kartı ve altını sil</button></div><p className="tip">Kartı büyütüp giriş özetini görmek için çift tıkla.</p></aside>;
}

function CardShelf({ cards, onAdd, compact = false, onCreate, onDelete, onEdit }: { cards: CatalogCard[]; onAdd: (id: string) => void; compact?: boolean; onCreate?: () => void; onDelete?: (card: CatalogCard) => void; onEdit?: (card: CatalogCard) => void }) {
  const activeCards = visibleCatalogCards(cards);
  if (!activeCards.length) return <div className={`empty-shelf ${compact ? 'compact' : ''}`}><span>✦</span><h3>Henüz seçilecek kart yok</h3><p>{onCreate ? 'Önce tek bir kart oluştur. Kaydedince onu doğrudan bu projeye ekleyebilirsin.' : 'Yukarıdaki kısa formdan ilk kartını oluşturduğunda burada görünecek.'}</p>{onCreate && <button className="primary" onClick={onCreate}>+ İlk kartı oluştur</button>}</div>;
  return <div className={`card-shelf ${compact ? 'compact' : ''}`}>{activeCards.map((card) => { const meta = TYPE_META[card.cardType]; const note = (card as CatalogCard & { notes?: string | null }).notes; return <article key={card.latestVersionId} className="shelf-card" draggable onDragStart={(event) => event.dataTransfer.setData('application/metraj-card', card.latestVersionId)} style={{ '--node-accent': meta.color } as React.CSSProperties}><span>{meta.icon} {meta.label}{card.customTypeName ? ` · ${card.customTypeName}` : ''}</span><strong>{card.name}</strong><small>{card.unit}{card.variantMode === 'Pipe' ? ` · ${card.variants?.length ?? 0} çap` : card.variantMode === 'Fitting' ? ` · ${card.variants?.length ?? 0} çeşit` : ''}{card.materialType ? ` · ${card.materialType}` : ''}</small>{note && <p>{note}</p>}<div className="shelf-actions"><button onClick={() => onAdd(card.latestVersionId)}>+ Haritaya ekle</button>{onEdit && <button onClick={() => onEdit(card)}>Düzenle</button>}{onDelete && <button className="danger-link" onClick={() => onDelete(card)}>Sil</button>}</div></article>; })}</div>;
}

function SummaryTable({ summaries, measurements, placements = [] }: { summaries: MeasurementSummary[]; measurements: Measurement[]; placements?: Placement[] }) {
  const depthOf = (id: string) => { let depth = 0; let current = placements.find((item) => item.id === id); while (current?.parentPlacementId && depth < 12) { depth += 1; current = placements.find((item) => item.id === current?.parentPlacementId); } return depth; };
  const sizeOf = (name: string) => Number(name.match(/(?:DN\s*|\b)(\d+(?:[.,]\d+)?)/i)?.[1]?.replace(',', '.')) || 0;
  const sorted = [...summaries].sort((a, b) => depthOf(a.placementId) - depthOf(b.placementId) || sizeOf(b.variant ?? b.placementName) - sizeOf(a.variant ?? a.placementName) || a.placementName.localeCompare(b.placementName, 'tr') || (a.variant ?? '').localeCompare(b.variant ?? '', 'tr'));
  return <section className="summary-section"><div className="summary-heading"><div><span className="eyebrow">DÜZENLİ METRAJ</span><h3>Malzeme listesi</h3></div><span>{measurements.length} kaynak satırı</span></div>{sorted.length ? <div className="summary-list">{sorted.map((summary) => <div className="summary-row" key={`${summary.placementId}:${summary.variant ?? ''}:${summary.secondaryVariant ?? ''}`} style={{ '--tree-depth': depthOf(summary.placementId) } as React.CSSProperties}><div><strong>{summary.placementName}</strong><small>{[summary.variant, summary.secondaryVariant].filter(Boolean).join(' · ') || 'Standart'} · {summary.measurementCount} giriş · {summary.unit}</small></div><div><span>Net</span><b>{quantity(summary.netQuantity)}</b></div><div><span>Fireli</span><b>{quantity(summary.withWasteQuantity)}</b></div><div><span>Satın alma</span><b>{quantity(summary.purchaseQuantity)} {purchaseUnit(summary)}</b></div></div>)}</div> : <div className="empty-table">Henüz metraj yok. Haritada bir malzeme seçip miktarı yazın.</div>}</section>;
}

function Stat({ label, value }: { label: string; value: string }) { return <article className="stat"><strong>{value}</strong><span>{label}</span></article>; }

function AdvancedControls(props: {
  inline?: boolean;
  revisions: Revision[]; selectedRevisionId: string; canEdit: boolean; busy: boolean;
  rules: CalculationRule[]; results: CalculationResult[]; responsibilities: ResponsibilityData | null; backups: DatabaseBackup[]; integrity: DatabaseIntegrity | null; wasteSettings: MaterialWasteSetting[];
  wasteDraft: { materialType: string; wasteRatePct: string };
  placements: Placement[]; selectedPlacementId: string | null; calculationTargetId: string; calculationSourceId: string;
  ruleDraft: { code: string; name: string; multiplier: string }; dimensionDraft: { code: string; name: string }; partyDraft: { code: string; name: string };
  assignmentDraft: { dimensionId: string; partyId: string; placementId: string; state: string };
  onClose: () => void; onSelectRevision: (id: string) => void; onCreateDraft: () => void; onApproveRevision: () => void;
  onRuleDraft: (value: { code: string; name: string; multiplier: string }) => void; onCreateRule: () => void; onCalculationTarget: (id: string) => void; onCalculationSource: (id: string) => void; onLinkCalculationSource: () => void; onRunCalculation: (ruleId: string) => void;
  onReviewCalculation: (resultId: string, decision: 'approve' | 'reject') => void; onOverrideCalculation: (result: CalculationResult) => void;
  onDimensionDraft: (value: { code: string; name: string }) => void; onPartyDraft: (value: { code: string; name: string }) => void;
  onAssignmentDraft: (value: { dimensionId: string; partyId: string; placementId: string; state: string }) => void;
  onWasteDraft: (value: { materialType: string; wasteRatePct: string }) => void; onSaveWaste: () => void; onEditWaste: (setting: MaterialWasteSetting) => void; onDeleteWaste: (setting: MaterialWasteSetting) => void;
  onCreateDimension: () => void; onCreateParty: () => void; onAssign: () => void; onCreateBackup: () => void; onCheckIntegrity: () => void; onRestoreBackup: (backup: DatabaseBackup) => void;
}) {
  const { responsibilities } = props;
  const targetId = props.calculationTargetId || props.selectedPlacementId || '';
  const pendingResults = props.results.filter((result) => result.status === 'PendingReview');
  return <div className={props.inline ? 'settings-inline' : 'modal-backdrop advanced-backdrop'} onMouseDown={props.inline ? undefined : props.onClose}>
    <div className={props.inline ? 'settings-inline-body' : 'modal advanced-modal'} onMouseDown={(event) => event.stopPropagation()}>
      {!props.inline && <button className="modal-close" onClick={props.onClose}>×</button>}
      <span className="eyebrow">AYARLAR</span>
      <h2>Proje ve hesap ayarları</h2>
      <p>Fire payları, sürümler, kontrollü hesaplar, sorumluluklar ve veri güvenliği aynı ekranda.</p>
      <div className="advanced-grid">
        <section className="advanced-card">
          <span className="advanced-icon">01</span><h3>Sürüm</h3>
          <label>Çalışılan sürüm<select value={props.selectedRevisionId} onChange={(event) => props.onSelectRevision(event.target.value)}>{props.revisions.map((revision) => <option key={revision.id} value={revision.id}>{revision.code} · {revision.status === 'Draft' ? 'düzenlenebilir' : 'onaylı'}</option>)}</select></label>
          <div className="inline-actions"><button disabled={props.busy} onClick={props.onCreateDraft}>+ Düzenleme kopyası</button><button className="primary" disabled={!props.canEdit || props.busy} onClick={props.onApproveRevision}>Bu sürümü onayla</button></div>
          <small>Onaylanan sürüm korunur; değişiklik için yeni bir kopya açılır.</small>
        </section>

        <section className="advanced-card">
          <span className="advanced-icon">02</span><h3>Hesap önerisi</h3>
          <p className="compact-note">Serbest kod yoktur. Kural, kaynak miktarı güvenli bir çarpanla öneriye dönüştürür.</p>
          <div className="mini-form three"><label>Kod<input placeholder="Örn. DIRSEK" value={props.ruleDraft.code} onChange={(event) => props.onRuleDraft({ ...props.ruleDraft, code: event.target.value })} /></label><label>Ad<input placeholder="Örn. Dirsek payı" value={props.ruleDraft.name} onChange={(event) => props.onRuleDraft({ ...props.ruleDraft, name: event.target.value })} /></label><label>Çarpan<input inputMode="decimal" value={props.ruleDraft.multiplier} onChange={(event) => props.onRuleDraft({ ...props.ruleDraft, multiplier: event.target.value })} /></label></div>
          <button className="full" disabled={!props.canEdit || props.busy} onClick={props.onCreateRule}>Kuralı ekle</button>
          <label>Hesaplanacak ek parça<select value={targetId} onChange={(event) => props.onCalculationTarget(event.target.value)}><option value="">Kart seç</option>{props.placements.filter((placement) => placement.isMeasurable).map((placement) => <option key={placement.id} value={placement.id}>{placement.displayName}</option>)}</select></label>
          <div className="calculation-link"><label>Bu hesabın kaynak kartı<select value={props.calculationSourceId} onChange={(event) => props.onCalculationSource(event.target.value)}><option value="">Kaynak seç</option>{props.placements.filter((placement) => placement.isMeasurable && placement.id !== targetId).map((placement) => <option key={placement.id} value={placement.id}>{placement.displayName}</option>)}</select></label><button disabled={!props.canEdit || props.busy || !targetId || !props.calculationSourceId} onClick={props.onLinkCalculationSource}>Kaynağı bağla</button></div>
          <small className="compact-note">Örnek: Boru kartını kaynak, dirsek veya te kartını hesaplanacak ek parça olarak seç.</small>
          <div className="rule-list">{props.rules.length ? props.rules.filter((rule) => rule.isActive).map((rule) => <div key={rule.id}><span><b>{rule.code}</b> · ×{quantity(rule.multiplier)}</span><button disabled={!props.canEdit || props.busy || !targetId} onClick={() => props.onRunCalculation(rule.id)}>Öner</button></div>) : <small>Henüz kural yok.</small>}</div>
          {pendingResults.length > 0 && <div className="review-list">{pendingResults.map((result) => <div key={result.id}><span><b>{result.targetPlacementName}</b><small>{quantity(result.proposedQuantity)} {result.unit} önerildi</small></span><button disabled={!props.canEdit || props.busy} onClick={() => props.onReviewCalculation(result.id, 'approve')}>Onayla</button><button disabled={!props.canEdit || props.busy} onClick={() => props.onOverrideCalculation(result)}>Elle düzelt</button><button className="danger-link" disabled={!props.canEdit || props.busy} onClick={() => props.onReviewCalculation(result.id, 'reject')}>Reddet</button></div>)}</div>}
        </section>

        <section className="advanced-card waste-settings-card">
          <span className="advanced-icon">03</span><h3>Malzeme fire payları</h3>
          <p className="compact-note">Aynı malzeme ailesindeki bütün kartlara uygulanacak oranı tanımla. Bu kural, kartın varsayılan fire oranı yerine kullanılır; aile kuralı yoksa kart oranı geçerlidir.</p>
          <div className="mini-form two"><label>Malzeme ailesi<input placeholder="Örn. Galvaniz Çelik Boru" value={props.wasteDraft.materialType} onChange={(event) => props.onWasteDraft({ ...props.wasteDraft, materialType: event.target.value })} /></label><label>Fire payı (%)<input inputMode="decimal" placeholder="5" value={props.wasteDraft.wasteRatePct} onChange={(event) => props.onWasteDraft({ ...props.wasteDraft, wasteRatePct: event.target.value })} /></label></div>
          <button className="full" disabled={props.busy} onClick={props.onSaveWaste}>Fire kuralını kaydet</button>
          <div className="waste-list">{props.wasteSettings.length ? props.wasteSettings.map((setting) => <div key={setting.id}><span><b>{setting.materialType}</b><small>%{quantity(setting.wasteRatePct)} fire</small></span><div className="inline-actions"><button disabled={props.busy} onClick={() => props.onEditWaste(setting)}>Düzenle</button><button className="danger-link" disabled={props.busy} onClick={() => props.onDeleteWaste(setting)}>Sil</button></div></div>) : <small>Henüz malzeme ailesi için ayrı fire kuralı yok.</small>}</div>
        </section>

        <section className="advanced-card">
          <span className="advanced-icon">04</span><h3>Sorumluluk</h3>
          <p className="compact-note">“Temin”, “montaj” gibi alanlar sabit değildir; ihtiyacın kadar yeni boyut ekleyebilirsin.</p>
          <div className="mini-form two"><label>Boyut kodu<input placeholder="Örn. MONTAJ" value={props.dimensionDraft.code} onChange={(event) => props.onDimensionDraft({ ...props.dimensionDraft, code: event.target.value })} /></label><label>Boyut adı<input placeholder="Örn. Montaj" value={props.dimensionDraft.name} onChange={(event) => props.onDimensionDraft({ ...props.dimensionDraft, name: event.target.value })} /></label></div><button disabled={!props.canEdit || props.busy} onClick={props.onCreateDimension}>Boyut ekle</button>
          <div className="mini-form two"><label>Taraf kodu<input placeholder="Örn. TAŞERON" value={props.partyDraft.code} onChange={(event) => props.onPartyDraft({ ...props.partyDraft, code: event.target.value })} /></label><label>Taraf adı<input placeholder="Örn. Boru Ustası" value={props.partyDraft.name} onChange={(event) => props.onPartyDraft({ ...props.partyDraft, name: event.target.value })} /></label></div><button disabled={!props.canEdit || props.busy} onClick={props.onCreateParty}>Taraf ekle</button>
          <div className="mini-form two assignment-form"><label>Boyut<select value={props.assignmentDraft.dimensionId} onChange={(event) => props.onAssignmentDraft({ ...props.assignmentDraft, dimensionId: event.target.value })}><option value="">Seç</option>{responsibilities?.dimensions.map((dimension) => <option key={dimension.id} value={dimension.id}>{dimension.name}</option>)}</select></label><label>Taraf<select value={props.assignmentDraft.partyId} onChange={(event) => props.onAssignmentDraft({ ...props.assignmentDraft, partyId: event.target.value })}><option value="">Atanmamış</option>{responsibilities?.parties.map((party) => <option key={party.id} value={party.id}>{party.name}</option>)}</select></label><label>Kart<select value={props.assignmentDraft.placementId || props.selectedPlacementId || ''} onChange={(event) => props.onAssignmentDraft({ ...props.assignmentDraft, placementId: event.target.value })}><option value="">Seç</option>{props.placements.map((placement) => <option key={placement.id} value={placement.id}>{placement.displayName}</option>)}</select></label><label>Durum<select value={props.assignmentDraft.state} onChange={(event) => props.onAssignmentDraft({ ...props.assignmentDraft, state: event.target.value })}><option value="Assigned">Sorumlu</option><option value="Excluded">Hariç</option><option value="Optional">Opsiyonel</option><option value="Unassigned">Atanmamış</option></select></label></div><button className="full" disabled={!props.canEdit || props.busy} onClick={props.onAssign}>Kart sorumluluğunu kaydet</button>
          {responsibilities?.assignments.length ? <small className="count-note">{responsibilities.assignments.length} sorumluluk kaydı var.</small> : <small className="count-note">Henüz sorumluluk kaydı yok.</small>}
        </section>

        <section className="advanced-card">
          <span className="advanced-icon">05</span><h3>Güvenlik</h3>
          <div className={`integrity ${props.integrity?.isHealthy ? 'healthy' : 'warning'}`}><b>{props.integrity?.isHealthy ? '✓ Veritabanı sağlam' : 'Kontrol bekliyor'}</b><small>{props.integrity?.details ?? 'Kontrol sonucu henüz alınmadı.'}</small></div>
          <div className="inline-actions"><button disabled={props.busy} onClick={props.onCheckIntegrity}>Kontrol et</button><button className="primary" disabled={props.busy} onClick={props.onCreateBackup}>Şimdi yedekle</button></div>
          <div className="backup-list">{props.backups.length ? props.backups.slice(0, 4).map((backup) => <div key={backup.fullPath}><span><b>{backup.fileName}</b><small>{new Date(backup.createdAtUtc).toLocaleString('tr-TR')} · {Math.max(1, Math.round(backup.sizeBytes / 1024))} KB</small></span><button className="danger-link" disabled={props.busy} onClick={() => props.onRestoreBackup(backup)}>Geri yükle</button></div>) : <small>Henüz yedek yok.</small>}</div>
        </section>
      </div>
    </div>
  </div>;
}
