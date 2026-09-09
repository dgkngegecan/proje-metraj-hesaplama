export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}
