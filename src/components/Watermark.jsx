const TEXT = 'FORMGRID INTERIOR SOLUTIONS';
const COLS = 4, ROWS = 8;

export default function Watermark() {
  const spans = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const top = r * 140 - 60;
      const left = c * 340 - 100 + (r % 2) * 150;
      spans.push({ top, left, key: `${r}-${c}` });
    }
  }
  return (
    <div id="watermark-layer">
      {spans.map((s) => (
        <span key={s.key} style={{ top: s.top, left: s.left }}>{TEXT}</span>
      ))}
    </div>
  );
}
