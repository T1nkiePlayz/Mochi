import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2 } from "lucide-react";
import { previewLaunchCommand, type LaunchPreview } from "../../../lib/platform";
import { addControllerProfile, controllerProfileFor, MAX_CONTROLLER_PROFILES, remapConflict, remappableButtons, removeControllerProfile, updateControllerProfile, useControllerProfiles, type ControllerLayout, type ControllerTypeHint, type RemapButton } from "../../../controller/profiles";
import { launchTargetFor } from "../../../lib/minecraftPiko";
import { Select } from "../../ui/Select";
import { Switch } from "../../ui/Checkbox";
import { useTranslation } from "../../../lib/useTranslation";
import type { EditorContext } from "./types";

type Pad = { id: number; name: string; guid?: string };

/** The variables a profile can add; shown from the launcher's own preview so they match what a launch uses. */
const profileVariables = new Set(["SDL_GAMECONTROLLERCONFIG", "SDL_GAMECONTROLLERTYPE", "SDL_GAMECONTROLLER_IGNORE_DEVICES", "SDL_GAMECONTROLLER_IGNORE_DEVICES_EXCEPT", "SDL_JOYSTICK_HIDAPI", "PROTON_ENABLE_HIDRAW", "PROTON_PREFER_SDL"]);

/** Choose, create and edit the controller profile a game launches with. */
export function ControllerProfileSection({ ctx }: { ctx: EditorContext }) {
  const t = useTranslation();
  const { draft, patch, capabilities } = ctx;
  const profiles = useControllerProfiles();
  const profile = controllerProfileFor(draft);
  const linux = capabilities?.platform !== "macos";
  const [newName, setNewName] = useState("");
  const [pads, setPads] = useState<Pad[]>([]);
  const [preview, setPreview] = useState<LaunchPreview | null>(null);
  const full = profiles.length >= MAX_CONTROLLER_PROFILES;

  useEffect(() => { void invoke<Pad[]>("get_gamepads").then(setPads).catch(() => {}); }, []);

  const tofu = draft.tofus[0];
  const signature = JSON.stringify([launchTargetFor(draft, tofu), draft.id, profile, pads.map((pad) => pad.guid)]);
  useEffect(() => {
    if (!profile) { setPreview(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => { previewLaunchCommand(draft, tofu).then((result) => { if (!cancelled) setPreview(result); }).catch(() => { if (!cancelled) setPreview(null); }); }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const buttonLabel: Record<RemapButton, string> = {
    a: "A", b: "B", x: "X", y: "Y",
    leftshoulder: t("Left shoulder"), rightshoulder: t("Right shoulder"), lefttrigger: t("Left trigger"), righttrigger: t("Right trigger"),
    leftstick: t("Left stick click"), rightstick: t("Right stick click"), start: t("Start"), back: t("Back"),
  };
  const setRemap = (from: RemapButton, to: RemapButton) => {
    if (!profile) return;
    const remap = { ...profile.remap };
    if (to === from) delete remap[from]; else remap[from] = to;
    updateControllerProfile(profile.id, { remap });
  };
  const applied = (preview?.env ?? []).filter(([key]) => profileVariables.has(key));

  return <section className="launch-options" aria-label={t("Controller profile")}>
    <div className="launch-options-heading"><h3>{t("Controller profile")}</h3><p>{t("Applied as SDL and Proton environment variables when Mochi starts this game itself. It cannot remap input for programs that ignore SDL.")}</p></div>
    <div className="editor-field"><span className="editor-field-label">{t("Profile in use")}</span>
      <div className="launch-profile-row">
        <select aria-label={t("Profile in use")} value={profile?.id ?? ""} onChange={(event) => patch({ controllerProfileId: event.target.value || undefined })}>
          <option value="">{t("None (use system default)")}</option>
          {profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        {profile && <button type="button" className="icon-button" aria-label={t("Delete profile {name}").replace("{name}", profile.name)} onClick={() => { removeControllerProfile(profile.id); patch({ controllerProfileId: undefined }); }}><Trash2 size={14} /></button>}
      </div>
      <div className="launch-profile-row">
        <input aria-label={t("New controller profile")} value={newName} maxLength={40} placeholder={t("New controller profile")} disabled={full} onChange={(event) => setNewName(event.target.value)} />
        <button type="button" className="secondary-button" disabled={!newName.trim() || full} onClick={() => { const created = addControllerProfile(newName); if (created) { patch({ controllerProfileId: created.id }); setNewName(""); } }}><Plus size={13} /> {t("Add profile")}</button>
      </div>
      <small className="metadata-note">{t("Controller profiles are stored on this device and can be shared between games.")}</small>
    </div>

    {profile && <>
      <div className="editor-field"><span className="editor-field-label">{t("Profile name")}</span>
        <input aria-label={t("Profile name")} defaultValue={profile.name} key={profile.id} maxLength={40} onBlur={(event) => { if (event.target.value.trim()) updateControllerProfile(profile.id, { name: event.target.value.trim() }); else event.target.value = profile.name; }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
      </div>
      <div className="editor-field"><span className="editor-field-label">{t("Button layout")}</span>
        <Select<ControllerLayout> label={t("Button layout")} value={profile.layout} searchable={false} onChange={(layout) => updateControllerProfile(profile.id, { layout })}
          options={[{ value: "xbox", label: t("Xbox layout") }, { value: "nintendo", label: t("Nintendo layout (swap A/B and X/Y)") }, { value: "custom", label: t("Custom") }]} />
      </div>
      {profile.layout === "custom" && <div className="editor-field"><span className="editor-field-label">{t("Custom button remap")}</span>
        <div className="launch-env" role="group" aria-label={t("Custom button remap")}>
          {remappableButtons.map((button) => <div className="launch-env-row" key={button}>
            <span>{buttonLabel[button]}</span>
            <Select<RemapButton> label={t("{button} acts as").replace("{button}", buttonLabel[button])} value={profile.remap[button] ?? button} searchable={false} onChange={(to) => setRemap(button, to)} options={remappableButtons.map((to) => ({ value: to, label: buttonLabel[to] }))} />
          </div>)}
        </div>
        {remapConflict(profile) && <small className="launch-field-error" role="alert">{t("Two buttons are remapped to the same button, so the remap is skipped.")}</small>}
      </div>}
      <div className="editor-field"><span className="editor-field-label">{t("Controller type")}</span>
        <Select<ControllerTypeHint> label={t("Controller type")} value={profile.typeHint} searchable={false} onChange={(typeHint) => updateControllerProfile(profile.id, { typeHint })}
          options={[{ value: "auto", label: t("Automatic") }, { value: "xbox", label: "Xbox" }, { value: "playstation", label: "PlayStation" }, { value: "nintendo", label: "Nintendo" }]} />
        <small className="launch-hint">{t("Tells SDL which kind of controller to treat the connected ones as.")}</small>
      </div>
      <div className="editor-field"><span className="editor-field-label">{t("Use only this controller")}</span>
        <Select<string> label={t("Use only this controller")} value={profile.onlyGuid ?? ""} searchable={false} onChange={(guid) => updateControllerProfile(profile.id, { onlyGuid: guid || undefined })}
          options={[{ value: "", label: t("Any controller") }, ...pads.filter((pad) => pad.guid).map((pad) => ({ value: pad.guid as string, label: pad.name }))]} />
        <small className="launch-hint">{t("Lists the controllers connected now. Connect the one you want and reopen this editor to pick it.")}</small>
      </div>
      <div className="launch-toggles" role="group" aria-label={t("Controller profile")}>
        <Switch label={t("Ignore Steam virtual controllers")} description={t("Hides the pad Steam Input creates, so the game sees only real controllers.")} checked={profile.ignoreSteamVirtual} onChange={(on) => updateControllerProfile(profile.id, { ignoreSteamVirtual: on })} />
        {linux && <Switch label={t("Enable hidraw for PlayStation and Switch pads")} description={t("Lets SDL and Proton talk to these pads directly. Proton also gets PROTON_ENABLE_HIDRAW and PROTON_PREFER_SDL.")} checked={profile.protonHidraw} onChange={(on) => updateControllerProfile(profile.id, { protonHidraw: on })} />}
      </div>
    </>}

    {profile && preview?.controllerNotes.map((note) => <p className="launch-hint launch-options-note" role="status" key={`${note.message}|${note.pad ?? ""}`}>{t(note.message)}{note.pad ? ` ${note.pad}` : ""}</p>)}
    {profile && applied.length > 0 && <div className="editor-field"><span className="editor-field-label" id="controller-env-label">{t("Variables this profile adds")}</span>
      <code className="launch-command" role="textbox" aria-readonly="true" aria-labelledby="controller-env-label" tabIndex={0}>{applied.map(([key, value]) => `${key}=${value.includes("\n") ? `${value.split("\n")[0]} …` : value}`).join("\n")}</code>
    </div>}
  </section>;
}
