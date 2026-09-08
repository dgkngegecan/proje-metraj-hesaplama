namespace Metraj.Application;

/// <summary>Arayüzün kalıcı olması gereken tek bir durum girdisi.</summary>
public sealed record UiStateItem(string Key, string ValueJson, DateTime UpdatedAtUtc);

/// <summary>
/// Yarım kalmış girişleri ve tercihleri uygulama veritabanında saklar.
/// </summary>
/// <remarks>
/// Bunlar tarayıcı localStorage'ında tutulamaz: yerel API her açılışta işletim
/// sisteminin seçtiği bir loopback portu dinler, port değişince WebView için
/// origin değişir ve localStorage boş gelir. Arayüz kullanıcıya bekleyen
/// adetlerin saklandığını söylediği için bu sözün tutulması gerekir.
/// </remarks>
public interface IUiStateWorkspace
{
    public Task<IReadOnlyList<UiStateItem>> ListAsync(CancellationToken cancellationToken = default);
    public Task<UiStateItem> SetAsync(string key, string valueJson, CancellationToken cancellationToken = default);
    public Task DeleteAsync(string key, CancellationToken cancellationToken = default);
}
