import type { ModrinthProjectDetails, ModrinthProjectType } from "../../lib/modrinth";

export function projectTypeLabel(type: ModrinthProjectType) {
  return type === "resourcepack" ? "Resource Pack" : type.charAt(0).toUpperCase() + type.slice(1);
}

export function formatDate(value?: string) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function getPrimaryCreator(project: ModrinthProjectDetails) {
  const member = project.members?.find(item => item.accepted !== false) ?? project.members?.[0];
  return {
    name: project.author || member?.user.name || member?.user.username || "",
    avatar: member?.user.avatar_url || "",
  };
}
