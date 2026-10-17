import type { APIRequestContext, APIResponse } from '@playwright/test';

/** Testlerin kullandığı API yanıtlarının yalnız gereken alanları. */
export interface ApiProject {
  id: string;
  code: string;
  name: string;
  latestRevisionId: string;
}
export interface ApiCard {
  id: string;
  latestVersionId: string;
  code: string;
  name: string;
}
export interface ApiPlacement {
  id: string;
  displayName: string;
  cardCode: string;
  parentPlacementId: string | null;
}
export interface ApiSummary {
  placementId: string;
  placementName: string;
  netQuantity: number;
  withWasteQuantity: number;
  purchaseQuantity: number;
  variant: string | null;
  measurementCount: number;
}
export interface ApiMeasurement {
  id: string;
  placementId: string;
  inputQuantity: number;
  inputUnit: string;
  block: string | null;
  floor: string | null;
  room: string | null;
  variant: string | null;
  notes: string | null;
  secondaryVariant: string | null;
}

export interface CardSeed {
  code: string;
  name: string;
  cardType: 'Category' | 'Scope' | 'System' | 'Material' | 'Accessory';
  unit: string;
  variantMode?: 'None' | 'Pipe' | 'Fitting';
  variants?: Array<{
    code: string;
    label: string;
    standardLength?: number | null;
    compatibleDiameters?: string[];
    compatiblePipeSystems?: string[];
  }>;
  materialType?: string | null;
  wasteRatePct?: number;
  salesConversion?: 'None' | 'StandardLength' | 'Package';
  containerParameter?: number | null;
}

/** Testlerin kendi verisini kurduğu, çalışan yerel API'ye doğrudan konuşan yardımcı. */
export class MetrajApi {
  constructor(
    private readonly request: APIRequestContext,
    readonly baseUrl: string,
  ) {}

  private async json<T>(response: APIResponse, what: string): Promise<T> {
    if (!response.ok()) throw new Error(`${what} başarısız (${response.status()}): ${await response.text()}`);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request.get(`${this.baseUrl}/api${path}`).then((r) => this.json<T>(r, `GET ${path}`));
  }
  post<T>(path: string, data?: unknown): Promise<T> {
    return this.request.post(`${this.baseUrl}/api${path}`, { data }).then((r) => this.json<T>(r, `POST ${path}`));
  }
  put<T>(path: string, data?: unknown): Promise<T> {
    return this.request.put(`${this.baseUrl}/api${path}`, { data }).then((r) => this.json<T>(r, `PUT ${path}`));
  }
  delete<T>(path: string): Promise<T> {
    return this.request.delete(`${this.baseUrl}/api${path}`).then((r) => this.json<T>(r, `DELETE ${path}`));
  }

  /**
   * Çalışma alanını boşaltır: bütün projeler ve arayüzün kalıcı taslakları (hatırlanan
   * seçim, tuş takımı taslakları…). Kart kütüphanesi kalır; testler kendi kartlarını
   * koda göre bulur ya da ekler (`ensureCard`).
   */
  async resetWorkspace() {
    const items = await this.get<Array<{ key: string }>>('/ui-state');
    for (const item of items) await this.delete(`/ui-state?key=${encodeURIComponent(item.key)}`);
    await this.delete('/database/projects');
  }

  async createProject(code: string, name: string): Promise<ApiProject> {
    return this.post<ApiProject>('/projects', { code, name, description: null });
  }

  async importSample(): Promise<{ project: ApiProject }> {
    return this.post('/synthetic-clean-water');
  }

  /** Koda göre bulur; yoksa oluşturur. Kütüphane testler arasında korunduğu için tekrar üretmez. */
  async ensureCard(seed: CardSeed): Promise<ApiCard> {
    const cards = await this.get<ApiCard[]>('/catalog/cards');
    const found = cards.find((card) => card.code === seed.code);
    if (found) return found;
    return this.post<ApiCard>('/catalog/cards', {
      code: seed.code,
      name: seed.name,
      cardType: seed.cardType,
      unit: seed.unit,
      inputBehavior: 'Manual',
      salesConversion: seed.salesConversion ?? 'None',
      reportBehavior: seed.cardType === 'Material' || seed.cardType === 'Accessory' ? 'Measurable' : 'Folder',
      wasteRatePct: seed.wasteRatePct ?? 0,
      containerParameter: seed.containerParameter ?? null,
      positionNumber: null,
      materialType: seed.materialType ?? null,
      variantMode: seed.variantMode ?? 'None',
      variants: seed.variants ?? [],
    });
  }

  async cardByCode(code: string): Promise<ApiCard> {
    const cards = await this.get<ApiCard[]>('/catalog/cards');
    const card = cards.find((item) => item.code === code);
    if (!card) throw new Error(`Kart yok: ${code}`);
    return card;
  }

  addPlacement(revisionId: string, card: ApiCard, parentId: string | null = null, displayName: string | null = null) {
    return this.post<ApiPlacement>(`/revisions/${revisionId}/placements`, {
      cardVersionId: card.latestVersionId,
      parentPlacementId: parentId,
      displayNameOverride: displayName,
      procurementScope: null,
    });
  }

  addMeasurement(
    revisionId: string,
    placementId: string,
    quantity: number,
    unit: string,
    extra: Record<string, unknown> = {},
  ) {
    return this.post<ApiMeasurement>(`/revisions/${revisionId}/measurements`, {
      placementId,
      inputQuantity: quantity,
      inputUnit: unit,
      ...extra,
    });
  }

  summaries(revisionId: string) {
    return this.get<ApiSummary[]>(`/revisions/${revisionId}/measurement-summaries`);
  }
  measurements(revisionId: string) {
    return this.get<ApiMeasurement[]>(`/revisions/${revisionId}/measurements`);
  }
  placements(revisionId: string) {
    return this.get<ApiPlacement[]>(`/revisions/${revisionId}/placements`);
  }
}
