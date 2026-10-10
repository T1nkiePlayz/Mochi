import type { ComponentType } from "react";
import { AppearanceSection } from "./AppearanceSection";
import { AccessibilitySection } from "./AccessibilitySection";
import { ProvidersSection } from "./ProvidersSection";
import { ModSourcesSection } from "./ModSourcesSection";
import { GeneralSection } from "./GeneralSection";
import { SecuritySection } from "./SecuritySection";
import { DataSection } from "./DataSection";
import { AchievementsSection } from "./AchievementsSection";
import { HelpSection } from "./HelpSection";
import { UpdateSection } from "./UpdateSection";
import { BigPictureSection, ControllerSection } from "./ControllerSection";
import { ExperimentalSection } from "./ExperimentalSection";
import { SoundSection } from "./SoundSection";
import { LibraryToolsSection } from "./LibraryToolsSection";
import { PlayLimitsSection } from "./PlayLimitsSection";
import { AccountPinSection } from "./AccountPinSection";
import { StorageSection } from "./StorageSection";

/**
 * Settings sections in display order. To add one, create a component in this folder
 * and register it here; nothing else needs to change.
 */
export const settingsSections: Array<{ id: string; Section: ComponentType }> = [
  { id: "appearance", Section: AppearanceSection },
  { id: "accessibility", Section: AccessibilitySection },
  { id: "providers", Section: ProvidersSection },
  { id: "modsources", Section: ModSourcesSection },
  { id: "general", Section: GeneralSection },
  { id: "controller", Section: ControllerSection },
  { id: "bigpicture", Section: BigPictureSection },
  { id: "sound", Section: SoundSection },
  { id: "security", Section: SecuritySection },
  { id: "accountpin", Section: AccountPinSection },
  { id: "updates", Section: UpdateSection },
  { id: "achievements", Section: AchievementsSection },
  { id: "data", Section: DataSection },
  { id: "playlimits", Section: PlayLimitsSection },
  { id: "librarytools", Section: LibraryToolsSection },
  { id: "storage", Section: StorageSection },
  { id: "experimental", Section: ExperimentalSection },
  { id: "help", Section: HelpSection },
];
