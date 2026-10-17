# Mobil arayüz mimarisi (Dalga 2 kılavuzu)

Telefon arayüzü `mobile.html` → `src/mobile/main.tsx` girişidir. Masaüstü (`index.html` → `src/App.tsx`, React Flow
tuvali) ondan bağımsızdır. Paylaşılanlar: `src/api.ts`, `src/types.ts`, `src/lib/*` (React Flow'a bağlı olan
`lib/flow.ts` ve `lib/uiTypes.ts` HARİÇ), `src/uiState.ts`. Kararların gerekçesi: `docs/android-mobil-plan.md`.

## Çalıştırma

```sh
npm run dev                                      # http://localhost:5173/mobile.html (API vekili yok)
METRAJ_API_URL=http://127.0.0.1:54321 npm run dev  # /api → çalışan masaüstü yerel API'si
npm run build                                    # masaüstü + mobil (dist/index.html, dist/mobile.html)
npm test                                         # node:test, tests/**/*.test.mjs
npm run check:mobile                             # dist/ üzerinde bütçe + React Flow denetimi (tablo basar)
```

Telefon görünümü için tarayıcıda 375×812 dokunmatik öykünme kullanın. Köprü (`window.MetrajBridge`) yalnız Android'de
vardır; tarayıcıda her şey `fetch` ile çalışır.

## Klasör düzeni ve sahiplik

| Klasör              | İçerik                                                   | Sahibi                |
| ------------------- | -------------------------------------------------------- | --------------------- |
| `screens/project/`  | Proje ağacı, kart ekleme, ölçüm girişleri, notlar        | **Ajan 5**            |
| `screens/output/`   | Özet/çıktı, rapor, alt ağaç kapsamı, hesap kontrolleri   | **Ajan 6**            |
| `screens/library/`  | Kütüphane, kart düzenleyici, tipler                      | **Ajan 6**            |
| `screens/settings/` | Revizyonlar, fire, hesap kuralları, sorumluluk, yedekler | **Ajan 6**            |
| `store/`            | Durum deposu (normalize varlıklar, eylemler, taslaklar)  | ortak (Ajan 3 temeli) |
| `shell/`            | Kabuk: gezinme, geri yığını, panel, bildirim, durumlar   | ortak (Ajan 3 temeli) |
| `components/`       | Ortak dokunmatik bileşenler                              | ortak (Ajan 3 temeli) |
| `styles/`           | Tasarım değişkenleri ve ortak stiller                    | ortak (Ajan 3 temeli) |

- Her sekmenin varsayılan dışa aktarımı bir bileşendir (`export default function ProjectScreen()`); `shell/AppShell.tsx`
  onu `React.lazy` ile yükler. Dosya adını değiştirmeyin; yeni ekranlar aynı klasörde yeni dosyalardır.
- Mevcut ekranlar **yer tutucudur**: temelin uçtan uca çalıştığını gösterirler, istediğiniz gibi yeniden yazın.
- Ortak klasörlerde değişiklik gerekiyorsa küçük ve geriye uyumlu tutun, raporunuzda belirtin (iki ajan aynı dosyaya
  yazarsa birleştirme çakışır). Ekrana özgü stil kendi klasörünüzde bir `.css` dosyasıdır.
- Kök `.gitignore` her `output/` klasörünü yok sayar; `screens/.gitignore` bunu `screens/output` için geri alır.
  Yeni bir `output/` klasörü açmayın.

## Taşıma (`src/api.ts`)

Masaüstü imzaları aynen: `api.get/post/put/delete/upload`. Hata her iki taşımada aynıdır: `ApiError(message, rule,
isServerFault)`; `message` Türkçe ve kullanıcıya gösterilebilir. Köprü arızası `rule: 'transport.timeout' |
'transport.unavailable'`, `isServerFault: true` olur.

