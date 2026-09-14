export class ApiError extends Error {
  /** Kararlı kural kodu (örn. "measurement.unit"). Arayüz gerekirse buna göre dallanabilir. */
  readonly rule: string;
  /** Sunucu arızası mı, kullanıcının düzeltebileceği bir durum mu? */
  readonly isServerFault: boolean;

  constructor(message: string, rule = '', isServerFault = false) {
    super(message);
    this.rule = rule;
    this.isServerFault = isServerFault;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    // init önce yayılır: bir çağıran kendi başlıklarını verirse, aşağıdaki
    // birleştirilmiş nesne onu ezmek yerine içerir.
    ...init,
    headers: init?.body && !isFormData ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.message ?? 'İşlem tamamlanamadı.', body.rule ?? '', response.status >= 500);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T = void>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: <T>(path: string, form: FormData) => request<T>(path, { method: 'POST', body: form }),
};
