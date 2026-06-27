import { cn } from "@/lib/utils";

const PRESET_COLORS = [
  "#7c3aed", // violet
  "#2563eb", // blue
  "#0891b2", // cyan
  "#059669", // emerald
  "#65a30d", // lime
  "#ca8a04", // yellow
  "#ea580c", // orange
  "#dc2626", // red
  "#db2777", // pink
  "#9333ea", // purple
  "#64748b", // slate
  "#374151", // gray dark
  "#f59e0b", // amber
  "#10b981", // teal
  "#3b82f6", // blue-400
  "#ec4899", // pink-400
];

interface Props {
  value: string;
  onChange: (color: string) => void;
  className?: string;
}

export function ColorPicker({ value, onChange, className }: Props) {
  return (
    <div className={cn("grid grid-cols-8 gap-1.5", className)}>
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={c}
          className={cn(
            "size-6 rounded-md border-2 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring",
            value === c ? "border-foreground scale-110" : "border-transparent",
          )}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}