```ts
// Rapor / dışa aktarma: köprüde "Paylaş / Cihaza kaydet" paneli, tarayıcıda dosya indirme.
const result = await api.download(`/revisions/${id}/report/pdf`, `${project.code}-${revision.code}.pdf`);
// result.outcome: 'share' | 'saveAs' | 'browser' | 'cancelled'; ad önce sunucudan gelir.

// .metraj içe aktarma (ekleyerek). Onayı ÇAĞIRMADAN ÖNCE sorun: köprüde seçim ve içe aktarma tek adımdır.
const imported = await api.importWorkspace(); // vazgeçilirse null
```

- `api.upload` köprüde çalışmaz (ikili içerik köprüden geçmez); dosya girişi yalnız `importWorkspace` ile.
- Köprü komutları/olayları gerekiyorsa: `sendBridgeCommand`, `onBridgeEvent`, `isBridgeAvailable`
  (`src/lib/transport.ts`). Genellikle gerekmez: `haptic`, `ready`, `exitApp`, `back`, `pause` kabukta bağlıdır.
- Zaman aşımı: rapor, yedek, içe/dışa aktarma ve tohumlama 5 dk; diğerleri 60 sn (`bridgeTimeoutFor`).

## Durum deposu (`store/`)

Tek zustand deposu; ekranlar `import { … } from '../../store'` ile kullanır.

**Varlıklar** `appStore.getState().entities`: `projects, revisions, cards, catalogTypes, placements, measurements,
summaries, wasteSettings`. Her biri `{ byId: Map, ids: string[] }`; değişmeyen tablo aynı referansla kalır. Özet
anahtarı `summaryKey(s)` (yerleşim + varyantlar); özetlere `revisionId` eklenir. Yalnız seçili revizyonun ağacı,
ölçümleri ve özetleri bellekte tutulur.

**Kancalar** (yalnız ihtiyacınız olan dilimi seçin; `useAppStore((s) => s)` YAPMAYIN):
`useProjects, useSelectedProject, useSelectedRevision, useSelection, useIsRevisionLocked, useRevisionsOf(projectId),
usePlacements(revisionId), usePlacementTree(revisionId), useMeasurementsOf(placementId), useSummariesOf(placementId),
useRevisionSummaries(revisionId), useLoad(key), useBusy, useAppStore(selector)`. Türetilmiş dizi döndüren kendi
seçicinizi yazacaksanız önbellekleyin (`selectors.ts` desenleri); her çağrıda yeni dizi = sonsuz çizim döngüsü.

**Eylemler** `actions.*`: `loadProjects, loadRevisions, loadRevisionData, refreshSummaries(revisionId),
refreshRevision, loadCatalog, loadWasteSettings, selectProject, selectRevision, bootstrap, createProject,
importSampleProject, withBusy, patchEntities, loadResource, invalidateResources`. Yükleme durumu
`useLoad(loadKeys.revision(id))` → `{ status: 'idle'|'loading'|'ready'|'error', error }`. Yüklemeler yarış korumalıdır.

**Ekrana özgü veri** (rapor, yedekler, hesap kuralları…) normalize edilmez, önbelleğe alınır:

```ts
const report = useResource(revisionId && `report:${revisionId}:${scope ?? 'all'}`, () =>
    api.get<ReportData>(`/revisions/${revisionId}/report${scope ? `/subtree/${scope}` : ''}`),
);
// Veri değişince: actions.invalidateResources(`report:${revisionId}`) → açık ekran kendiliğinden yeniden yükler.
```

**İyimser güncelleme** — önce depo, hata olursa YALNIZ bu işlemin dokunduğu kayıtlar geri alınır ve hata bildirimi
gösterilir:

```ts
const temp = { ...draftMeasurement, id: temporaryId() };
const outcome = await runOptimistic(appStore, {
    ops: [patch.upsert('measurements', [temp], 'start')],
    request: () => api.post<Measurement>(`/revisions/${revisionId}/measurements`, payload),
    reconcile: (saved) => [patch.remove('measurements', [temp.id]), patch.upsert('measurements', [saved], 'start')],
});
if (outcome.ok) void actions.refreshSummaries(revisionId); // özetler sunucuda hesaplanır
```

