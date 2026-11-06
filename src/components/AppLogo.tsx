/** The app's mark: printed layers under a nozzle. Mirrors app-icon.svg, which the Windows icons come from. */
export function AppLogo({ size = 24 }: { size?: number }) {
  return (
    <svg viewBox="0 0 1024 1024" width={size} height={size} aria-hidden="true">
      <rect x="32" y="32" width="960" height="960" rx="216" fill="#1f2430" />
      <path d="M432 176h160v72l-48 64h-64l-48-64z" fill="#e9ebef" />
      <rect x="496" y="312" width="32" height="40" rx="8" fill="#f2b544" />
      <rect x="352" y="392" width="320" height="88" rx="28" fill="#8b9cff" opacity=".55" />
      <rect x="272" y="520" width="480" height="88" rx="28" fill="#8b9cff" opacity=".78" />
      <rect x="192" y="648" width="640" height="88" rx="28" fill="#8b9cff" />
      <rect x="144" y="776" width="736" height="40" rx="20" fill="#4a5265" />
    </svg>
  );
}
