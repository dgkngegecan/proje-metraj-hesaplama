import { createStore, type StoreApi } from 'zustand/vanilla';
import { ApiError } from '../../api.ts';
import type {
  CatalogCard,
  CatalogCardType,
  MaterialWasteSetting,
  Measurement,
  MeasurementSummary,
  Placement,
  Project,
  Revision,
} from '../../types';
import {
  applyPatch,
  emptyEntities,
  entityKey,
  replaceWhere,
  tableFrom,
  upsertMany,
  type Entities,
  type PatchOp,
  type SummaryEntity,
} from './entities.ts';

/**
 * Telefon arayüzünün tek durum deposu (zustand, React'siz çekirdek).
 *
 * Eylemler depo NESNESİNİN dışında, `createAppStore`'un döndürdüğü `actions`
 * içinde durur: durum yalnız veridir, eylemler sahte bir API ile `node:test`
 * altında sınanabilir (tests/mobile-store.test.mjs). Uygulamanın kullandığı
 * tekil örnek `store/runtime.ts`'tedir.
 */

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LoadState {
  status: LoadStatus;
  /** Kullanıcıya gösterilecek Türkçe metin. */
  error: string | null;
  at: number;
}

export interface ResourceState<T = unknown> extends LoadState {
  data: T | undefined;
  /** `invalidateResources` ile bayatlatıldı; ekran açıksa `useResource` yeniden yükler. */
  stale: boolean;
  /** Her bayatlatmada artar; yükleme sürerken gelen bayatlatma kaybolmasın diye. */
  version: number;
}

export interface Selection {
  projectId: string | null;
  revisionId: string | null;
}

export interface AppState {
  entities: Entities;
  selection: Selection;
  /** Koleksiyon yüklemelerinin durumu; anahtarlar `loadKeys` ile üretilir. */
  loads: Readonly<Record<string, LoadState>>;
  /** Ekrana özgü, normalize edilmesi gerekmeyen veriler (rapor, yedekler, hesap kuralları…). */
  resources: Readonly<Record<string, ResourceState>>;
  /** Süren kullanıcı işlemi sayısı; üst çubuktaki ince ilerleme çizgisi buna bakar. */
  busy: number;
  /** Seçili revizyonun verisi her tazelendiğinde artar. */
  dataVersion: number;
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  delete<T = void>(path: string): Promise<T>;
}

export const loadKeys = {
  projects: 'projects',
  revisions: (projectId: string) => `revisions:${projectId}`,
  revision: (revisionId: string) => `revision:${revisionId}`,
  catalog: 'catalog',
  wasteSettings: 'waste-settings',
} as const;

export const GENERIC_ERROR_MESSAGE = 'Bir şey ters gitti. Tekrar deneyin.';

/** Hatadan kullanıcıya gösterilecek metin: `ApiError` kendi Türkçe metnini taşır. */
export function errorMessage(error: unknown, fallback = GENERIC_ERROR_MESSAGE): string {
  return error instanceof ApiError && error.message ? error.message : fallback;
}

export function initialAppState(): AppState {
  return {
    entities: emptyEntities(),
    selection: { projectId: null, revisionId: null },
    loads: {},
    resources: {},
    busy: 0,
    dataVersion: 0,
  };
}

const MAX_RESOURCES = 40;

export interface AppStoreDeps {
  api: ApiClient;
  now?: () => number;
}

