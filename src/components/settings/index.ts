import type { ComponentType } from "react";
import { AppearanceSection } from "./AppearanceSection";
import { ProvidersSection } from "./ProvidersSection";
import { GeneralSection } from "./GeneralSection";
import { SecuritySection } from "./SecuritySection";
import { DataSection } from "./DataSection";
import { HelpSection } from "./HelpSection";
import { BigPictureSection, ControllerSection } from "./ControllerSection";

/**
 * Settings sections in display order. To add one, create a component in this folder
 * and register it here; nothing else needs to change.
 */
export const settingsSections: Array<{ id: string; Section: ComponentType }> = [
  { id: "appearance", Section: AppearanceSection },
  { id: "providers", Section: ProvidersSection },
  { id: "general", Section: GeneralSection },
  { id: "controller", Section: ControllerSection },
  { id: "bigpicture", Section: BigPictureSection },
  { id: "security", Section: SecuritySection },
  { id: "data", Section: DataSection },
  { id: "help", Section: HelpSection },
];
