import { useEffect, useState, type ComponentType, type CSSProperties } from "react";
import type { LucideProps } from "lucide-react";

function iconVariable(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, "$1-$2").replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

type Props = LucideProps & {
  name: string;
  fallback: ComponentType<LucideProps>;
};

export function MochiIcon({ name, fallback: Fallback, size = 16, ...props }: Props) {
  const variable = "--mochi-icon-" + iconVariable(name);
  const [customUrl, setCustomUrl] = useState("");

  useEffect(() => {
    const update = () => {
      setCustomUrl(getComputedStyle(document.documentElement).getPropertyValue(variable).trim());
    };
    update();
    window.addEventListener("mochi-theme-changed", update);
    return () => window.removeEventListener("mochi-theme-changed", update);
  }, [variable]);

  return (
    <span className="mochi-icon-wrap" aria-hidden="true">
      {customUrl ? (
        <span
          className="mochi-icon-custom"
          style={{ backgroundImage: customUrl } as CSSProperties}
        />
      ) : (
        <Fallback size={size} {...props} />
      )}
    </span>
  );
}
