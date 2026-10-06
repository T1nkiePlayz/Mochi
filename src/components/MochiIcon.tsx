import { useEffect, useState, type ComponentType } from "react";
import type { LucideProps } from "lucide-react";

function iconVariable(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

type Props = LucideProps & {
  name: string;
  fallback: ComponentType<LucideProps>;
};

export function MochiIcon({ name, fallback: Fallback, size = 16, ...props }: Props) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const update = () => refresh((value) => value + 1);
    window.addEventListener("mochi-theme-changed", update);
    return () => window.removeEventListener("mochi-theme-changed", update);
  }, []);

  const variable = "--mochi-icon-" + iconVariable(name);
  return (
    <span className="mochi-icon-wrap" aria-hidden="true">
      <span className="mochi-icon-custom" style={{ "--mochi-icon-image": "var(" + variable + ", none)" } as React.CSSProperties} />
      <Fallback size={size} {...props} />
    </span>
  );
}