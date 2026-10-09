import { useModImportScan } from "./useModImportScan";
import { NxmPrompt } from "./NxmPrompt";

/** App-wide mod work that has no page of its own: the import-time mod scan and the nxm:// download prompt. Loaded lazily from App. */
export function ModBackground() {
  useModImportScan();
  return <NxmPrompt />;
}
