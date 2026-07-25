export default function NestSVG({ length, width, usedL, usedW }) {
  const pad = 2, boxW = 90, boxH = 70;
  const scale = Math.min((boxW - 2 * pad) / length, (boxH - 2 * pad) / width);
  const oW = length * scale, oH = width * scale;
  const pW = usedL * scale, pH = usedW * scale;
  const ox = (boxW - oW) / 2, oy = (boxH - oH) / 2;
  return (
    <svg width={boxW} height={boxH} viewBox={`0 0 ${boxW} ${boxH}`}>
      <rect x={ox} y={oy} width={oW} height={oH} fill="#EAD3AF" stroke="#B8752B" strokeWidth="1" />
      <rect x={ox} y={oy} width={pW} height={pH} fill="#DCE7DD" stroke="#3F6B4B" strokeWidth="1" />
    </svg>
  );
}
