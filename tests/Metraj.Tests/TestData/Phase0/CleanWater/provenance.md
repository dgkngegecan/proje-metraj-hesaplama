# Temiz Su Sentetik Referans Paketi — Provenance

> 🟢 **OPENAI-SOL56 / OPENAI-LUNA56** — 2026-08-30

## Kaynak niteliği

- `SourceKind`: `SYNTHETIC`
- `NotRepresentativeOfAnyCustomerProject`: `true`
- Gerçek bir Excel, müşteri projesi, saha metrajı veya sipariş geçmişinden alınmamıştır.
- Ürün adları, miktarlar, mahal adları, sorumluluklar ve hesap politikaları test amacıyla üretilmiştir.
- Bu paket `GOLDEN`, `REAL` veya `REAL-WORLD-VALIDATED` olarak adlandırılamaz.

## Amaç

Bu paket; kart/yerleşim ayrımı, ölçüm bağlamı, fire, standart boy, paket, satın alma grubu, sorumluluk, `reference`, `calculated-from`, sürümleme ve rapor toplamı sözleşmelerini koddan önce test edilebilir hâle getirir.

## Varsayımlar — CW-SYN-ASSUMPTIONS-v1

- Boru satış boyları: DN20/DN25/DN32 için 4 m; DN50 için 6 m.
- Fire: DN20 `%3`, DN25/DN32 `%5`, DN50 `%7,5`; adet ek parçalarda `%0`.
- Satır `Fireli Projeksiyon` alanı bilgi amaçlıdır ve toplanmaz. Otoritatif fireli miktar `calculation-groups.json` içindedir.
- Satış kabı ve `ceiling` yalnız `purchase-groups.json` seviyesinde uygulanır.
- Farklı `ProjectRevisionId` değerleri hiçbir grupta birleşmez.
- Farklı yerleşimler varsayılan olarak birleşmez. Yalnız aynı açık `ProcurementScope` ve uyumlu kart/birim/dönüşüm/temin anahtarları varsa birlikte alınır.
- `NoPool=true` olan yerleşim her zaman ayrı satın alma grubudur.
- `PendingReview`, `Rejected`, `Stale` ve `Superseded` sonuçlar kesin/satın alma toplamına girmez.
- `Approved` ve gerekçeli `Overridden` etkin türetilmiş sonuçlar kesin toplama girebilir.
- `reference` yalnız rapor görünümüdür ve miktar üretmez.

## Bilinen gerçeklik boşlukları

- Gerçek şirket Excel sütunları, yerel jargon, boş hücre ve hata alışkanlıkları bilinmiyor.
- Gerçek satın alma havuzlama, fire ve yuvarlama alışkanlığı doğrulanmış değil.
- Gerçek rapor/hakediş şablonu bilinmiyor.
- Placement-seviyeli `reference` granülerliğinin gerçek raporlara yeterliliği doğrulanmış değil.
- Dönemsel hakediş bilinçli olarak kapsam dışıdır ve gerçek veriyle sınanmamıştır.

## Bağımsız doğrulama

- İlk üretim: `OPENAI-LUNA56`
- Entegrasyon ve aritmetik kontrol: `OPENAI-SOL56`
- Bağımsız ikinci hesap: `CLAUDE-OPUS5` — 2026-08-30 tarihinde tamamlandı; 12/12 hash, 13/13 hesap grubu ve 14/14 satın alma grubu eşleşti, aritmetik uyuşmazlık bulunmadı.
- Bağımsız inceleme kanıtı: `docs/arsiv/faz0-sentetik-paket-inceleme-claude-opus5.md`.
- Kullanıcı yönetici onayıyla manifest durumu `PHASE0_COMPLETE` olarak kapatıldı; resmî doğrulama etiketi değişmedi: `SYNTHETIC-VALIDATED / REAL-DATA-NOT-VALIDATED`.
- Fixture/expected dosyalarının SHA-256 değerleri OpenAI doğrulamasından sonra `manifest.json` içine pinlenmiştir. Claude doğrulaması dosyaları değiştirmeden bu hash'ler üzerinden yapılmalıdır; değişiklik gerekirse paket sürümü artırılır ve hash'ler yeniden üretilir.
