import { DIAGRAM_PALETTE } from '../lib/matching';

export default function OriginDiagramSVG({ d, boxW, boxH }) {
  const pad = 10;
  const scale = Math.min((boxW - 2 * pad) / d.originLength, (boxH - 2 * pad) / d.originWidth);
  const oW = d.originLength * scale, oH = d.originWidth * scale;
  const ox = (boxW - oW) / 2, oy = (boxH - oH) / 2;

  return (
    <svg width={boxW} height={boxH} viewBox={`0 0 ${boxW} ${boxH}`}>
      <rect x={ox} y={oy} width={oW} height={oH} fill="#F7F3EC" stroke="#5B5F56" strokeWidth="1.5" />
      {d.panels.map((p, i) => {
        const x = ox + p._rect_x * scale, y = oy + p._rect_y * scale, w = p._rect_w * scale, h = p._rect_h * scale;
        const color = DIAGRAM_PALETTE[i % DIAGRAM_PALETTE.length];
        return (
          <g key={i}>
            <rect x={x.toFixed(1)} y={y.toFixed(1)} width={w.toFixed(1)} height={h.toFixed(1)} fill={color} stroke="#3F6B4B" strokeWidth="1" />
            {w > 26 && h > 14 && (
              <>
                <text x={(x + w / 2).toFixed(1)} y={(y + h / 2 - 2).toFixed(1)} fontSize="7" textAnchor="middle" fill="#242621" fontWeight="600">{p['PANEL_CODE'] || ''}</text>
                <text x={(x + w / 2).toFixed(1)} y={(y + h / 2 + 7).toFixed(1)} fontSize="6" textAnchor="middle" fill="#5B5F56">{p['CUT_LENGTH']}x{p['CUT_WIDTH']}</text>
              </>
            )}
          </g>
        );
      })}
      {d.trim.map((t, i) => {
        const x = ox + t.x * scale, y = oy + t.y * scale, w = t.w * scale, h = t.h * scale;
        if (w < 1 || h < 1) return null;
        return <rect key={i} x={x.toFixed(1)} y={y.toFixed(1)} width={w.toFixed(1)} height={h.toFixed(1)} fill={t.kept ? '#ffffff' : '#FBE9E7'} stroke="#C7C4B8" strokeWidth="0.75" strokeDasharray="3,2" />;
      })}
    </svg>
  );
}
