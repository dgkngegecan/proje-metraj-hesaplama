using Xunit;

// Süit SERİ çalışır. Bu bilinçli bir karardır, ölçülerek verilmiştir.
//
// İnceleme, havuz temizleyen testleri tek bir koleksiyona alıp geri kalanın
// paralel çalışmasını öneriyordu. Denendi ve ÖLÇÜLDÜ: paralel koşu süreyi
// 35 saniyeden ~21 saniyeye indiriyor, ama beş koşunun BEŞİNDE de birbirinden
// farklı testler düştü (koşu başına 1-3 test).
//
// Sebep bağlantı havuzu DEĞİL. `TestDatabase` artık yalnızca kendi
// veritabanının havuzunu boşaltıyor (`ClearPool`, süreç geneli
// `ClearAllPools` değil) -- bu düzeltme yerinde kaldı, çünkü etki alanını
// daraltmak her hâlükârda doğru. Asıl engel, testlerin SÜREÇ GENELİ durumu
// değiştirmesi:
//
//   * `InfrastructureRobustnessTests` `METRAJ_DATA_DIRECTORY` ortam
//     değişkenini set edip geri alıyor. Ortam değişkeni süreç genelidir;
//     bu sırada veritabanı yolunu çözen HERHANGİ bir test yanlış konuma
//     bakar.
//   * Birden çok test `ApplicationWriteLock` üzerinden tek-örnek mutex'ini
//     alıyor. Mutex de süreç/makine genelidir; eşzamanlı iki test
//     birbirinin kilidini bekler ya da beklenmedik biçimde reddedilir.
//
// Bu ikisi izole edilmeden paralellik güvenli değil. 14 saniye kazanmak için
// koşu başına rastgele kırmızıya dönen bir süit iyi bir takas değildir:
// güvenilmeyen testler okunmayı bırakır.
//
// Paralelliği açmak isteyen için yol haritası: ortam değişkenini ve mutex'i
// kullanan testleri kendi `[Collection]`'ına al, geri kalanı
// `CollectionPerClass` ile paralel çalıştır.
[assembly: CollectionBehavior(DisableTestParallelization = true)]
