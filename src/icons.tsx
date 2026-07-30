import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconProps = { size?: number; color?: string };

export function ChevronUpIcon({ size = 18, color = '#9c9ea5' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round">
      <Path d="M18 15l-6-6-6 6" />
    </Svg>
  );
}

export function EllipsisIcon({ size = 18, color = '#9c9ea5' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Circle cx={5} cy={12} r={2} />
      <Circle cx={12} cy={12} r={2} />
      <Circle cx={19} cy={12} r={2} />
    </Svg>
  );
}

export function VinylIcon({ size = 26, color = '#a9aebb' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.5}>
      <Path d="M9 18V5l12-2v13" />
      <Circle cx={6} cy={18} r={3} />
      <Circle cx={18} cy={16} r={3} />
    </Svg>
  );
}

export function HeartIcon({ size = 26, color = '#9c9ea5', filled = false }: IconProps & { filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={1.8}>
      <Path d="M12 21s-7.5-4.7-10-9.2C.5 8.2 2.3 4.5 6 4c2.3-.3 3.9 1 6 3.2C14.1 5 15.7 3.7 18 4c3.7.5 5.5 4.2 4 7.8C19.5 16.3 12 21 12 21z" />
    </Svg>
  );
}

export function ReshuffleIcon({ size = 20, color = '#84868c' }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M16 3h5v5" />
      <Path d="M4 20L21 3" />
      <Path d="M21 16v5h-5" />
      <Path d="M15 15l6 6" />
      <Path d="M4 4l5 5" />
    </Svg>
  );
}

export function PrevIcon({ size = 30, color = '#eceef5' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M6 5h2v14H6zM20 5L9 12l11 7z" />
    </Svg>
  );
}

export function NextIcon({ size = 30, color = '#eceef5' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M18 5h-2v14h2zM4 5l11 7-11 7z" />
    </Svg>
  );
}

export function PlayIcon({ size = 26, color = '#08090c' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M8 5v14l11-7z" />
    </Svg>
  );
}

export function PauseIcon({ size = 26, color = '#08090c' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Rect x={6} y={5} width={4} height={14} rx={1} />
      <Rect x={14} y={5} width={4} height={14} rx={1} />
    </Svg>
  );
}

export function RepeatIcon({ size = 20, color = '#84868c', mode = 'off' }: IconProps & { mode?: 'off' | 'track' | 'context' }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M17 1l4 4-4 4" />
      <Path d="M3 11V9a4 4 0 014-4h14" />
      <Path d="M7 23l-4-4 4-4" />
      <Path d="M21 13v2a4 4 0 01-4 4H3" />
      {/* "Repeat one" has no distinct glyph in the source design (which only
          modeled a boolean toggle) — a small filled dot distinguishes it from
          "repeat all" without inventing an unproven number glyph. */}
      {mode === 'track' && <Circle cx={12} cy={12} r={2} fill={color} stroke="none" />}
    </Svg>
  );
}
