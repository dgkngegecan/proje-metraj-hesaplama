# Android Mobil Sürüm — Plan ve Eşleştirme Listesi

**Dal:** `feature/android-mobile` · **Durum:** Dalga 0 (hazırlık) · **Tarih:** 2026-10-17

Bu belge alt ajanların ortak başvuru kaynağıdır. Her ajan işe başlamadan önce burayı okur; kapsam dışına çıkmaz.

## Kilitlenmiş kararlar

1. Domain / Application / Infrastructure **değişmeden** yeniden kullanılır. Hesap, rapor ve revizyon mantığının ikinci bir kopyası yazılmaz — iki kopya zamanla ayrışır ve "yanlış sayıya güvenme" (T0) hatası doğar.
2. Android kabuğu saf **.NET for Android** (`net10.0-android`) — MAUI değil. Arayüz zaten web; MAUI yalnız açılış süresi ve APK boyutu ekler.
3. Android'de ASP.NET Core / Kestrel yok. Uç nokta mantığı taşıma katmanından bağımsız bir **`MetrajRequestRouter`**'a taşınır; masaüstündeki `LocalApiHost` da bu router'a yönlenir. İki platform **tek rota tablosu** kullanır.
4. WebView ↔ .NET iletişimi süreç içi **`WebMessageListener`** köprüsüyle yapılır (yalnız `https://appassets.androidplatform.net` origin'i). Yerel HTTP portu açılmaz — cihazdaki başka uygulamalar loopback portuna erişebilirdi.
5. Büyük ikili içerik (rapor, `.metraj`) köprüden JSON olarak geçmez; yerel tarafta dosyaya yazılır, SAF/paylaşım menüsüyle verilir.
6. **Tamamen yerel:** manifestte `INTERNET` izni yok, `allowBackup="false"` + `dataExtractionRules`. Veri `Context.FilesDir` altında.
7. Mobil arayüz ayrı bir Vite girişi (`mobile.html`). React Flow mobil pakete **girmez**. `types.ts`, `lib/*`, `api.ts` paylaşılır; masaüstü paketi davranış değiştirmez.
8. Android projesi ayrı `Metraj.Mobile.sln` içinde durur; `Metraj.sln` ve masaüstü CI Android iş yükü gerektirmez.

## Alt ajan dağılımı (en fazla 8)

| # | İş | Ajan | Model / efor | Dalga | Bağımlılık |
|---|---|---|---|---|---|
| 1 | Router refaktörü | genel | opus / xhigh | 1 | — |
| 2 | Font / platform uyumu (önce test) | `ecc:tdd-guide` | sonnet / high | 1 | — |
| 3 | Mobil arayüz temeli | genel | opus / xhigh | 1 | — |
| 4 | Android kabuğu | genel | opus / high | 2 | 1, 2 |
| 5 | Proje ve giriş ekranları | genel | sonnet / high | 2 | 3 |
| 6 | Kütüphane, çıktı, ayar ekranları | genel | sonnet / high | 2 | 3 |
| 7 | Telefon e2e + performans | `ecc:e2e-runner` | sonnet / high | 3 | 4, 5, 6 |
| 8 | Son kod incelemesi | `ecc:code-reviewer` | sonnet / high | 3 | 4, 5, 6 |

Aynı dalgadaki yazıcı ajanlar ayrı worktree'lerde çalışır ve birbirinin dosyasına dokunmaz. Orkestratör dalları birleştirir.

## Ortak çalışma kuralları (bütün ajanlar)

- **C: diskine yazılmaz.** Her PowerShell komutundan önce `. D:\toolchain\env.ps1`, her Bash komutundan önce `source /d/toolchain/env.sh`. `dotnet` olarak her zaman `D:\toolchain\dotnet\dotnet.exe` kullanılır (SDK 10.0.400, `global.json` ile aynı); NuGet, npm, TEMP, Android ve Playwright yolları D:'ye gider. Sistemdeki `C:\Program Files\dotnet` kullanılmaz.
- Güvenlik paketi düzeltmesi (Ajan 2) birleşene kadar diğer ajanlar `dotnet restore/build/test` komutlarına `-p:NuGetAudit=false` ekler. Bunun dışında hiçbir uyarı bastırılmaz; `TreatWarningsAsErrors` açık kalır.
- Her ajan yalnız kendi dosya alanına yazar (aşağıdaki tablo), kendi worktree dalında Türkçe, açıklayıcı commit'ler atar, **push etmez**.
- Mevcut 133 xUnit testi ve `src/Metraj.Web/tests` testleri sözleşmedir: değiştirilmez, silinmez, gevşetilmez. Davranış bilerek değişiyorsa ajan durur ve raporunda söyler.
- GateGuard kancası ilk Bash/Write çağrısında olgu ister: istenen olguları yazıp aynı çağrıyı tekrarlayın.
- **Gerçek çekirdeğe karşı geliştirme:** `tools/Metraj.DevServer` yerel API'yi penceresiz başlatır (göç + standart katalog dahil). `dotnet run --project tools/Metraj.DevServer -c Release -- --db D:\toolchain\tmp\<ad>\metraj.db --url-file D:\toolchain\tmp\<ad>\url.txt [--fresh]` adresi yazdırır. Gömülü arayüz `{adres}/mobile.html`'de; canlı geliştirme için `METRAJ_API_URL={adres} npm run dev` ve `http://localhost:5173/mobile.html`. Örnek veri: `POST {adres}/api/synthetic-clean-water`. Arayüz testleri `npm test` ile çalışır (`node --test tests/` Node 24'te dizini dosya sanıyor).

| Ajan | Yazabileceği alan |
|---|---|
| 1 | `src/Metraj.Host/**` (yeni), `src/Metraj.Api/**`, `Metraj.sln`, `src/Metraj.Infrastructure/{MetrajDbContextFactory.cs, ApplicationSchemaMigrator.cs, StarterCatalogWorkspaceService.cs, CompiledModel/**}`, `Metraj.Infrastructure.csproj` (yalnız EF Design satırı), `Directory.Packages.props` (yalnız EF Design satırı), `tests/Metraj.Tests/**` (yeni dosyalar + csproj referansı), `docs/derleme.md` |
| 2 | `Directory.Packages.props` (Pkcs satırı), `Metraj.Infrastructure.csproj` (Pkcs + font kaynakları), `src/Metraj.Infrastructure/ProjectReportWorkspaceService.cs`, `src/Metraj.Infrastructure/Fonts/**` (yeni), `tests/Metraj.Tests/` altında yeni test dosyaları, `docs/teslim-notlari.md` |
| 3 | `src/Metraj.Web/**` (C# dosyalarına dokunmaz) |

## Router sözleşmesi (Ajan 1 üretir; LocalApiHost ve Android kabuğu tüketir)

- Yeni proje `src/Metraj.Host` (`net10.0`, ASP.NET Core **bağımlılığı yok**; Application + Infrastructure + System.Text.Json). Android projesi bunu referans alabilmeli.
- Giriş noktası: `MetrajRequestRouter.DispatchAsync(RouterRequest request, CancellationToken)` → `RouterResponse`.
  - `RouterRequest(string Method, string PathAndQuery, string? BodyJson, Func<Stream>? BodyStream, string? ContentType)` — `BodyStream` yalnız `/api/workspace/import` için.
  - `RouterResponse(int Status, string ContentType, string? BodyJson, RouterFile? File)`; `RouterFile(string Path, string ContentType, string DownloadName, bool DeleteWhenDone)`. İkili içerik bellekte taşınmaz, geçici dosya yolu döner.
- Rota tablosu, JSON ayarları (camelCase, enum yalnız adla), hata eşlemesi (`DomainRuleViolationException` → 400 + `ApiError(message, rule)`, beklenmeyen → 500 genel metin), `ApplicationDatabaseGate` bakım istisnaları ve 204/404/405 davranışları bugünkü `LocalApiHost` ile **birebir** aynı.
- `LocalApiHost` bütün `/api/**` isteklerini router'a aktaran ince bir adaptöre dönüşür. Statik React sunumu aynen kalır.

## Köprü sözleşmesi (Ajan 3 JS tarafını, Ajan 4 Android tarafını uygular)

- Android, `WebViewCompat.addWebMessageListener` ile `window.MetrajBridge` nesnesini yalnız `https://appassets.androidplatform.net` origin'ine ekler. JS tarafı `typeof window.MetrajBridge !== 'undefined'` ise köprü taşımasını, değilse `fetch` taşımasını kullanır (masaüstü, `vite dev`, Playwright).
- Bütün mesajlar JSON metnidir.
  - **İstek (JS → yerel):** `{"type":"request","id":"<benzersiz>","method":"GET|POST|PUT|DELETE","path":"/api/...?q","body":"<JSON metni>|null"}`
  - **Yanıt (yerel → JS):** `{"type":"response","id":"...","status":200,"contentType":"application/json","body":"<JSON metni>|null","file":null|{"handle":"<opak>","name":"Rapor.pdf","mime":"application/pdf","size":12345}}`
  - **Komut (JS → yerel):** `{"type":"command","id":"...","command":"share|saveAs|pickAndImport|haptic|ready|exitApp","args":{...}}`. `share`/`saveAs` için `args.handle`. `pickAndImport` SAF ile dosya seçer, akış hâlinde `/api/workspace/import`'a verir ve normal bir yanıt döner. `haptic` için `args.kind` = `tick|confirm|reject`. `ready` açılış ekranını kapatır. `exitApp` geri yığını boşken uygulamayı kapatır.
  - **Olay (yerel → JS):** `{"type":"event","event":"back|pause|resume"}`.
- JS API yüzeyi (`src/Metraj.Web/src/api.ts`, masaüstü imzaları korunur): `api.get/post/put/delete/upload` aynen; yeni `api.download(path, suggestedName)` (köprüde `file` tutamacı + paylaş/kaydet sayfası, fetch'te blob + `<a download>`) ve `api.importWorkspace()` (köprüde `pickAndImport`, fetch'te dosya seçici + `upload`).

## Rota envanteri ve eşleştirme (68 uç nokta)

Router her satırı karşılamalı; mobil arayüzde her satırın bir ekran karşılığı olmalı. "Mobil ekran" sütunu Dalga 2 sonunda doğrulanır.

| Yöntem | Yol | Mobil ekran |
|---|---|---|
| GET | `/api/health` | açılış |
| GET | `/api/projects` | üst çubuk proje seçici |
| POST | `/api/projects` | üst çubuk → yeni proje |
| GET | `/api/projects/{projectId}/revisions` | üst çubuk revizyon seçici |
| POST | `/api/projects/{projectId}/revisions` | Ayarlar → revizyonlar |
| POST | `/api/revisions/{revisionId}/approve` | Ayarlar → revizyonlar |
| GET | `/api/catalog/cards` | Kütüphane, kart ekleme paneli |
| GET | `/api/catalog/attributes` | Kütüphane → kart düzenleyici |
| GET | `/api/catalog/types` | Kütüphane |
| POST | `/api/catalog/types` | Kütüphane → tipler |
| DELETE | `/api/catalog/types/{typeId}` | Kütüphane → tipler |
| POST | `/api/catalog/starter-pack` | Kütüphane → eksik standartları tamamla |
| POST | `/api/catalog/cards` | Kütüphane → yeni kart |
| GET | `/api/catalog/cards/{cardId}/versions` | Kütüphane → kart ayrıntısı → sürüm geçmişi (Dalga 3 sonrası eklendi) |
| POST | `/api/catalog/cards/{cardId}/versions` | Kütüphane → kart düzenle |
| POST | `/api/catalog/cards/{cardId}/deactivate` | Kütüphane → pasife al |
| DELETE | `/api/catalog/cards/{cardId}` | Kütüphane → sil |
| GET | `/api/placements/{pipePlacementId}/compatible-fittings` | kart ekleme paneli (önce uyumlular) |
| GET | `/api/settings/material-waste` | Ayarlar → fire |
| PUT | `/api/settings/material-waste` | Ayarlar → fire |
| DELETE | `/api/settings/material-waste/{id}` | Ayarlar → fire |
| GET | `/api/revisions/{revisionId}/placements` | Proje ağacı |
| POST | `/api/revisions/{revisionId}/placements` | Proje ağacı → "+" |
| PUT | `/api/placements/{placementId}` | uzun bas → yeniden adlandır / özellikler |
| PUT | `/api/placements/{placementId}/parent` | uzun bas → taşı |
| POST | `/api/placements/{placementId}/calculated-from` | giriş sayfası → hesap bağı |
| DELETE | `/api/placements/{placementId}` | uzun bas → sil (geri al) |
| GET | `/api/placements/{placementId}/context-notes` | giriş sayfası → bağlam notları |
| POST | `/api/placements/{placementId}/context-notes` | giriş sayfası → bağlam notları |
| DELETE | `/api/placement-context-notes/{noteId}` | bağlam notları |
| DELETE | `/api/placements/{placementId}/context-notes/{noteId}` | bağlam notları |
| GET | `/api/revisions/{revisionId}/measurements` | giriş sayfası → geçmiş |
| GET | `/api/revisions/{revisionId}/measurement-summaries` | ağaç rozetleri, Özet |
| POST | `/api/revisions/{revisionId}/measurements` | giriş sayfası → kaydet |
| POST | `/api/revisions/{revisionId}/measurements/batch` | fitting / radyatör artırıcıları |
| POST | `/api/measurements/{measurementId}/duplicate` | geçmiş → çoğalt |
| DELETE | `/api/measurements/{measurementId}` | geçmiş → kaydırarak sil |
| PUT | `/api/measurements/{measurementId}` | geçmiş → düzenle |
| GET | `/api/revisions/{revisionId}/calculations/rules` | Ayarlar → hesap kuralları |
| POST | `/api/revisions/{revisionId}/calculations/rules` | Ayarlar → hesap kuralları |
| GET | `/api/revisions/{revisionId}/calculations/results` | Ayarlar → hesap onayı |
| POST | `/api/revisions/{revisionId}/calculations/results` | Ayarlar → hesapla |
| POST | `/api/calculations/results/{resultId}/approve` | hesap onayı |
| POST | `/api/calculations/results/{resultId}/reject` | hesap onayı (gerekçe paneli) |
| POST | `/api/calculations/results/{resultId}/override` | hesap onayı (gerekçe paneli) |
| GET | `/api/revisions/{revisionId}/responsibilities` | Ayarlar → sorumluluklar |
| POST | `/api/revisions/{revisionId}/responsibilities/dimensions` | sorumluluklar |
| POST | `/api/revisions/{revisionId}/responsibilities/parties` | sorumluluklar |
| POST | `/api/revisions/{revisionId}/responsibilities/assignments` | sorumluluklar |
| GET | `/api/revisions/{revisionId}/report` | Özet/Çıktı |
| GET | `/api/revisions/{revisionId}/report/excel` | Özet/Çıktı → kaydet/paylaş |
| GET | `/api/revisions/{revisionId}/report/pdf` | Özet/Çıktı → kaydet/paylaş |
| GET | `/api/revisions/{revisionId}/report/word` | Özet/Çıktı → kaydet/paylaş |
| GET | `/api/revisions/{revisionId}/report/subtree/{rootPlacementId}` | Özet/Çıktı (alt ağaç kapsamı) |
| GET | `/api/revisions/{revisionId}/report/subtree/{rootPlacementId}/excel` | Özet/Çıktı |
| GET | `/api/revisions/{revisionId}/report/subtree/{rootPlacementId}/pdf` | Özet/Çıktı |
| GET | `/api/revisions/{revisionId}/report/subtree/{rootPlacementId}/word` | Özet/Çıktı |
| POST | `/api/synthetic-clean-water` | Ayarlar → örnek veri |
| GET | `/api/ui-state` | açılış (taslaklar) |
| PUT | `/api/ui-state` | taslak kalıcılığı |
| DELETE | `/api/ui-state` | taslak temizliği |
| GET | `/api/database/backups` | Ayarlar → yedekler |
| POST | `/api/database/backups` | Ayarlar → şimdi yedekle |
| POST | `/api/database/backups/restore` | Ayarlar → geri yükle |
| GET | `/api/database/integrity` | Ayarlar → bütünlük (açılışta arka planda) |
| DELETE | `/api/database/projects` | Ayarlar → tüm projeleri temizle |
| GET | `/api/workspace/export` | Ayarlar → dışa aktar (SAF) |
| POST | `/api/workspace/import` | Ayarlar → içe aktar (SAF, akış) |

## Performans bütçeleri

| Ölçüt | Hedef | Ölçüm |
|---|---|---|
| Soğuk açılış → kullanılabilir | < 2,5 s (orta segment) | `adb shell am start -W` + JS `ready` işareti |
| Dokunuş → görsel tepki | < 100 ms | Playwright trace |
| Ölçüm kaydı (köprü gidiş-dönüş) | < 50 ms | köprü zaman damgaları |
| 2.000 satır liste kaydırma | 60 fps | Chrome performans izi |
| Mobil ilk JS paketi | < 250 KB gzip | `vite build` çıktısı |
| APK (arm64) | < 60 MB | yayın çıktısı |

## Uyulacak desenler

- Adlandırma: `I*Workspace` / `*WorkspaceService` (singleton), sözleşmeler `*Contracts.cs`.
- Hata: `DomainRuleViolationException(rule)` → `ApiError(message, rule)`; metin `DomainMessageCatalog`'dan. 500'de iç ayrıntı sızmaz.
- Loglama: `[LoggerMessage]` kullanan partial `Log` sınıfı (`LocalApiHost.cs`).
- Veri: `Func<MetrajDbContext>` fabrikası, `ApplicationDatabaseGate` (geri yükleme / proje temizleme / içe aktarma kapıyı kendisi alır).
- Testler: xUnit `[Fact]` + `TestDatabase.CreateAsync`; ön yüzde `node:test` ile `.ts` doğrudan içe aktarılır.
- Yorumlar Türkçe ve "neden / önceden ne oluyordu" anlatır.

## Dalga 3 sonuçları: son kod incelemesi ve son durum (2026-10-18)

**Son kod incelemesi (Ajan 8):** CRITICAL bulgu yok. Ondalık yol, satır gövdeleri, kilitli revizyon, router eşdeğerliği, tohumlama damgası, köprü güvenliği, manifest ve sırlar sorunsuz.

| # | Önem | Bulgu | Durum |
|---|---|---|---|
| 1 | HIGH | Artırıcı `pointerdown`'da adım atıyordu; düğmeden başlayan kaydırma fitting/radyatör adedini değiştiriyordu | Düzeltildi (`stepperGesture.ts`, 9 test) |
| 2 | MEDIUM | Eski tam yenileme yanıtı daha yeni ölçüm/özetleri eziyordu; silme commit'i ölçümleri tazelemiyordu | Düzeltildi (2 test) |
| 3 | MEDIUM | Köprü 60 sn zaman aşımında yerel taraf yazmaya devam edebilir; yeniden denemede çift kayıt riski | **Açık:** idempotency anahtarı ya da zaman aşımı sonrası tazeleme |
| 4 | MEDIUM | Android'de açılış hatasında yedeğe ulaşma yolu yok | **Açık:** hata ekranına "son yedeği geri yükle" / "dışa aktar" |
| 5 | MEDIUM | Ölçüm satırı ve kart gövdesi üretimi mobilde ikinci kopya; eşdeğerlik testi masaüstü koduna bağlı değil | **Kapandı:** gövdeler yalnız `src/lib/measurementBodies.ts` (ölçüm, düzeltme, boru, fitting) ve `src/lib/cardPayload.ts` (kart) içinde; App.tsx, Inspector.tsx ve telefon ekranları bunları çağırır. `tests/shared-bodies.test.mjs` masaüstü çağrılarını ve ağaçta başka gövde kopyası olmadığını denetler |
| 6 | LOW | Masaüstünde kapı alınamazsa geçici rapor dosyası kalıyordu | Düzeltildi |
| 7 | LOW | İptal edilen indirme dosyası önbellekte 1 saat kalıyor | **Açık:** iptalde `release` komutu |
| 8 | LOW | Kayıttan sonra taslak silme tamponda; süreç ölürse çift kayıt | Düzeltildi |
| 9 | LOW | Radyatör kaydı sürerken eklenen grup kayboluyordu | Düzeltildi |
| 10 | LOW | `.gitignore`'da imza anahtarı kalıpları yoktu | Düzeltildi |

**Son durum (orkestratör doğrulaması):** .NET 218/218, 0 uyarı; arayüz 263/263; Playwright telefon e2e 16/16; mobil paket denetimi geçti. Son APK'lar: arm64 35,2 MB, x64 37,6 MB. Emülatörde temiz kurulum: şablon veritabanı 209 ms'de kopyalandı, çekirdek t+2,2 s'de hazır (Dalga 2'de t+14,9 s). PDF 0,76 s'de üretildi, adı `SYN-CW-001_R0_2026-10-18_0110.pdf`; çökme yok.

**Hâlâ açık (yukarıdakilere ek):** şaft/hat no ayrı alan değil; gerçek ARM telefon, 16 KB sayfalı cihaz ve eski WebView doğrulaması yapılmadı. (Tarihler, kart sürüm geçmişi ve `/api/health` aşağıda kapandı.)

## Dalga 3 sonrası: API eksikleri (2026-10-18)

- **UTC tarihler:** `UtcDateTimeConverter` bütün `DateTime`/`DateTime?` özelliklerine kural olarak uygulanıyor (`ConfigureConventions`); okunan değer `Kind=Utc`, JSON `"2026-10-17T14:45:38.41Z"`. Saklanan metin aynı, göç yok; derlenmiş model yenilendi. Masaüstü arayüzü zamanları `Date.parse`/`new Date` ile okuduğu için kod değişikliği olmadan yerel saati gösteriyor. Mobil `parseUtc`/`formatDateTime` eksiz eski değerleri yine UTC sayıyor. Sözleşme: `DateTimeWireContractTests`.
- **Kart sürüm geçmişi:** `GET /api/catalog/cards/{cardId}/versions` (68. uç): en yeni önce, `isLatest`, içerik alanları, `placementCount`, `createdAtUtc`. Kart notu karta ait olduğu için geçmişte yok. Mobil kart ayrıntısı "Sürümler" bölümünde listeliyor, her satırda bir önceki sürüme göre değişenler var.
- **`/api/health`:** `{"status":"ok","version":"1.0.0+<kayıt>","dataLocation":"<veritabanı klasörü>"}`. Sürüm Metraj.Host derlemesinin bilgi sürümü (iki platformda aynı kaynak; Android `ApplicationDisplayVersion` ile ayrıca eşitlenmedi). "Hakkında" telefonda tam yolu, köprüsüz (masaüstü/tarayıcı) yalnız klasör adını gösteriyor.

## Dalga 3 sonuçları: Ajan 7 (2026-10-18)

- **Telefon uçtan uca testleri:** `src/Metraj.Web/e2e/` (Playwright 1.63.0, Pixel 7 emülasyonu), `npm run test:e2e`, 16 test (8 yolculuk + yavaş açılış). Ayrıntı: `docs/derleme.md`.
- **Okunur dosya adları:** `{ProjeKodu}_R{RevizyonKodu}[_{Kapsam}]_{yyyy-MM-dd_HHmm}.{uzantı}` (`ReportFileNames`); revizyon kodu `R0`, `R1`… olarak arayüzde görünen koddur; kapsam alt ağaç kökünün görünen adıdır (boşsa kart kodu). Geçici dosya yolu GUID'li kalır. Masaüstü, tarayıcı ve Android paylaşım ekranı aynı adı gösterir.
- **Açılış:** ilk kurulum şablon veritabanıyla (derlemede üretilir, APK'ya `assets/metraj-template.db` olarak girer): çekirdek hazır süresi temiz kurulumda 4,2-6,8 s (sakin makine; yüklü makinede 32 s) → 1,6 s. Sıcak açılışta değişiklik yok (ilk veri ~1,9-2,2 s, bütçe 3,5 s). Dört ağaç sorgusunu ayrı iş parçacıklarında ve proje sorgusuyla paralel ısındırma denendi, ölçülebilir kazanç vermedi, geri alındı.
- **Bulunan hata:** "bütün projeleri temizle"den sonra örnek proje yeniden açılınca 500 (kart tanımı benzersizlik hatası); düzeltildi.

## Dalga 2 sonuçları (2026-10-17)

Üç dal `feature/android-mobile`'a birleşti. Masaüstü: derleme 0 uyarı, xUnit 202/202; arayüz testleri 252/252; mobil paket denetimi geçti (ilk JS < 100 kB gzip, React Flow yok). Android: `scripts/build-android.ps1` ile arm64 APK 34,3 MB, x64 37,5 MB; 16 KB hizalı; tek izin androidx'in imza düzeyindeki iç izni (INTERNET yok).

**Not:** `isolation: worktree` alt ajan worktree'lerini `main`'den açıyor, mevcut daldan değil. Dalga 2 ajanları bunu fark edip `git merge --ff-only feature/android-mobile` ile düzeltti. Dalga 3'te ajanlara ilk iş olarak bunu yaptırın.

- **Ajan 4:** `src/Metraj.Android` (kök ad alanı `Metraj.Mobile`), `Metraj.Mobile.sln`, `scripts/build-android.ps1`. Açılış: hazırlık iki öncelikli iş parçacığında, WebView ile paralel; EF, JSON tür bilgisi ve router ısındırması. Köprü gidiş-dönüşü ısınmış GET 5–7 ms, yazma 25–40 ms.
- **Ajan 5:** `screens/project` (ağaç, kart ekleme, eylem menüsü, giriş sayfası, bağlam, boru/fitting/radyatör, geçmiş, notlar).
- **Ajan 6:** `screens/{library,output,settings}`.
- **Orkestratör düzeltmeleri:** `npm test` altında süreye bağlı kırılgan arama testi; **yerleşimli projelerde "bütün projeleri temizle" 500 hatası** (masaüstünde de vardı; RESTRICT öz-başvuru, test eklendi).

### Birleşik uygulamanın emülatör duman testi (orkestratör, x64 Release)

| Adım | Sonuç |
|---|---|
| Temiz kurulum | Kabuk t+3,3 s, `ready` t+4,5 s; göç + 733 kart tohumlama çekirdeği t+14,9 s'de hazır etti; boş durum ekranı ve "Örnek projeyi aç" |
| Örnek proje → ağaç → iç seviye | Yol göstergesi, Net/Fireli/Alım rozetleri doğru |
| Giriş sayfası → tuş takımı `2,5+3×2` | Önizleme `= 8,5 m`; kayıt sonrası Net 45,25 → 53,75 m, fireli 56,4375 m, 15 boy; kayıt 615 ms (ilk yazma), özet tazeleme 24 ms |
| Özet → PDF | Cihazda üretildi (89 KB, 2,4 s); "Dosya hazır" paneli → Android paylaşım ekranı |
| Geri tuşu | Paylaşım kapandı → önceki sekme; çökme yok |

### Dalga 3'e devredilen işler

1. **Okunur dosya adları:** rapor/çalışma alanı indirmeleri `metraj-<guid>-<guid>.pdf` adıyla paylaşılıyor (masaüstünde de). Router `DownloadName`'i proje kodu + revizyon + kapsam + tarih olmalı; Ajan 1'in sabitleme testleri buna göre güncellenir.
2. **Açılış performansı:** sıcak açılışta ilk veri t+4,1–4,3 s (hedef 3,5 s); ilk EF sorgu derlemesi ~1,7–2,1 s; ilk katalog isteği 2,5 s (733 kartın ilk JSON dönüşümü); ilk kurulumda ~15 s boş kabuk (göç + tohumlama) → ilerleme göstergesi ya da önceden tohumlanmış DB.
3. ~~**Sunucu tarihleri** `Kind=Unspecified` ile Z'siz gidiyor~~ (2026-10-18 kapandı).
4. ~~**Eksik uç noktalar:** kart sürüm geçmişi, `/api/health`'te sürüm ve veri konumu~~ (2026-10-18 kapandı).
5. **Alan eksikleri:** şaft ve hat no için ayrı ölçüm alanı yok (nota yazılıyor).
6. **Cihaz doğrulaması:** gerçek ARM telefon, 16 KB sayfalı cihaz, eski WebView'da hata ekranı, çentik/yatay ekran, gerçek parmakla kaydırma ve uzun basma.
7. **Küçük ekran:** Çıktı ekranında liste alanı dar.

## Dalga 1 sonuçları (2026-10-17)

Üç dal `feature/android-mobile`'a birleşti. Masaüstü: derleme 0 uyarı, xUnit 201/201, arayüz testleri 147/147, mobil paket denetimi geçti. Güvenlik denetimi (`NuGetAudit`) artık kapatılmıyor.

- **Ajan 1:** `src/Metraj.Host` (`MetrajRequestRouter`, `MetrajServices.Create(databasePath, backupDirectory)`), `LocalApiHost` ince adaptör. EF derlenmiş modeli (`CompiledModel/`), ham SQL şema denetimi, tohumlama damgası (`__StarterCatalogSeedStamp` + 4 tetikleyici). Yeni şema adımı: mevcut kullanıcı DB'leri ilk açılışta bir kez yedek alıp göç eder.
- **Ajan 2:** `System.Security.Cryptography.Pkcs` 10.0.13; PDF her platformda gömülü Liberation Sans 2.1.5 ile (OFL 1.1). Fontta ₺ glifi yok.
- **Ajan 3:** `mobile.html` → `src/mobile/`; köprü/fetch taşıması, zustand deposu, kabuk, tuş takımı. Mobil ilk JS 94,55 kB gzip. Genişleme kılavuzu: `src/Metraj.Web/src/mobile/MIMARI.md`. Kök `.gitignore`'daki `output/` kuralı `screens/output`'u yutuyordu; `screens/.gitignore` ile istisna eklendi.
- **Orkestratör düzeltmeleri:** masaüstü açılışı yol alan tohumlama kurucusunu kullanıyor; `mobile.html` derleme girdisinde; **Mono'da derlenmiş model kilitlenmesi** (EF'in model kurulumunu ayrı iş parçacığında yapması) `Microsoft.EntityFrameworkCore.Issue31751` anahtarıyla çözüldü. Bu kilitlenme yalnız Android'de görülüyordu, masaüstü testleri yakalayamazdı. Dalga 2'den itibaren her birleştirmeden sonra emülatör duman testi zorunlu.

### Emülatör ölçümü, Dalga 1 sonrası (tam AOT, sıcak açılış)

| Adım | Dalga 0 | Dalga 1 |
|---|---|---|
| Süreç başlangıcı → .NET | 1.052 ms | 988–1.161 ms |
| Şema güncel mi | 2.709 ms | 313–463 ms |
| Tohumlama kontrolü | 1.104 ms | 160–271 ms |
| İlk EF sorgusu | (yukarıdakilere dahil) | 1.711–1.805 ms |
| Rapor verisi soğuk → ısınmış | 817 → 37 ms | 1.134–1.155 → 30–40 ms |
| Excel / Word / PDF | 2.233 / 256 ms / ❌ | 2.192–2.218 / 273–277 / **379–386 ms** |

**Ajan 4 için açılış sırası:** EF'in başlatma maliyeti (~1,75 s) ilk sorguya kaydı. Süreç başlar başlamaz arka planda şema → tohumlama → ısındırma sorgusu çalışmalı, WebView yüklemesi bununla paralel yürümeli. Kabuk veriden önce görünür, `ready` ilk veriyle gelir. Hedef: kabuk < 2,5 s, ilk veri < 3,5 s (emülatör). EF ilk sorgu maliyetini ayrıca düşürmek (servis sağlayıcı önbelleği, bağlam havuzu) sonraki bir performans işi.

## Dalga 0 bulguları

- **Araç zinciri tamamen D: üzerinde.** C: diski doluydu ve varsayılan `dotnet workload install` paketleri `C:\Program Files\dotnet` altına yazıyordu. Ayrı bir .NET SDK 10.0.400 ve `android` iş yükü `D:\toolchain\dotnet` altına kuruldu. Her komuttan önce `. D:\toolchain\env.ps1` çalıştırılır: DOTNET_ROOT, NuGet önbelleği, TEMP, Android SDK/AVD/Gradle yollarının hepsi D:'ye gider. Masaüstü derlemesi için sistemdeki SDK kullanılmaya devam eder.
- **PDF Android'de kesin olarak kırılıyor:** `EnsurePdfFontsConfigured` Windows dışında bilerek `PlatformNotSupportedException` fırlatıyor (`ProjectReportWorkspaceService.cs:709`). Ajan 2'nin font sağlayıcı işi zorunlu ve Dalga 2'nin önünde.
- **Güvenlik denetimi temiz önbellekte kırılıyor (masaüstünü de etkiler):** PDFsharp 6.2.4 → `System.Security.Cryptography.Pkcs 8.0.1` için GHSA-846f-f764-76mx (yüksek) ve GHSA-2fmv-rv2c-59x7 (orta). `TreatWarningsAsErrors` yüzünden NU1902/NU1903 geri yüklemeyi durdurur; masaüstü CI da önbellek yenilenince kırılacak. Çözüm (Ajan 2): `Directory.Packages.props`'a yamalı bir `System.Security.Cryptography.Pkcs` sürümü ve Infrastructure'a açık `PackageReference` — mevcut `SQLitePCLRaw.lib.e_sqlite3` geçersiz kılmasıyla aynı desen. Spike yalnız bu yüzden `-p:NuGetAudit=false` ile derlendi.
- **SQLite Android'de açılmıyordu (çözüldü, Ajan 4 uygulayacak):** Infrastructure'ın güvenlik yaması için doğrudan kullandığı `SQLitePCLRaw.lib.e_sqlite3` yalnız masaüstü/Linux ikililerini getiriyor. APK'ya `runtimes/linux-x64` (glibc) ikilisi giriyor → `DllNotFoundException: e_sqlite3`. Android projesinde şu ikisi birlikte gerekiyor: `SQLitePCLRaw.lib.e_sqlite3.android` (aynı sürüm) ve `SQLitePCLRaw.lib.e_sqlite3` için `ExcludeAssets="native"`. Bununla XA0141 (16 KB sayfa hizalama) uyarısı da kayboldu; uyarı Linux ikilisinden geliyordu.
- **Emülatör:** Pixel 6 / Android 15 (API 35) x86_64, WHPX hızlandırmalı. Açılış yaklaşık 66 s. Emülatör sonuçları dizüstü CPU'sunda ölçüldü; orta segment ARM telefonda daha yavaş olabilir, son kabul gerçek cihazda yapılır.

### Spike ölçümleri (değiştirilmemiş çekirdek, Release)

| Adım | Profilli AOT (varsayılan) ilk kurulum | Profilli AOT sıcak açılış | **Tam AOT** sıcak açılış |
|---|---|---|---|
| Süreç başlangıcı → .NET kodu | 1.272 ms | 1.020 ms | 1.052 ms |
| Göç (boş DB) / şema güncel mi | 6.068 ms | 4.988 ms | **2.709 ms** |
| Standart katalog (733 kart) / kontrol | 5.195 ms | 3.425 ms | **1.104 ms** |
| Bütünlük denetimi | 19 ms | 19 ms | 6 ms |
| Sentetik içe aktarma / "zaten vardı" | 875 ms | 372 ms | 203 ms |
| Rapor verisi soğuk → ısınmış | 1.238 → 55 ms | 1.263 → 37 ms | 817 → 37 ms |
| Excel | 5.357 ms | 5.363 ms | 2.233 ms |
| Word | 695 ms | 676 ms | 256 ms |
| PDF | ❌ `PlatformNotSupportedException` | ❌ | ❌ |
| APK (x64) | 15 MB | 15 MB | 33 MB |

**Sonuç:** Excel ve Word Android'de sistem fontu olmadan çalışıyor; ClosedXML için ek iş gerekmiyor (yalnız sütun genişlikleri gözle kontrol edilecek). PDF için font sağlayıcı zorunlu.

**Açılış bütçesi aşılıyor:** Sıcak açılışta göç ve tohumlama hiçbir iş yapmadığı hâlde, varsayılan ayarla süreç başlangıcından sonra yaklaşık 8,4 s ve tam AOT'la yaklaşık 3,8 s sürüyor (hedef toplam < 2,5 s). Kalan maliyetin kaynakları:
1. `IsUpToDateAsync` yalnız iki ham SQL sorgusu çalıştırıyor, ama bağlantıyı almak için `DbContext` kuruyor. Ölçülen sürenin hemen hepsi EF Core'un ilk servis ve model kurulumu.
2. `SeedAsync` her açılışta 733 kartlık manifesti (`Consolidation.Value`) kuruyor ve bütün aktif katalogu `Include(Versions)` ile okuyor; yapacak iş olmasa bile.

**Dalga 1'e eklenen performans işleri (Ajan 1, Infrastructure, masaüstü testleri yeşil kalacak):**
- EF Core **derlenmiş model** (`dotnet ef dbcontext optimize`) ve `MetrajDbContextFactory`'de `UseModel(...)`. Model ile şema arasında uyumsuzluk testi.
- `IsUpToDateAsync` EF'e dokunmadan ham `SqliteConnection` ile.
- Tohumlama için **kısa yol:** manifestin içerik özeti (hash) DB'de saklanır; değişmemişse `SeedAsync` hiçbir şey okumadan döner. Mevcut "kullanıcı kartı değişmez" garantileri ve testleri korunur.
- Android'de açılış sırası: süreç → (paralel) WebView yükleme + şema kontrolü → kabuk görünür → bütünlük denetimi arka planda.

**Ajan 4'e eklenenler:** tam AOT (`AndroidEnableProfiledAot=false`) varsayılan; APK bütçesi arm64-only için kontrol edilecek. Yukarıdaki SQLite paket düzeni.

Spike projesi depo dışında, `D:\toolchain\spike\MetrajSpike` altında duruyor; her adımı süresiyle logcat'e (`METRAJ-SPIKE`) yazıyor. İlk çalıştırmada boş DB kurar, sonrakilerde mevcut DB ile sıcak açılışı ölçer.
