/** Hand-drawn-feel SVG sparkline: faint grid, area fill, emphasized endpoint. */
export function Sparkline({
  data,
  color = "var(--accent)",
  width = 96,
  height = 30,
}: {
  data: (number | null)[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const values = data.filter((v): v is number => v != null);
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pad = 3;
  const step = (width - pad * 2) / (data.length - 1);

  const points = data
    .map((v, i) =>
      v == null ? null : ([pad + i * step, pad + (height - pad * 2) * (1 - (v - min) / span)] as const)
    )
    .filter((p): p is readonly [number, number] => p !== null);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${height - 1} L${points[0][0].toFixed(1)},${height - 1} Z`;
  const last = points[points.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      {/* faint ledger grid */}
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1={pad}
          x2={width - pad}
          y1={height * f}
          y2={height * f}
          stroke="var(--rule)"
          strokeWidth="0.6"
          strokeDasharray="2 3"
        />
      ))}
      <path d={area} fill={color} opacity="0.12" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="2.6" fill={color} />
      <circle cx={last[0]} cy={last[1]} r="4.5" fill={color} opacity="0.25" />
    </svg>
  );
}
