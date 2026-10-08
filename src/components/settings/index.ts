import type { ComponentType } from "react";
import { AppearanceSection } from "./AppearanceSection";
import { ProvidersSection } from "./ProvidersSection";
import { GeneralSection } from "./GeneralSection";
import { SecuritySection } from "./SecuritySection";
import { DataSection } from "./DataSection";
import { HelpSection } from "./HelpSection";
import { UpdateSection } from "./UpdateSection";

/**
 * Settings sections in display order. To add one, create a component in this folder
 * and register it here; nothing else needs to change.
 */
export const settingsSections: Array<{ id: string; Section: ComponentType }> = [
  { id: "appearance", Section: AppearanceSection },
  { id: "providers", Section: ProvidersSection },
  { id: "general", Section: GeneralSection },
  { id: "security", Section: SecuritySection },
  { id: "updates", Section: UpdateSection },
  { id: "data", Section: DataSection },
  { id: "help", Section: HelpSection },
];
