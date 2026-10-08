import type { ComponentType } from "react";
import { AppearanceSection } from "./AppearanceSection";
import { AccessibilitySection } from "./AccessibilitySection";
import { ProvidersSection } from "./ProvidersSection";
import { GeneralSection } from "./GeneralSection";
import { SecuritySection } from "./SecuritySection";
import { DataSection } from "./DataSection";
import { HelpSection } from "./HelpSection";
import { UpdateSection } from "./UpdateSection";
import { BigPictureSection, ControllerSection } from "./ControllerSection";
import { ExperimentalSection } from "./ExperimentalSection";

/**
 * Settings sections in display order. To add one, create a component in this folder
 * and register it here; nothing else needs to change.
 */
export const settingsSections: Array<{ id: string; Section: ComponentType }> = [
  { id: "appearance", Section: AppearanceSection },
  { id: "accessibility", Section: AccessibilitySection },
  { id: "providers", Section: ProvidersSection },
  { id: "general", Section: GeneralSection },
  { id: "controller", Section: ControllerSection },
  { id: "bigpicture", Section: BigPictureSection },
  { id: "security", Section: SecuritySection },
  { id: "updates", Section: UpdateSection },
  { id: "data", Section: DataSection },
  { id: "experimental", Section: ExperimentalSection },
  { id: "help", Section: HelpSection },
];
