export default function NotConnectedCard({
  title,
  phaseNote,
}: {
  title: string;
  phaseNote: string;
}) {
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="placeholder-box">
        Not yet connected — {phaseNote}
      </div>
    </div>
  );
}