**Silme onay penceresi açmaz**, "Geri al" çubuğu gösterir; istek süre dolunca (5 sn), çubuk başka bildirimle
değişince veya uygulama arka plana geçince gider; sunucu reddederse kayıt geri gelir:

```ts
removeWithUndo(appStore, {
    ops: [patch.remove('placements', subtreeIds(placements, id))],
    commit: () => api.delete(`/placements/${id}`),
    message: `“${placement.displayName}” ve altındakiler silindi.`,
    onCommitted: () => void actions.refreshRevision(),
});
```

**Kalıcı taslaklar** — masaüstündeki `/ui-state` mekanizması, aynı anahtar deseni (`{tür}.v1.{kimlik}`). Yazımlar
biriktirilir (400 ms, en geç 2 sn) ve uygulama arka plana geçerken boşaltılır:

```ts
const [counts, setCounts] = useDraft(draftKey('fitting-draft', placement.id), {} as Record<string, number>);
setCounts(null); // taslağı sil
```

Masaüstüyle aynı biçimi kullanıyorsanız aynı anahtarı kullanın (`fitting-draft`, `radiator-draft`, `pipe-boxes`);
biçim değişirse sürümü artırın (`draftKey(tür, id, 2)`). Hidrasyon `useDraftsReady()` true olmadan yapılmamalı
(`useDraft` bunu kendisi yapar).

## Kabuk (`shell/`)

- **Sekmeler ve iç içe gezinme**: `shellActions.push({ screen: 'placement', params: { id } }, 'project')`, `pop()`,
  `replace()`, `popToRoot()`, `setTab(tab)`; okumak için `useTopRoute('project')`. Desen (`screens/project`): kök
  katman hep bağlı kalır (`hidden`), iç ekran üstte ayrı katmanda çizilir → geri dönünce kaydırma konumu korunur.
  İç ekranın başlığı `ScreenHeader` (← düğmesi `requestBack()` çağırır).
- **Geri tuşu**: sıra `panel → iç içe seviye → başlangıç sekmesi → uygulamadan çıkış`. Kendi durumunuz için
  `useBackHandler(() => { if (!editing) return false; setEditing(false); })` (`false` = işlemedim).
  `BottomSheet` geri tuşunu kendisi işler.
- **Alttan panel**: `<BottomSheet open onClose title footer size="auto|tall|full" dismissible>`; odak tuzağı,
  aria-modal, sürükleyerek kapatma ve klavye payı hazır. Uzun basma menüsü: `ActionSheet`. Ölçüm girişi:
  `KeypadSheet`.
- **Bildirim**: `notify(metin)`, `notifySuccess(metin)` (titreşimli), `notifyError(hata, yedekMetin?)`.
- **Durumlar**: `EmptyState` (ne olduğu + sonraki adım), `ErrorState` (+ "Tekrar dene"), `SkeletonList` (ilk
  yüklemede; sonraki yüklemelerde eski veri ekranda kalır), `Spinner`. Meşgul çizgisi `actions.withBusy` ile yanar.
- **Kilit**: onaylı revizyonda `useIsRevisionLocked()` true olur ve kabuk kalıcı şerit gösterir; ekranlar düzenleme
  yollarını kapatmalı (sunucu da reddeder).
- **Açılış**: `ready` komutu proje ağacı yüklenince (en geç 1,2 sn) gider; `performance.mark('metraj:ready')` ölçüm
  işaretidir. Açılışta ek bir istek eklemeyin; katalog ve ekrana özgü veri ekran açılınca yüklenir.

## Ortak bileşenler (`components/`)

