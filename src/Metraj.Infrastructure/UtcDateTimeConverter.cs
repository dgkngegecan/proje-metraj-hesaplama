using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace Metraj.Infrastructure;

/// <summary>Veritabanından okunan zamanları <see cref="DateTimeKind.Utc"/> olarak işaretler.</summary>
/// <remarks>
/// Bütün <c>*AtUtc</c> alanları <see cref="DateTime.UtcNow"/> ile yazılır, ama SQLite
/// metin sütununda saat dilimi tutmaz: EF Core onları <see cref="DateTimeKind.Unspecified"/>
/// olarak geri verirdi ve JSON'a "Z"siz çıkarlardı ("2026-10-17T14:45:38.41"). Tarayıcı
/// böyle bir zamanı yerel saat sayar; masaüstü arayüzü saatleri UTC farkı kadar kayık
/// gösteriyordu. Saklanan metin değişmez (sağlayıcı türü yine <see cref="DateTime"/>);
/// yalnız okunan değerin türü düzelir. Yanlışlıkla yerel saatle gelen bir değer yazılmadan
/// önce UTC'ye çevrilir.
/// </remarks>
public sealed class UtcDateTimeConverter() : ValueConverter<DateTime, DateTime>(
    value => value.Kind == DateTimeKind.Local ? value.ToUniversalTime() : value,
    value => DateTime.SpecifyKind(value, DateTimeKind.Utc))
{
}
