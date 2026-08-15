interface FlameProps {
  size?: number;
  /** 0..1 — drives glow + gradient toward --flame-hot as the streak grows. */
  intensity?: number;
}

/**
 * The signature mark: an amber flame that intensifies with streak length.
 * Pure SVG so it scales crisply in the header and the big streak panel.
 */
export function Flame({ size = 24, intensity = 0.5 }: FlameProps) {
  const clamped = Math.max(0, Math.min(1, intensity));
  const glow = 1 + clamped * 3; // blur radius grows with streak
  const gid = `flame-grad-${Math.round(clamped * 100)}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label="streak flame"
      style={{ filter: `drop-shadow(0 0 ${glow}px var(--flame-glow))` }}
    >
      <defs>
        <linearGradient id={gid} x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="var(--flame-hot)" />
          <stop offset={String(0.55 - clamped * 0.25)} stop-color="var(--flame)" />
          <stop offset="1" stop-color="var(--flame)" />
        </linearGradient>
      </defs>
      <path
        d="M12 2c1.2 3.1-.8 4.6-2.1 6.2C8.4 10 7 11.7 7 14.2 7 18 9.6 21 12.5 21S18 18.3 18 14.6c0-2-1-3.7-2.3-5.1.4 1.3.1 2.6-.9 3.2.5-2.2-.6-4.6-2.8-6.1.6 1.7.2 3-.9 3.9C10.4 8.6 12.9 5.6 12 2Z"
        fill={`url(#${gid})`}
      />
    </svg>
  );
}
