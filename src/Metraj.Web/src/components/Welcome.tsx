export function Welcome({ onCreate, onExample }: { onCreate: () => void; onExample: () => void }) {
  return (
    <section className="welcome">
      <span className="welcome-mark">◇</span>
      <span className="eyebrow">BAŞLAYALIM</span>
      <h2>Metrajı kartlarla kur.</h2>
      <p>Önce proje oluştur. Sonra malzemeleri sürükleyip bağla. En sonunda miktarları yaz.</p>
      <div>
        <button className="primary welcome-action" onClick={onCreate}>
          Yeni proje oluştur →
        </button>
        <button onClick={onExample}>Örnekle dene</button>
      </div>
      <ol>
        <li>
          <b>1</b> Projeyi aç
        </li>
        <li>
          <b>2</b> Kartları bağla
        </li>
        <li>
          <b>3</b> Miktarı yaz
        </li>
        <li>
          <b>4</b> Raporu al
        </li>
      </ol>
    </section>
  );
}
