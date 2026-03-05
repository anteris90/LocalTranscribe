import React from "react";

export type HealthDotStatus = "ok" | "warn" | "bad";

type Props = {
  status: HealthDotStatus;
  title: string;
};

export default function HealthDot({ status, title }: Props) {
  const style: React.CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: 999,
    border: "1px solid var(--border)",
    flex: "0 0 auto",
  };

  if (status === "ok") {
    // Explicit OK green to avoid hue-rotation surprises across themes.
    style.background = "#4ade80";
  } else if (status === "warn") {
    style.background = "#f59e0b";
  } else {
    style.background = "#fca5a5";
  }

  return (
    <div
      role="img"
      aria-label={title}
      title={title}
      style={style}
    />
  );
}