| Bileşen                         | Kullanım                                                                                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NumericKeypad` / `KeypadSheet` | `value`/`onChange` (ifade metni), `onSave(result)`, `onSaveNext?`, `label`, `unit`, `validate`, `busy`. `result.value` kesin ondalık metin (nokta ayırıcılı), `result.number` = `parseDecimal(value)`, `result.exact` JSON'a sayı olarak yazılınca kayıp olmayacağını söyler. |
| `evaluateExpression(metin)`     | Saf ayrıştırıcı: virgül/nokta, `+ − ×` (çarpma önce), parantez yok, .NET `decimal` sınırları.                                                                                                                                                                                 |
| `Stepper`                       | Büyük +/−; uzun basınca hızlanır, 15 tekrardan sonra beşer. `spinbutton` erişilebilirliği.                                                                                                                                                                                    |
| `ChipGrid`                      | `mode="single"` (radiogroup) veya `"multiple"`; `badge` ile bekleyen adet gösterilebilir.                                                                                                                                                                                     |
| `SearchableList`                | Sanallaştırılmış liste + Türkçe duyarlı arama (`searchText`), `emptyState`, `noResultsState`, `header`. 2.000 satırda yalnız görünenler çizilir.                                                                                                                              |
| `SwipeRow`                      | Sola kaydırınca eylemler; `fullSwipeActionId` ile tam kaydırma (sil). `onLongPress` → aynı eylemlerle `ActionSheet` açın (kaydıramayan kullanıcının yolu).                                                                                                                    |
| `useLongPress`, `haptic('tick'  | 'confirm'                                                                                                                                                                                                                                                                     | 'reject')`, `Icon` | Uzun basma, titreşim, satır içi SVG simgeler. |

## Stil kuralları

- Sınıflar `m-` önekli; renk/boşluk/yarıçap DEĞERİ yazmayın, `styles/tokens.css` değişkenlerini kullanın (açık/koyu
  tema ve yüksek kontrast oradan gelir).
- Her dokunma hedefi ≥ `--touch-min` (48 px); ana eylemler alt bölgede (`.m-bottom-actions`). Güvenli alan
  değişkenleri: `--safe-top/right/bottom/left`.
- Hiçbir işlev hover'a bağlı olamaz; hover süslemesi `@media (hover: hover)` arkasında. Animasyonlar
  `--duration-*` kullanır (azaltılmış harekette 0).
- Ağdan font, görsel veya betik yok; `mobile.html` derlemede `'self'` dışını yasaklayan bir CSP alır.

## Test deseni

Saf mantık `.ts` dosyalarında, React'siz ve DI'li yazılır; `tests/*.test.mjs` bunları `node:test` ile doğrudan içe
aktarır (Node 24 tip ayıklama). Bunun için: göreli **çalışma zamanı** içe aktarmaları `.ts` uzantılı yazın
(`import { x } from './y.ts'`), yalnız tip içe aktarmaları `import type`; `enum`, `namespace`, parametre özellikleri
kullanmayın. `.tsx` bileşenleri bu testlerde içe aktarılamaz; mantığı bileşenden ayırın (örn. `keypad/expression.ts`,
`swipe.ts`, `store/optimistic.ts`). Depo eylemleri için `createAppStore({ api: sahteApi })`.

## Bütçeler (plan belgesi)

| Ölçüt                                | Hedef         | Bugün                                                                 |
| ------------------------------------ | ------------- | --------------------------------------------------------------------- |
| Mobil ilk JS (giriş + Proje sekmesi) | < 250 kB gzip | ~95 kB (`npm run check:mobile`)                                       |
| React Flow mobil grafikte            | 0             | 0 (`tests/mobile-bundle.test.mjs`, `tests/mobile-isolation.test.mjs`) |
| Dokunuş → görsel tepki               | < 100 ms      | iyimser güncelleme; kayıt beklenmez                                   |
| 2.000 satır kaydırma                 | 60 fps        | `SearchableList` sanallaştırması                                      |

Ağır bir bağımlılık eklemeden önce `npm run build && npm run check:mobile` çalıştırın; başlangıç sekmesine
(Proje) giren her kod ilk JS'e sayılır, diğer sekmeler tembeldir.