export function createAppStore(deps: AppStoreDeps) {
  const { api } = deps;
  const now = deps.now ?? Date.now;
  const store: StoreApi<AppState> = createStore<AppState>()(() => initialAppState());
  const sequences = new Map<string, number>();

  const setLoad = (key: string, load: LoadState) =>
    store.setState((state) => ({ loads: { ...state.loads, [key]: load } }));

  const setEntities = (update: (entities: Entities) => Entities) =>
    store.setState((state) => {
      const entities = update(state.entities);
      return entities === state.entities ? state : { entities };
    });

  /**
   * Yarış korumalı yükleme. Aynı anahtar için yeni bir yükleme başladıysa eskisinin
   * yanıtı YAZILMAZ: hızlı proje değiştiren kullanıcıda geç gelen eski proje
   * listesi yenisini ezmesin (masaüstündeki revisionLoadSequence ile aynı ders).
   * Önceki veri yükleme sürerken ekranda kalır; iskelet yalnız ilk yüklemede görünür.
   */
  async function load<T>(
    key: string,
    fetcher: () => Promise<T>,
    commit: (value: T) => boolean | void,
  ): Promise<boolean> {
    const sequence = (sequences.get(key) ?? 0) + 1;
    sequences.set(key, sequence);
    setLoad(key, { status: 'loading', error: null, at: now() });
    try {
      const value = await fetcher();
      if (sequences.get(key) !== sequence) return false;
      const committed = commit(value) !== false;
      setLoad(key, { status: committed ? 'ready' : 'idle', error: null, at: now() });
      return committed;
    } catch (error) {
      if (sequences.get(key) !== sequence) return false;
      setLoad(key, { status: 'error', error: errorMessage(error), at: now() });
      return false;
    }
  }

  async function loadProjects() {
    return load(
      loadKeys.projects,
      () => api.get<Project[]>('/projects'),
      (projects) => setEntities((entities) => ({ ...entities, projects: tableFrom(projects, entityKey.projects) })),
    );
  }

  async function loadRevisions(projectId: string) {
    return load(
      loadKeys.revisions(projectId),
      () => api.get<Revision[]>(`/projects/${projectId}/revisions`),
      (revisions) =>
        setEntities((entities) => ({
          ...entities,
          revisions: replaceWhere(
            entities.revisions,
            (item) => item.projectId === projectId,
            revisions,
            entityKey.revisions,
          ),
        })),
    );
  }

  /**
   * Seçili revizyonun ağacı, ölçümleri ve özetleri. Yalnız etkin revizyonun
   * verisi bellekte tutulur: başka bir revizyona geçildiyse geç gelen yanıt
   * yazılmaz, yazıldığında da önceki revizyonların satırları atılır.
   */
  async function loadRevisionData(revisionId: string) {
    return load(
      loadKeys.revision(revisionId),
      () =>
        Promise.all([
          api.get<Placement[]>(`/revisions/${revisionId}/placements`),
          api.get<Measurement[]>(`/revisions/${revisionId}/measurements`),
          api.get<MeasurementSummary[]>(`/revisions/${revisionId}/measurement-summaries`),
        ]),
      ([placements, measurements, summaries]) => {
        if (store.getState().selection.revisionId !== revisionId) return false;
        const tagged: SummaryEntity[] = summaries.map((summary) => ({ ...summary, revisionId }));
        store.setState((state) => ({
          entities: {
            ...state.entities,
            placements: tableFrom(placements, entityKey.placements),
            measurements: tableFrom(measurements, entityKey.measurements),
            summaries: tableFrom(tagged, entityKey.summaries),
          },
          dataVersion: state.dataVersion + 1,
        }));
        return true;
      },
    );
  }

  /** Yalnız özetleri tazeler (ör. bir ölçüm kaydından sonra; ağaç ve ölçümler zaten güncel). */
  async function refreshSummaries(revisionId: string) {
    return load(
      `summaries:${revisionId}`,
      () => api.get<MeasurementSummary[]>(`/revisions/${revisionId}/measurement-summaries`),
      (summaries) => {
        if (store.getState().selection.revisionId !== revisionId) return false;
        const tagged: SummaryEntity[] = summaries.map((summary) => ({ ...summary, revisionId }));
        store.setState((state) => ({
          entities: {
            ...state.entities,
            summaries: replaceWhere(
              state.entities.summaries,
              (item) => item.revisionId === revisionId,
              tagged,
              entityKey.summaries,
            ),
          },
          dataVersion: state.dataVersion + 1,
        }));
        return true;
      },
    );
  }

  async function loadCatalog() {
    return load(
      loadKeys.catalog,
      () => Promise.all([api.get<CatalogCard[]>('/catalog/cards'), api.get<CatalogCardType[]>('/catalog/types')]),
      ([cards, types]) =>
        setEntities((entities) => ({
          ...entities,
          cards: tableFrom(cards, entityKey.cards),
          catalogTypes: tableFrom(types, entityKey.catalogTypes),
        })),
    );
  }

  async function loadWasteSettings() {
    return load(
      loadKeys.wasteSettings,
      () => api.get<MaterialWasteSetting[]>('/settings/material-waste'),
      (settings) =>
        setEntities((entities) => ({ ...entities, wasteSettings: tableFrom(settings, entityKey.wasteSettings) })),
    );
  }

  function selectRevision(revisionId: string | null) {
    const current = store.getState().selection;
    if (current.revisionId === revisionId) return Promise.resolve(true);
    store.setState({ selection: { ...current, revisionId } });
    return revisionId ? loadRevisionData(revisionId) : Promise.resolve(true);
  }

  /**
   * Proje seçimi bağımlı seçimleri de sıfırlar (masaüstünde eski projenin kartı
   * "bu daldan metraj" başlığında kalıyordu). Tercih edilen revizyon bu projeye
   * aitse o, değilse sunucunun ilk döndürdüğü (en yeni) revizyon açılır.
   */
  async function selectProject(projectId: string | null, preferredRevisionId?: string | null) {
    store.setState({ selection: { projectId, revisionId: null } });
    if (!projectId) return true;
    const loaded = await loadRevisions(projectId);
    if (!loaded || store.getState().selection.projectId !== projectId) return false;
    const revisions = [...store.getState().entities.revisions.byId.values()].filter(
      (item) => item.projectId === projectId,
    );
    const preferred = revisions.find((item) => item.id === preferredRevisionId);
    const ordered = store.getState().entities.revisions.ids.filter((id) => revisions.some((item) => item.id === id));
    return selectRevision(preferred?.id ?? ordered[0] ?? null);
  }

  /**
   * Açılış: projeler → (hatırlanan veya ilk) proje → revizyon → ağaç.
   * Tercih bir söz (promise) olabilir: hatırlanan seçim `/ui-state`'ten okunurken
   * proje listesi paralel yüklenir, açılışa bir gidiş-dönüş eklenmez.
   */
  async function bootstrap(preferredInput: Partial<Selection> | Promise<Partial<Selection>> = {}) {
    const [loaded, preferred] = await Promise.all([
      loadProjects(),
      Promise.resolve(preferredInput).catch((): Partial<Selection> => ({})),
    ]);
    if (!loaded) return false;
    const projects = store.getState().entities.projects;
    const projectId =
      preferred.projectId && projects.byId.has(preferred.projectId) ? preferred.projectId : (projects.ids[0] ?? null);
    return selectProject(projectId, preferred.revisionId ?? null);
  }

  /** Seçili revizyonun verisini yeniden yükler (ör. çekip yenileme, geri yükleme sonrası). */
  function refreshRevision() {
    const { revisionId } = store.getState().selection;
    return revisionId ? loadRevisionData(revisionId) : Promise.resolve(true);
  }

  /** Kullanıcı işlemi süresince meşgul göstergesini açar; hata çağırana geri atılır. */
  async function withBusy<T>(work: () => Promise<T>): Promise<T> {
    store.setState((state) => ({ busy: state.busy + 1 }));
    try {
      return await work();
    } finally {
      store.setState((state) => ({ busy: Math.max(0, state.busy - 1) }));
    }
  }

  async function createProject(input: { code: string; name: string; description?: string | null }) {
    return withBusy(async () => {
      const created = await api.post<Project>('/projects', {
        code: input.code.trim(),
        name: input.name.trim(),
        description: input.description ?? null,
      });
      // Listeye hemen eklenir; yenileme beklenirken "proje yok" ekranına düşülmez.
      setEntities((entities) => ({
        ...entities,
        projects: upsertMany(entities.projects, [created], entityKey.projects, 'start'),
      }));
      void loadProjects();
      await selectProject(created.id);
      return created;
    });
  }

  async function importSampleProject() {
    return withBusy(async () => {
      await api.post('/synthetic-clean-water');
      await Promise.all([loadProjects(), loadCatalog()]);
      const { projectId } = store.getState().selection;
      if (!projectId) {
        const first = store.getState().entities.projects.ids[0];
        if (first) await selectProject(first);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Ekrana özgü kaynaklar
  // -------------------------------------------------------------------------

  async function loadResource<T>(key: string, fetcher: () => Promise<T>): Promise<T | undefined> {
    const sequence = (sequences.get(`resource:${key}`) ?? 0) + 1;
    sequences.set(`resource:${key}`, sequence);
    const startVersion = store.getState().resources[key]?.version ?? 0;
    store.setState((state) => {
      const previous = state.resources[key];
      const resources: Record<string, ResourceState> = {
        ...state.resources,
        [key]: {
          data: previous?.data,
          stale: previous?.stale ?? false,
          version: previous?.version ?? 0,
          status: 'loading',
          error: null,
          at: now(),
        },
      };
      return { resources: pruneResources(resources, key) };
    });
    const finish = (update: (previous: ResourceState | undefined) => ResourceState) =>
      store.setState((state) => ({ resources: { ...state.resources, [key]: update(state.resources[key]) } }));
    try {
      const data = await fetcher();
      if (sequences.get(`resource:${key}`) !== sequence) return data;
      finish((previous) => ({
        data,
        // Yükleme sürerken bayatlatıldıysa bu yanıt da bayattır; ekran yeniden ister.
        stale: (previous?.version ?? 0) !== startVersion,
        version: previous?.version ?? 0,
        status: 'ready',
        error: null,
        at: now(),
      }));
      return data;
    } catch (error) {
      if (sequences.get(`resource:${key}`) !== sequence) return undefined;
      finish((previous) => ({
        data: previous?.data,
        stale: previous?.stale ?? false,
        version: previous?.version ?? 0,
        status: 'error',
        error: errorMessage(error),
        at: now(),
      }));
      return undefined;
    }
  }

  /** Öneki tutan kaynakları bayat işaretler; açık ekrandaki `useResource` yeniden yükler. */
  function invalidateResources(prefix: string) {
    store.setState((state) => {
      let changed = false;
      const resources: Record<string, ResourceState> = { ...state.resources };
      for (const [key, value] of Object.entries(state.resources)) {
        if (!key.startsWith(prefix)) continue;
        resources[key] = { ...value, stale: true, version: value.version + 1 };
        changed = true;
      }
      return changed ? { resources } : state;
    });
  }

  function pruneResources(resources: Record<string, ResourceState>, keep: string) {
    const keys = Object.keys(resources);
    if (keys.length <= MAX_RESOURCES) return resources;
    const oldest = keys
      .filter((key) => key !== keep && resources[key]?.status !== 'loading')
      .sort((a, b) => (resources[a]?.at ?? 0) - (resources[b]?.at ?? 0))
      .slice(0, keys.length - MAX_RESOURCES);
    const next = { ...resources };
    for (const key of oldest) delete next[key];
    return next;
  }

  /** Varlık yaması uygular ve ters yamayı döndürür (iyimser güncellemenin temeli). */
  function patchEntities(ops: readonly PatchOp[]): PatchOp[] {
    let inverse: PatchOp[] = [];
    setEntities((entities) => {
      const result = applyPatch(entities, ops);
      inverse = result.inverse;
      return result.entities;
    });
    return inverse;
  }

  const actions = {
    loadProjects,
    loadRevisions,
    loadRevisionData,
    refreshSummaries,
    refreshRevision,
    loadCatalog,
    loadWasteSettings,
    selectProject,
    selectRevision,
    bootstrap,
    withBusy,
    createProject,
    importSampleProject,
    loadResource,
    invalidateResources,
    patchEntities,
  };

  return { store, actions };
}

export type AppActions = ReturnType<typeof createAppStore>['actions'];
