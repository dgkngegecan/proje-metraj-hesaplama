import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, ApiError } from './api';
import { AskDialog, useAsk } from './AskDialog';
import { loadUiState, readUiState, writeUiState, type UiStateMap } from './uiState';
import { TYPE_META, type FlowBreakdown, type PlacementNode, type View } from './lib/uiTypes';
import { Stat } from './components/Stat';
import { FlowCard } from './components/FlowCard';
import { Welcome } from './components/Welcome';
import { CardShelf } from './components/CardShelf';
import { SummaryTable } from './components/SummaryTable';
import { CatalogPage } from './components/CatalogPage';
import { AdvancedControls } from './components/AdvancedControls';
import { Inspector } from './components/Inspector';
import type { CardDraftState } from './lib/draftTypes';
import { buildFlow } from './lib/flow';
import { makeCardCode, measurementLabel, parseDecimal, quantity } from './lib/format';
import type {
  CalculationResult,
  CalculationRule,
  CardType,
  CatalogCard,
  CatalogCardAttributeDescriptor,
  CatalogCardType,
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

const nodeTypes: NodeTypes = { placement: FlowCard };

// Virgüllü ondalık girişi sayıya çevirir. Türkçe klavyede ondalık ayıracı
// virgüldür; bu dönüşüm on ayrı yerde, her seferinde biraz farklı korumayla
// tekrarlanıyordu. `Number` zaten baştaki/sondaki boşluğu yok saydığı için
// davranış birebir aynı: geçersiz girdide NaN döner.
// Bir ölçüm satırının çap/boyut bilgisi.
//
// Yapılandırılmış `variant` alanı varsa o kullanılır; serbest metin ayrıştırma
// yalnızca bu alan eklenmeden ÖNCE yazılmış eski satırlar içindir. Aynı ifade
// beş ayrı yerde tekrarlanıyordu; biri değiştiğinde ötekiler sessizce geride
// kalırdı. Eski satırların bilgisi kaybolmasın diye geri düşüş korunuyor.
export default function App() {
  const [view, setView] = useState<View>('flow');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [cards, setCards] = useState<CatalogCard[]>([]);
  const [catalogTypes, setCatalogTypes] = useState<CatalogCardType[]>([]);
  const [catalogAttributes, setCatalogAttributes] = useState<CatalogCardAttributeDescriptor[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [summaries, setSummaries] = useState<MeasurementSummary[]>([]);
  const [report, setReport] = useState<ReportData | null>(null);
  // Rapor artık tembel yükleniyor (T3-1). Bu sayaç her veri değişiminde artar;
  // çıktı ekranı açıkken raporun tazelenmesini tetikleyen tek sinyal budur.
  const [dataVersion, setDataVersion] = useState(0);
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
  // ReactFlow mount olduğunda `flow` set ediliyor. Bu değer bir callback'in
  // bağımlılığı olursa callback'in kimliği değişir ve ona bağlı useEffect
  // yeniden tetiklenir -- yani açılışta bütün veri iki kez yüklenirdi.
  const flowRef = useRef<ReactFlowInstance<PlacementNode, Edge> | null>(null);
  flowRef.current = flow;
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
  // Açık kartlar TEK bir yerde tutuluyor. Önceden aynı küme hem state hem ref
  // olarak duruyor ve dört ayrı yerde elle eşitleniyordu; state hiçbir yerde
  // okunmuyor, yalnızca yeniden çizim tetiklemek için yazılıyordu. İkisi
  // ayrıştığında kart açık görünüp kapalı davranabilirdi.
  const expandedPlacementIdsRef = useRef<Set<string>>(new Set());
  const [, requestRepaint] = useReducer((tick: number) => tick + 1, 0);
  const setExpandedPlacements = useCallback((next: Set<string>) => {
    expandedPlacementIdsRef.current = next;
    requestRepaint();
  }, []);
  const [reportScopeId, setReportScopeId] = useState<string | null>(null);
  const [addNewCardToFlow, setAddNewCardToFlow] = useState(false);
  const [busy, setBusy] = useState(false);
  const { pending: askRequest, ask, close: closeAsk } = useAsk();
  // Kalıcı arayüz durumu sunucuda tutulur; loopback portu değişse de kaybolmaz.
  const uiState = useRef<UiStateMap>({});
  const [uiStateReady, setUiStateReady] = useState(false);
  const [toast, setToast] = useState('');
  const [projectDraft, setProjectDraft] = useState({ code: '', name: '' });
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [cardDraft, setCardDraft] = useState<CardDraftState>({
    code: '',
    name: '',
    type: 'Material',
    unit: 'adet',
    customTypeId: '',
    attributeValues: {},
    variantMode: 'None',
    variants: [],
    notes: '',
    materialType: '',
    wasteRatePct: '0',
  });
  const [typeDraft, setTypeDraft] = useState({
    code: '',
    name: '',
    baseCardType: 'Material' as CardType,
    description: '',
    parentCardIds: [] as string[],
    childCardIds: [] as string[],
    attributeKeys: [] as string[],
  });
  const [measurementDraft, setMeasurementDraft] = useState({
    quantity: '',
    block: '',
    floor: '',
    room: '',
    sheet: '',
    notes: '',
  });
  const [placementNotesDraft, setPlacementNotesDraft] = useState('');
  const [ruleDraft, setRuleDraft] = useState({ code: '', name: '', multiplier: '1' });
  const [calculationTargetId, setCalculationTargetId] = useState('');
  const [calculationSourceId, setCalculationSourceId] = useState('');
  const [dimensionDraft, setDimensionDraft] = useState({ code: '', name: '' });
  const [partyDraft, setPartyDraft] = useState({ code: '', name: '' });
  const [assignmentDraft, setAssignmentDraft] = useState({
    dimensionId: '',
    partyId: '',
    placementId: '',
    state: 'Assigned',
  });
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
  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // Yükleyiciler hatayı kendi içlerinde yakalayıp normal dönüyor; bu yüzden
  // çağıran, başarısız bir yenilemeden sonra "başarılı" mesajı gösterebiliyordu.
  // Kullanıcı arka arkaya hem hata hem başarı toast'ı görüp hangisinin geçerli
  // olduğunu bilemiyordu.
  const operationFailed = useRef(false);
  const fail = useCallback(
    (error: unknown) => {
      operationFailed.current = true;
      notify(error instanceof ApiError ? error.message : 'Bir şey ters gitti. Tekrar deneyin.');
    },
    [notify],
  );
  const notifySuccess = (message: string) => {
    if (!operationFailed.current) notify(message);
  };

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
    setExpandedPlacements(new Set<string>());
  }, [setExpandedPlacements]);

  const selectProject = useCallback(
    (projectId: string) => {
      clearProjectView();
      setSelectedProjectId(projectId);
    },
    [clearProjectView],
  );

  const loadProjects = useCallback(async () => {
    try {
      const next = await api.get<Project[]>('/projects');
      setProjects(next);
      // Geri yükleme sonrası, artık var olmayan bir projede kalınmamalı.
      // Önceki sürüm dolu bir seçimi koşulsuz koruyordu; kullanıcı silinmiş bir
      // projenin adını üst çubukta görüp boş ekranlarla kalıyordu.
      setSelectedProjectId((current) =>
        next.some((project) => project.id === current) ? current : (next[0]?.id ?? ''),
      );
    } catch (error) {
      fail(error);
    }
  }, []);

  const loadCards = useCallback(async () => {
    try {
      setCards(await api.get<CatalogCard[]>('/catalog/cards'));
    } catch (error) {
      fail(error);
    }
  }, []);
  const loadCatalogTypeSettings = useCallback(async () => {
    try {
      const [nextTypes, nextAttributes] = await Promise.all([
        api.get<CatalogCardType[]>('/catalog/types'),
        api.get<CatalogCardAttributeDescriptor[]>('/catalog/attributes'),
      ]);
      setCatalogTypes(nextTypes);
      setCatalogAttributes(nextAttributes);
    } catch (error) {
      fail(error);
    }
  }, []);

  const loadRevision = useCallback(async (revisionId: string) => {
    const requestSequence = ++revisionLoadSequence.current;
    if (!revisionId) return;
    try {
      // Rapor bilerek burada YOK. Kendi içinde bu verinin çoğunu dört ayrı
      // servisle yeniden okur ve yalnızca "Metraj çıktısı" ekranında görünür.
      // Her ölçüm kaydında onu da beklemek, uygulamanın ana vaadi olan hızlı
      // metraj girişini her satırda yavaşlatıyordu. Artık ihtiyaç anında yükleniyor.
      const [nextPlacements, nextMeasurements, nextSummaries] = await Promise.all([
        api.get<Placement[]>(`/revisions/${revisionId}/placements`),
        api.get<Measurement[]>(`/revisions/${revisionId}/measurements`),
        api.get<MeasurementSummary[]>(`/revisions/${revisionId}/measurement-summaries`),
      ]);
      // Geç kalmış bir önceki proje/sürüm yanıtı, aktif görünümü ezmemelidir.
      if (requestSequence !== revisionLoadSequence.current) return;
      setPlacements(nextPlacements);
      setMeasurements(nextMeasurements);
      setSummaries(nextSummaries);
      // Görünen rapor artık bayat; çıktı ekranı açıksa/açılırsa yenilenecek.
      setDataVersion((current) => current + 1);
      const nextFlow = buildFlow(nextPlacements);
      // Silinmiş kartların konumlarını taşımaya gerek yok.
      const liveIds = new Set(nextPlacements.map((item) => item.id));
      nodePositions.current = new Map([...nodePositions.current].filter(([id]) => liveIds.has(id)));
      // Her düğüm için bütün listeleri taramak yerine bir kez indeksle:
      // kart sayısı x satır sayısı yerine kart sayısı + satır sayısı iş.
      const summaryByPlacement = new Map<string, MeasurementSummary>();
      nextSummaries.forEach((item) => {
        if (!summaryByPlacement.has(item.placementId)) summaryByPlacement.set(item.placementId, item);
      });
      const measurementsByPlacement = new Map<string, Measurement[]>();
      nextMeasurements.forEach((item) => {
        const bucket = measurementsByPlacement.get(item.placementId);
        if (bucket) bucket.push(item);
        else measurementsByPlacement.set(item.placementId, [item]);
      });
      nextFlow.nodes = nextFlow.nodes.map((node) => {
        const itemSummary = summaryByPlacement.get(node.id);
        const groups = new Map<string, FlowBreakdown>();
        (measurementsByPlacement.get(node.id) ?? []).forEach((item) => {
          const label =
            [item.variant, item.secondaryVariant].filter(Boolean).join(' · ') || measurementLabel(item.notes);
          const existing = groups.get(label);
          const entry = {
            id: item.id,
            quantity: item.inputQuantity,
            createdAtUtc: item.createdAtUtc,
            notes: item.notes,
          };
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
            return (
              (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0) || a.id.localeCompare(b.id)
            );
          }),
        }));
        const remembered = nodePositions.current.get(node.id);
        return {
          ...node,
          position: remembered ?? node.position,
          data: {
            ...node.data,
            expanded: expandedPlacementIdsRef.current.has(node.id),
            uiSummary: itemSummary,
            uiBreakdown,
          },
        };
      });
      setNodes(nextFlow.nodes);
      setEdges(nextFlow.edges);
      setSelectedPlacementId((current) =>
        nextPlacements.some((item) => item.id === current) ? current : (nextPlacements[0]?.id ?? null),
      );
      window.setTimeout(() => flowRef.current?.fitView({ padding: 0.24, duration: 420 }), 80);
    } catch (error) {
      fail(error);
    }
  }, []);

  // Rapor yalnızca "Metraj çıktısı" ekranında görünür; oraya girildiğinde ve
  // veri değiştiğinde yüklenir. Yarış koruması loadRevision'daki ile aynı
  // mantıkta: geç gelen bir önceki revizyonun raporu aktif olanı ezmemeli.
  const reportLoadSequence = useRef(0);
  useEffect(() => {
    if (view !== 'control' || !selectedRevisionId) return;
    const revisionId = selectedRevisionId;
    const requestSequence = ++reportLoadSequence.current;
    void (async () => {
      try {
        const nextReport = await api.get<ReportData>(`/revisions/${revisionId}/report`);
        if (requestSequence !== reportLoadSequence.current) return;
        setReport(nextReport);
      } catch (error) {
        fail(error);
      }
    })();
  }, [view, selectedRevisionId, dataVersion]);

  const loadAdvanced = useCallback(async () => {
    if (!selectedRevisionId) return;
    // loadRevision'daki yarış koruması burada da gerekli: geç gelen bir önceki
    // projenin yanıtı, aktif projenin kural ve sonuç listelerini ezmemeli.
    const requestSequence = ++advancedLoadSequence.current;
    try {
      const [nextRules, nextResults, nextResponsibilities, nextBackups, nextIntegrity, nextWasteSettings] =
        await Promise.all([
          api.get<CalculationRule[]>(`/revisions/${selectedRevisionId}/calculations/rules`),
          api.get<CalculationResult[]>(`/revisions/${selectedRevisionId}/calculations/results`),
          api.get<ResponsibilityData>(`/revisions/${selectedRevisionId}/responsibilities`),
          api.get<DatabaseBackup[]>('/database/backups'),
          api.get<DatabaseIntegrity>('/database/integrity'),
          api.get<MaterialWasteSetting[]>('/settings/material-waste'),
        ]);
      if (requestSequence !== advancedLoadSequence.current) return;
      setRules(nextRules);
      setCalculationResults(nextResults);
      setResponsibilities(nextResponsibilities);
      setBackups(nextBackups);
      setIntegrity(nextIntegrity);
      setWasteSettings(nextWasteSettings);
    } catch (error) {
      fail(error);
    }
  }, [selectedRevisionId]);

  useEffect(() => {
    void loadProjects();
    void loadCards();
    void loadCatalogTypeSettings();
  }, [loadCards, loadCatalogTypeSettings, loadProjects]);
  useEffect(() => {
    let cancelled = false;
    void loadUiState()
      .then((map) => {
        if (cancelled) return;
        uiState.current = map;
        setSidebarCollapsed(readUiState(map, 'sidebar-collapsed') === '1');
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setUiStateReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!selectedProjectId) {
      clearProjectView();
      return;
    }
    let cancelled = false;
    void api
      .get<Revision[]>(`/projects/${selectedProjectId}/revisions`)
      .then((next) => {
        if (cancelled) return;
        setRevisions(next);
        setSelectedRevisionId(next[0]?.id ?? '');
      })
      .catch(fail);
    return () => {
      cancelled = true;
    };
  }, [clearProjectView, selectedProjectId]);
  useEffect(() => {
    void loadRevision(selectedRevisionId);
  }, [loadRevision, selectedRevisionId]);
  useEffect(() => {
    if (view === 'settings') void loadAdvanced();
  }, [loadAdvanced, view]);
  useEffect(() => {
    if (!uiStateReady) return;
    writeUiState(uiState.current, 'sidebar-collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed, uiStateReady]);
  useEffect(() => {
    setPlacementNotesDraft(selectedPlacement?.notes ?? '');
  }, [selectedPlacementId, selectedPlacement?.notes]);

  const reload = async () => {
    await Promise.all([loadProjects(), loadCards(), loadCatalogTypeSettings(), loadRevision(selectedRevisionId)]);
  };
  const withBusy = async (work: () => Promise<void>) => {
    setBusy(true);
    operationFailed.current = false;
    try {
      await work();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const createDraftRevision = () =>
    withBusy(async () => {
      if (!selectedProjectId) throw new ApiError('Önce bir proje seçin.');
      const created = await api.post<Revision>(`/projects/${selectedProjectId}/revisions`);
      const next = await api.get<Revision[]>(`/projects/${selectedProjectId}/revisions`);
      setRevisions(next);
      setSelectedRevisionId(created.id);
      notifySuccess(`${created.code} düzenleme kopyası hazır.`);
    });
  const approveRevision = () =>
    withBusy(async () => {
      if (!selectedRevisionId) return;
      await api.post(`/revisions/${selectedRevisionId}/approve`);
      const next = await api.get<Revision[]>(`/projects/${selectedProjectId}/revisions`);
      setRevisions(next);
      await loadRevision(selectedRevisionId);
      notifySuccess('Bu sürüm onaylandı ve kilitlendi.');
    });
  const createRule = () =>
    withBusy(async () => {
      const multiplier = parseDecimal(ruleDraft.multiplier);
      if (!ruleDraft.code.trim() || !ruleDraft.name.trim() || !Number.isFinite(multiplier) || multiplier < 0)
        throw new ApiError('Kuralın kodunu, adını ve çarpanını yazın.');
      await api.post(`/revisions/${selectedRevisionId}/calculations/rules`, {
        code: ruleDraft.code,
        name: ruleDraft.name,
        mode: 'FixedMultiplier',
        multiplier,
        sourceQuantityKind: 'Net',
      });
      setRuleDraft({ code: '', name: '', multiplier: '1' });
      await loadAdvanced();
      notifySuccess('Hesap kuralı eklendi.');
    });
  const runCalculation = (ruleId: string) =>
    withBusy(async () => {
      const targetPlacementId = calculationTargetId || selectedPlacementId;
      if (!targetPlacementId) throw new ApiError('Önce hesaplanacak kartı seçin.');
      await api.post(`/revisions/${selectedRevisionId}/calculations/results`, {
        targetPlacementId,
        ruleVersionId: ruleId,
      });
      await Promise.all([loadAdvanced(), loadRevision(selectedRevisionId)]);
      notifySuccess('Hesap önerisi kontrol listesine eklendi.');
    });
  const linkCalculationSource = () =>
    withBusy(async () => {
      const targetPlacementId = calculationTargetId || selectedPlacementId;
      if (!targetPlacementId) throw new ApiError('Önce hesaplanacak ek parça kartını seçin.');
      if (!calculationSourceId) throw new ApiError('Bu hesabın kaynak kartını seçin.');
      if (targetPlacementId === calculationSourceId)
        throw new ApiError('Kaynak kartı ile hesaplanacak kart aynı olamaz.');
      await api.post(`/placements/${targetPlacementId}/calculated-from`, {
        sourcePlacementId: calculationSourceId,
        notes: null,
      });
      setCalculationSourceId('');
      notifySuccess('Hesap kaynağı bağlandı. Artık öneri üretebilirsin.');
    });
  const reviewCalculation = (resultId: string, decision: 'approve' | 'reject') =>
    withBusy(async () => {
      if (decision === 'approve') await api.post(`/calculations/results/${resultId}/approve`);
      else {
        const answer = await ask({
          title: 'Hesap önerisi uygulanmasın mı?',
          description: 'Gerekçe kontrol listesinde ve raporda görünür.',
          confirmLabel: 'Uygulama',
          danger: true,
          fields: [{ key: 'reason', label: 'Gerekçe', value: 'Kontrol sonrası uygulanmadı', multiline: true }],
        });
        if (!answer?.reason?.trim()) return;
        await api.post(`/calculations/results/${resultId}/reject`, { reason: answer.reason.trim() });
      }
      await Promise.all([loadAdvanced(), loadRevision(selectedRevisionId)]);
      notify(decision === 'approve' ? 'Hesap önerisi onaylandı.' : 'Hesap önerisi uygulanmadı.');
    });
  const overrideCalculation = (result: CalculationResult) =>
    withBusy(async () => {
      // Tek pencerede hem miktar hem gerekçe: önceden arka arkaya iki
      // window.prompt açılıyor, ikincisinde vazgeçen kullanıcı ilkini de kaybediyordu.
      const answer = await ask({
        title: `${result.targetPlacementName} için kullanılacak miktar`,
        description: `Öneri: ${quantity(result.proposedQuantity)} ${result.unit}`,
        confirmLabel: 'Miktarı uygula',
        fields: [
          {
            key: 'quantity',
            label: `Kullanılacak miktar (${result.unit})`,
            value: String(result.proposedQuantity),
            inputMode: 'decimal',
          },
          {
            key: 'reason',
            label: 'Neden elle değiştirildi?',
            value: 'Saha kontrolü sonrası düzeltildi',
            multiline: true,
          },
        ],
      });
      if (!answer) return;
      const usedQuantity = parseDecimal(answer.quantity ?? '');
      if (!Number.isFinite(usedQuantity) || usedQuantity < 0)
        throw new ApiError('Kullanılacak miktarı sayı olarak yazın.');
      if (!answer.reason?.trim()) throw new ApiError('Değiştirme gerekçesini yazın.');
      await api.post(`/calculations/results/${result.id}/override`, { usedQuantity, reason: answer.reason.trim() });
      await Promise.all([loadAdvanced(), loadRevision(selectedRevisionId)]);
      notifySuccess('Hesap önerisi elle güncellendi.');
    });
  const createDimension = () =>
    withBusy(async () => {
      if (!dimensionDraft.code.trim() || !dimensionDraft.name.trim()) throw new ApiError('Boyut için kod ve ad yazın.');
      await api.post(`/revisions/${selectedRevisionId}/responsibilities/dimensions`, dimensionDraft);
      setDimensionDraft({ code: '', name: '' });
      await loadAdvanced();
      notifySuccess('Sorumluluk boyutu eklendi.');
    });
  const createParty = () =>
    withBusy(async () => {
      if (!partyDraft.code.trim() || !partyDraft.name.trim()) throw new ApiError('Taraf için kod ve ad yazın.');
      await api.post(`/revisions/${selectedRevisionId}/responsibilities/parties`, partyDraft);
      setPartyDraft({ code: '', name: '' });
      await loadAdvanced();
      notifySuccess('Taraf eklendi.');
    });
  const assignResponsibility = () =>
    withBusy(async () => {
      const placementId = assignmentDraft.placementId || selectedPlacementId;
      if (!assignmentDraft.dimensionId || !placementId) throw new ApiError('Boyut ve kart seçin.');
      await api.post(`/revisions/${selectedRevisionId}/responsibilities/assignments`, {
        ...assignmentDraft,
        placementId,
        partyId: assignmentDraft.partyId || null,
        notes: null,
      });
      await loadAdvanced();
      notifySuccess('Sorumluluk atandı.');
    });
  const createBackup = () =>
    withBusy(async () => {
      await api.post('/database/backups');
      await loadAdvanced();
      notifySuccess('Güvenli yedek alındı.');
    });
  const checkIntegrity = () =>
    withBusy(async () => {
      const result = await api.get<DatabaseIntegrity>('/database/integrity');
      setIntegrity(result);
      notify(result.isHealthy ? 'Veritabanı kontrolü temiz.' : 'Veritabanı kontrolü uyarı verdi.');
    });
  const restoreBackup = (backup: DatabaseBackup) =>
    withBusy(async () => {
      const answer = await ask({
        title: 'Bu yedeğe dönülsün mü?',
        description: `${backup.fileName} geri yüklenecek. Mevcut hâl önce ayrıca yedeklenir.`,
        confirmLabel: 'Geri yükle',
        danger: true,
      });
      if (!answer) return;
      await api.post('/database/backups/restore', { fullPath: backup.fullPath });
      await reload();
      await loadAdvanced();
      notifySuccess('Yedek geri yüklendi.');
    });
  const saveWasteSetting = () =>
    withBusy(async () => {
      const materialType = wasteDraft.materialType.trim();
      const wasteRatePct = parseDecimal(wasteDraft.wasteRatePct);
      if (!materialType) throw new ApiError('Fire payı için malzeme ailesi yazın.');
      if (!Number.isFinite(wasteRatePct) || wasteRatePct < 0 || wasteRatePct > 1000)
        throw new ApiError('Fire payını 0 ile 1000 arasında yazın.');
      await api.put('/settings/material-waste', { materialType, wasteRatePct });
      setWasteDraft({ materialType: '', wasteRatePct: '0' });
      // Fire politikası özetleri etkiler. Yalnızca loadAdvanced çağırmak, ekrandaki
      // tabloyu eski sayılarla bırakıyor ama indirilen dosya yeni sayılarla
      // üretiliyordu; kullanıcı hangisinin doğru olduğunu anlayamıyordu.
      await Promise.all([loadAdvanced(), loadRevision(selectedRevisionId)]);
      notifySuccess(`${materialType} için %${quantity(wasteRatePct)} fire payı kaydedildi.`);
    });
  const removeWasteSetting = (setting: MaterialWasteSetting) =>
    withBusy(async () => {
      const answer = await ask({
        title: 'Fire kuralı kaldırılsın mı?',
        description: `“${setting.materialType}” için tanımlı oran silinecek; kartların kendi oranları geçerli olur.`,
        confirmLabel: 'Kaldır',
        danger: true,
      });
      if (!answer) return;
      await api.delete(`/settings/material-waste/${setting.id}`);
      await Promise.all([loadAdvanced(), loadRevision(selectedRevisionId)]);
      notifySuccess('Malzeme fire kuralı kaldırıldı.');
    });
  const editWasteSetting = (setting: MaterialWasteSetting) =>
    setWasteDraft({ materialType: setting.materialType, wasteRatePct: String(setting.wasteRatePct) });

  const createProject = () =>
    withBusy(async () => {
      const created = await api.post<Project>('/projects', {
        code: projectDraft.code,
        name: projectDraft.name,
        description: null,
      });
      // İlk ağ yenilemesi tamamlanana kadar karşılama ekranına geri düşmemesi için
      // oluşturulan projeyi yerel seçim durumuna hemen ekle.
      setProjects((current) =>
        current.some((project) => project.id === created.id) ? current : [created, ...current],
      );
      selectProject(created.id);
      setShowProjectDialog(false);
      setProjectDraft({ code: '', name: '' });
      void loadProjects();
      notifySuccess('Proje hazır. Şimdi kartlarını ekleyelim.');
    });
  const importExample = () =>
    withBusy(async () => {
      await api.post('/synthetic-clean-water');
      // Örnek proje kartları da katalogya eklendiğinden, akış kartlığı anında
      // seçilebilir kartları göstermek için her iki listeyi birlikte yenile.
      await Promise.all([loadProjects(), loadCards()]);
      notifySuccess('Örnek Temiz Su projesi hazır.');
    });
  const seedStarterCatalog = () =>
    withBusy(async () => {
      const result = await api.post<StarterCatalogSeedResult>('/catalog/starter-pack');
      await loadCards();
      notify(
        result.addedCount
          ? `${result.addedCount} standart kart kütüphaneye eklendi.`
          : 'Standart kütüphane zaten yüklü.',
      );
    });
  const createCatalogType = () =>
    withBusy(async () => {
      if (!typeDraft.code.trim() || !typeDraft.name.trim()) throw new ApiError('Yeni tür için kod ve ad yazın.');
      await api.post<CatalogCardType>('/catalog/types', {
        code: typeDraft.code.trim(),
        name: typeDraft.name.trim(),
        baseCardType: typeDraft.baseCardType,
        allowedParentCardIds: typeDraft.parentCardIds,
        allowedChildCardIds: typeDraft.childCardIds,
        attributeKeys: typeDraft.attributeKeys,
        description: typeDraft.description.trim() || null,
      });
      setTypeDraft({
        code: '',
        name: '',
        baseCardType: 'Material',
        description: '',
        parentCardIds: [],
        childCardIds: [],
        attributeKeys: [],
      });
      setShowTypeDialog(false);
      await loadCatalogTypeSettings();
      notifySuccess('Yeni kart türü global kütüphaneye eklendi.');
    });
  const deleteCatalogType = (type: CatalogCardType) =>
    withBusy(async () => {
      const answer = await ask({
        title: 'Kart türü kaldırılsın mı?',
        description: `“${type.name}” yeni kart seçimlerinden kaldırılacak. Mevcut kartlar ve projeler korunur.`,
        confirmLabel: 'Kaldır',
        danger: true,
      });
      if (!answer) return;
      await api.delete(`/catalog/types/${type.id}`);
      await Promise.all([loadCatalogTypeSettings(), loadCards()]);
      notifySuccess('Kart türü kaldırıldı.');
    });
  const createCard = () =>
    withBusy(async () => {
      if (!cardDraft.name.trim() || !cardDraft.unit.trim()) throw new ApiError('Kart adı ve birimi gerekli.');
      const selectedType = catalogTypes.find((type) => type.id === cardDraft.customTypeId);
      const wasteRatePct = parseDecimal(cardDraft.wasteRatePct);
      if (!Number.isFinite(wasteRatePct) || wasteRatePct < 0)
        throw new ApiError('Fire payını sıfır veya daha büyük bir sayı olarak yazın.');
      const attributeValues = selectedType ? { ...cardDraft.attributeValues } : null;
      if (selectedType && attributeValues) {
        const enabled = new Set(selectedType.attributeKeys.map((key) => key.toLowerCase()));
        if (enabled.has('notes')) {
          if (cardDraft.notes.trim()) attributeValues.Notes = cardDraft.notes.trim();
          else delete attributeValues.Notes;
        }
        if (enabled.has('materialtype')) {
          if (cardDraft.materialType.trim()) attributeValues.MaterialType = cardDraft.materialType.trim();
          else delete attributeValues.MaterialType;
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
        salesConversion:
          cardDraft.variantMode === 'Pipe'
            ? 'StandardLength'
            : variantModeChanged
              ? 'None'
              : (carried?.salesConversion ?? 'None'),
        reportBehavior: typeChanged
          ? effectiveType === 'Material' || effectiveType === 'Accessory'
            ? 'Measurable'
            : 'Folder'
          : carried!.reportBehavior,
        wasteRatePct,
        containerParameter:
          cardDraft.variantMode === 'Pipe' && cardDraft.variants[0]?.standardLength
            ? cardDraft.variants[0].standardLength
            : variantModeChanged
              ? null
              : (carried?.containerParameter ?? null),
        positionNumber: carried?.positionNumber ?? null,
        notes: cardDraft.notes.trim() || null,
        materialType: cardDraft.materialType.trim() || null,
        customTypeId: selectedType?.id ?? null,
        attributeValues,
        variantMode: cardDraft.variantMode,
        variants: cardDraft.variants,
      };
      const created = editingCardId
        ? await api.post<CatalogCard>(`/catalog/cards/${editingCardId}/versions`, payload)
        : await api.post<CatalogCard>('/catalog/cards', payload);
      const wasEditing = Boolean(editingCardId);
      setEditingCardId(null);
      setCardDraft({
        code: '',
        name: '',
        type: 'Material',
        unit: 'adet',
        customTypeId: '',
        attributeValues: {},
        variantMode: 'None',
        variants: [],
        notes: '',
        materialType: '',
        wasteRatePct: '0',
      });
      await loadCards();
      if (addNewCardToFlow && !wasEditing) {
        if (!selectedRevisionId) throw new ApiError('Kartı akışa eklemek için önce bir proje seçin.');
        const placement = await api.post<Placement>(`/revisions/${selectedRevisionId}/placements`, {
          cardVersionId: created.latestVersionId,
          parentPlacementId: selectedPlacementId,
          displayNameOverride: null,
          procurementScope: null,
        });
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
      variants: (card.variants ?? []).map((item) => ({
        ...item,
        compatibleDiameters: item.compatibleDiameters ? [...item.compatibleDiameters] : item.compatibleDiameters,
      })),
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
    window.setTimeout(
      () =>
        document
          .querySelector('.catalog-create-card input[aria-label="Kart adı"]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      60,
    );
  };
  const cancelEditCatalogCard = () => {
    setEditingCardId(null);
    setCardDraft({
      code: '',
      name: '',
      type: 'Material',
      unit: 'adet',
      customTypeId: '',
      attributeValues: {},
      variantMode: 'None',
      variants: [],
      notes: '',
      materialType: '',
      wasteRatePct: '0',
    });
  };
  const addCardToFlow = (cardVersionId: string) =>
    withBusy(async () => {
      if (!selectedRevisionId) throw new ApiError('Önce bir proje seçin.');
      const placement = await api.post<Placement>(`/revisions/${selectedRevisionId}/placements`, {
        cardVersionId,
        parentPlacementId: selectedPlacementId,
        displayNameOverride: null,
        procurementScope: null,
      });
      setShowCardShelf(false);
      await loadRevision(selectedRevisionId);
      setSelectedPlacementId(placement.id);
      notifySuccess('Kart akışa eklendi.');
    });

  const deactivateCard = (card: CatalogCard) =>
    withBusy(async () => {
      const answer = await ask({
        title: 'Kart kütüphaneden kaldırılsın mı?',
        description: `“${card.name}” yeni projelerde seçilemeyecek. Projelerdeki mevcut kullanımları korunur.`,
        confirmLabel: 'Kaldır',
        danger: true,
      });
      if (!answer) return;
      await api.post(`/catalog/cards/${card.id}/deactivate`);
      await loadCards();
      notifySuccess('Kart kütüphaneden kaldırıldı.');
    });
  const deletePlacement = () =>
    withBusy(async () => {
      const placement = selectedPlacement;
      if (!placement || !selectedRevisionId) return;
      const answer = await ask({
        title: 'Kart ve altındakiler silinsin mi?',
        description: `“${placement.displayName}” ve altındaki bütün kartlar, metrajlarıyla birlikte kalıcı olarak silinecek.`,
        confirmLabel: 'Sil',
        danger: true,
      });
      if (!answer) return;
      await api.delete(`/placements/${placement.id}`);
      setSelectedPlacementId(null);
      const remaining = new Set(expandedPlacementIdsRef.current);
      remaining.delete(placement.id);
      setExpandedPlacements(remaining);
      await loadRevision(selectedRevisionId);
      notifySuccess('Seçili kart ve altındaki kartlar silindi.');
    });
  // Backend PUT/DELETE /measurements/{id} uçlarını zaten sunuyordu ama arayüz
  // hiçbirini çağırmıyordu: 12,4 yerine 124 yazan bir kullanıcının o satırı
  // düzeltmesinin veya silmesinin yolu yoktu; tek çare kartın tamamını silmekti.
  const updateMeasurementQuantity = (measurement: Measurement, inputQuantity: number) =>
    withBusy(async () => {
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
  const deleteMeasurement = (measurement: Measurement) =>
    withBusy(async () => {
      await api.delete(`/measurements/${measurement.id}`);
      await loadRevision(selectedRevisionId);
      notifySuccess('Metraj satırı silindi.');
    });
  const savePlacementNotes = () =>
    withBusy(async () => {
      if (!selectedPlacement || !selectedRevisionId) return;
      await api.put(`/placements/${selectedPlacement.id}`, {
        displayNameOverride: selectedPlacement.displayNameOverride ?? null,
        procurementScope: selectedPlacement.procurementScope ?? null,
        notes: placementNotesDraft.trim() || null,
      });
      await loadRevision(selectedRevisionId);
      notifySuccess('Bu karta özel not kaydedildi.');
    });
  const reparent = (connection: Connection) =>
    withBusy(async () => {
      if (!canEdit || !connection.source || !connection.target || connection.source === connection.target) return;
      await api.put(`/placements/${connection.target}/parent`, { parentPlacementId: connection.source });
      await loadRevision(selectedRevisionId);
      notifySuccess('Bağlantı güncellendi.');
    });
  const addMeasurementRows = async (
    rows: Array<{ quantity: number; notes?: string | null; variant?: string | null; secondaryVariant?: string | null }>,
  ) => {
    let saved = false;
    await withBusy(async () => {
      const target =
        selectedPlacement?.isMeasurable && selectedPlacement.inputBehavior !== 'Derived'
          ? selectedPlacement
          : measurablePlacements[0];
      if (!target) throw new ApiError('Önce ölçülebilir bir malzeme kartı seçin.');
      if (!rows.length || rows.some((row) => !Number.isFinite(row.quantity) || row.quantity <= 0))
        throw new ApiError('Miktarı sıfırdan büyük bir sayı olarak yazın.');
      await api.post(
        `/revisions/${selectedRevisionId}/measurements/batch`,
        rows.map((row) => ({
          placementId: target.id,
          inputQuantity: row.quantity,
          inputUnit: target.unit,
          block: measurementDraft.block || null,
          floor: measurementDraft.floor || null,
          room: measurementDraft.room || null,
          zone: null,
          sheet: measurementDraft.sheet || null,
          drawingRevision: null,
          notes: [row.notes, measurementDraft.notes].filter(Boolean).join(' · ') || null,
          sourceKind: 'USER',
          variant: row.variant ?? null,
          secondaryVariant: row.secondaryVariant ?? null,
        })),
      );
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
    const values = measurementDraft.quantity
      .split(/[\n;]/)
      .map((value) => parseDecimal(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (!values.length) {
      fail(new ApiError('Miktarı sayı olarak yazın. Örneğin: 12,5'));
      return;
    }
    void addMeasurementRows(values.map((value) => ({ quantity: value })));
  };
  const clearViewportNudges = useCallback(() => {
    viewportNudgeTimers.current.forEach((timer) => window.clearTimeout(timer));
    viewportNudgeTimers.current = [];
  }, []);

  const nudgeNodeIntoView = useCallback(
    (nodeId: string, delay = 24) => {
      const timer = window.setTimeout(() => {
        viewportNudgeTimers.current = viewportNudgeTimers.current.filter((item) => item !== timer);
        if (!flow) return;
        const nodeElement = [...document.querySelectorAll<HTMLElement>('.react-flow__node')].find(
          (element) => element.dataset.id === nodeId,
        );
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
    },
    [flow],
  );

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
    if (willExpand) next.add(node.id);
    else next.delete(node.id);
    setExpandedPlacements(next);
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
        if (placement.parentPlacementId && ids.has(placement.parentPlacementId) && !ids.has(placement.id)) {
          ids.add(placement.id);
          changed = true;
        }
      });
    }
    return ids;
  }, [placements, reportScopeId]);
  const visibleSummaries = scopedPlacementIds
    ? summaries.filter((item) => scopedPlacementIds.has(item.placementId))
    : summaries;
  const visibleMeasurements = scopedPlacementIds
    ? measurements.filter((item) => scopedPlacementIds.has(item.placementId))
    : measurements;
  const nav: Array<[View, string, string]> = [
    ['flow', 'Proje haritası', 'Kur, seç ve metraj gir'],
    ['catalog', 'Kütüphane', 'Kartlarını yönet'],
    ['settings', 'Ayarlar', 'Proje ve kurallar'],
    ['control', 'Metraj çıktısı', 'Kontrol et ve dışa aktar'],
  ];

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◇</span>
          <span className="brand-name">metraj</span>
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-label={sidebarCollapsed ? 'Sol menüyü aç' : 'Sol menüyü daralt'}
            title={sidebarCollapsed ? 'Sol menüyü aç' : 'Sol menüyü daralt'}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
        </div>
        <div className="project-picker">
          <span className="eyebrow">AÇIK PROJE</span>
          <select value={selectedProjectId} onChange={(event) => selectProject(event.target.value)}>
            <option value="">Proje seç</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button className="text-button" onClick={() => setShowProjectDialog(true)}>
            + Yeni proje
          </button>
        </div>
        <nav>
          {nav.map(([target, title, caption], index) => (
            <button
              key={target}
              title={title}
              aria-label={`${title}: ${caption}`}
              className={`nav-item ${view === target ? 'active' : ''}`}
              onClick={() => setView(target)}
            >
              <span className="nav-number">0{index + 1}</span>
              <span>
                <strong>{title}</strong>
                <small>{caption}</small>
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button onClick={importExample}>Örnek proje aç</button>
          <p>Takıldın mı? Kartı seç, sonra tek parlak düğmeye bas.</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{selectedProject?.code ?? 'BAŞLAMAYA HAZIR'}</span>
            <h1>{selectedProject?.name ?? 'İlk projeni oluşturalım'}</h1>
          </div>
          <div className="topbar-actions">
            <div className="revision-chip">
              {selectedRevision
                ? `${selectedRevision.code} · ${selectedRevision.status === 'Draft' ? 'Düzenlenebilir' : 'Onaylandı'}`
                : 'Proje seçilmedi'}
            </div>
            {selectedProject && (
              <button className="quiet-action" onClick={() => setView('settings')}>
                ⚙ Ayarlar
              </button>
            )}
          </div>
        </header>

        {!selectedProject ? (
          <Welcome onCreate={() => setShowProjectDialog(true)} onExample={importExample} />
        ) : (
          <>
            {view === 'flow' && (
              <section className="flow-page">
                <div className="page-intro">
                  <div>
                    <span className="eyebrow">1. KARTLARI KUR</span>
                    <h2>Projenin haritası</h2>
                    <p>
                      Kartı tutup sahneye bırak. Kartların yanındaki noktalardan sürükleyerek üst–alt ilişkisini
                      değiştir.
                    </p>
                  </div>
                  <div className="intro-actions">
                    <button onClick={() => flow?.fitView({ padding: 0.24, duration: 360 })}>Haritayı sığdır</button>
                    <button className="primary" disabled={!canEdit} onClick={() => setShowCardShelf(true)}>
                      + Kart ekle
                    </button>
                  </div>
                </div>
                <div className="flow-layout">
                  <div className="flow-stage" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
                    <ReactFlow<PlacementNode, Edge>
                      nodes={nodes}
                      edges={edges}
                      nodeTypes={nodeTypes}
                      onInit={setFlow}
                      onNodeClick={selectNode}
                      onNodeDoubleClick={expandNode}
                      onNodesChange={handleNodesChange}
                      onEdgesChange={handleEdgesChange}
                      onConnect={reparent}
                      fitView
                      fitViewOptions={{ padding: 0.24 }}
                      nodesDraggable={canEdit}
                      nodesConnectable={canEdit}
                      elementsSelectable
                    >
                      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#31415d" />
                      <Controls showInteractive={false} />
                      <MiniMap
                        pannable
                        zoomable
                        nodeColor={(node) => TYPE_META[(node.data as Placement).cardType]?.color ?? '#9bacbf'}
                      />
                    </ReactFlow>
                    {!placements.length && (
                      <div className="empty-flow">
                        <span>✦</span>
                        <h3>Harita boş</h3>
                        <p>Sağdaki kartlıktan bir kartı bu alana bırak.</p>
                      </div>
                    )}
                  </div>
                  <Inspector
                    key={selectedPlacement?.id ?? 'empty-inspector'}
                    placement={selectedPlacement}
                    placements={placements}
                    summaries={activeSummaries}
                    measurements={measurements.filter((item) => item.placementId === selectedPlacementId)}
                    allMeasurements={measurements}
                    canEdit={Boolean(canEdit)}
                    busy={busy}
                    draft={measurementDraft}
                    onDraft={setMeasurementDraft}
                    onSubmit={addMeasurement}
                    onSubmitRows={addMeasurementRows}
                    onToggleContext={() => setShowContext(!showContext)}
                    showContext={showContext}
                    placementNotes={placementNotesDraft}
                    onPlacementNotes={setPlacementNotesDraft}
                    onSavePlacementNotes={savePlacementNotes}
                    onUpdateMeasurement={updateMeasurementQuantity}
                    onDeleteMeasurement={deleteMeasurement}
                    uiState={uiState.current}
                    uiStateReady={uiStateReady}
                    onAdd={() => setShowCardShelf(true)}
                    onDelete={deletePlacement}
                    onScope={() => {
                      if (selectedPlacementId) {
                        setReportScopeId(selectedPlacementId);
                        setView('control');
                      }
                    }}
                  />
                </div>
              </section>
            )}

            {view === 'catalog' && (
              <CatalogPage
                addNewCardToFlow={addNewCardToFlow}
                editingCardId={editingCardId}
                cardDraft={cardDraft}
                typeDraft={typeDraft}
                cards={cards}
                catalogTypes={catalogTypes}
                catalogAttributes={catalogAttributes}
                busy={busy}
                showTypeDialog={showTypeDialog}
                onCardDraft={setCardDraft}
                onTypeDraft={setTypeDraft}
                onCreateCard={createCard}
                onEditCard={editCatalogCard}
                onCancelEdit={cancelEditCatalogCard}
                onCreateType={createCatalogType}
                onDeleteType={deleteCatalogType}
                onSeed={seedStarterCatalog}
                onAddCard={addCardToFlow}
                onDeactivateCard={deactivateCard}
                onOpenType={() => setShowTypeDialog(true)}
                onCloseType={() => setShowTypeDialog(false)}
                onClose={() => setShowTypeDialog(false)}
                onBackToFlow={() => {
                  setAddNewCardToFlow(false);
                  setView('flow');
                }}
              />
            )}

            {view === 'settings' && (
              <section className="settings-page">
                <AdvancedControls
                  inline
                  revisions={revisions}
                  selectedRevisionId={selectedRevisionId}
                  canEdit={Boolean(canEdit)}
                  busy={busy}
                  rules={rules}
                  results={calculationResults}
                  responsibilities={responsibilities}
                  backups={backups}
                  integrity={integrity}
                  wasteSettings={wasteSettings}
                  wasteDraft={wasteDraft}
                  placements={placements}
                  selectedPlacementId={selectedPlacementId}
                  calculationTargetId={calculationTargetId}
                  calculationSourceId={calculationSourceId}
                  ruleDraft={ruleDraft}
                  dimensionDraft={dimensionDraft}
                  partyDraft={partyDraft}
                  assignmentDraft={assignmentDraft}
                  onClose={() => setView('flow')}
                  onSelectRevision={setSelectedRevisionId}
                  onCreateDraft={createDraftRevision}
                  onApproveRevision={approveRevision}
                  onRuleDraft={setRuleDraft}
                  onCreateRule={createRule}
                  onCalculationTarget={setCalculationTargetId}
                  onCalculationSource={setCalculationSourceId}
                  onLinkCalculationSource={linkCalculationSource}
                  onRunCalculation={runCalculation}
                  onReviewCalculation={reviewCalculation}
                  onOverrideCalculation={overrideCalculation}
                  onDimensionDraft={setDimensionDraft}
                  onPartyDraft={setPartyDraft}
                  onAssignmentDraft={setAssignmentDraft}
                  onCreateDimension={createDimension}
                  onCreateParty={createParty}
                  onAssign={assignResponsibility}
                  onWasteDraft={setWasteDraft}
                  onSaveWaste={saveWasteSetting}
                  onEditWaste={editWasteSetting}
                  onDeleteWaste={removeWasteSetting}
                  onCreateBackup={createBackup}
                  onCheckIntegrity={checkIntegrity}
                  onRestoreBackup={restoreBackup}
                />
              </section>
            )}

            {view === 'control' && (
              <section className="control-page">
                <div className="page-intro">
                  <div>
                    <span className="eyebrow">METRAJ ÇIKTISI</span>
                    <h2>
                      {reportScopeId
                        ? `${placements.find((item) => item.id === reportScopeId)?.displayName ?? 'Seçili kart'} ve altı`
                        : 'Bütün proje'}
                    </h2>
                    <p>Net, fireli ve satın alma miktarlarını kontrol et; sonra çıktını al.</p>
                  </div>
                  <div className="intro-actions">
                    {reportScopeId && <button onClick={() => setReportScopeId(null)}>Bütün projeyi göster</button>}
                    <a
                      className="download"
                      href={`/api/revisions/${selectedRevisionId}/report/excel${reportScopeId ? `?placementId=${reportScopeId}` : ''}`}
                    >
                      Excel al
                    </a>
                    <a
                      className="download"
                      href={`/api/revisions/${selectedRevisionId}/report/word${reportScopeId ? `?placementId=${reportScopeId}` : ''}`}
                    >
                      Word al
                    </a>
                    <a
                      className="primary download"
                      href={`/api/revisions/${selectedRevisionId}/report/pdf${reportScopeId ? `?placementId=${reportScopeId}` : ''}`}
                    >
                      PDF al
                    </a>
                  </div>
                </div>
                <div className="stat-grid">
                  <Stat label="Malzeme" value={String(visibleSummaries.length)} />
                  <Stat label="Kaynak satırı" value={String(visibleMeasurements.length)} />
                  <Stat
                    label="Bekleyen hesap"
                    value={
                      report
                        ? String(report.calculationChecks.filter((item) => item.status === 'PendingReview').length)
                        : '…'
                    }
                  />
                </div>
                <SummaryTable summaries={visibleSummaries} measurements={visibleMeasurements} placements={placements} />
              </section>
            )}
          </>
        )}
      </section>

      {showCardShelf && (
        <div className="modal-backdrop" onMouseDown={() => setShowCardShelf(false)}>
          <div
            className="modal shelf-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Kütüphaneden kart ekle"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setShowCardShelf(false);
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" aria-label="Kapat" onClick={() => setShowCardShelf(false)}>
              ×
            </button>
            <span className="eyebrow">KÜTÜPHANE</span>
            <h2>{selectedPlacement ? `“${selectedPlacement.displayName}” altına ekle` : 'Haritaya kart ekle'}</h2>
            <p>Bir kart seç veya ihtiyacın olan yeni kartı hemen oluştur.</p>
            <button className="primary new-card-button" onClick={startFirstCardForFlow}>
              + Yeni kart oluştur
            </button>
            <CardShelf cards={cards} onAdd={addCardToFlow} onCreate={startFirstCardForFlow} />
          </div>
        </div>
      )}
      {showProjectDialog && (
        <div className="modal-backdrop" onMouseDown={() => setShowProjectDialog(false)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Yeni proje oluştur"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setShowProjectDialog(false);
            }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button className="modal-close" aria-label="Kapat" onClick={() => setShowProjectDialog(false)}>
              ×
            </button>
            <span className="eyebrow">YENİ PROJE</span>
            <h2>Projenin adını ver</h2>
            <p>Sonra kartlarını haritaya sürükleyerek kurarsın.</p>
            <label>
              Proje kodu
              <input
                autoFocus
                placeholder="Örn. P-001"
                value={projectDraft.code}
                onChange={(event) => setProjectDraft({ ...projectDraft, code: event.target.value })}
              />
            </label>
            <label>
              Proje adı
              <input
                placeholder="Örn. Villa Temiz Su"
                value={projectDraft.name}
                onChange={(event) => setProjectDraft({ ...projectDraft, name: event.target.value })}
              />
            </label>
            <button className="primary full" disabled={busy} onClick={createProject}>
              Projeyi oluştur →
            </button>
          </div>
        </div>
      )}
      {/* Bildirimler ekran okuyucuya da ulaşmalı; önceden yalnızca görsel bir kutuydu. */}
      <div className="toast-region" role="status" aria-live="polite" aria-atomic="true">
        {toast && <div className="toast">{toast}</div>}
      </div>
      {askRequest && <AskDialog request={askRequest} onClose={closeAsk} />}
    </main>
  );
}
