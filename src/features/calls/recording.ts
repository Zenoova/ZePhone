import { toast } from "@yusufceng1z/ding-react";

import { errorMessage, telephony } from "@/services/telephony";
import type { Call } from "@/types/telephony";

/** Starts or stops the local recording of a call, and tells the user how it went. */
export async function toggleRecording(call: Call): Promise<void> {
  try {
    if (!call.recording) {
      await telephony.startRecording(call.id);
      return;
    }
    const rec = await telephony.stopRecording();
    if (rec) toast.success("Enregistrement ajouté", { description: "Retrouvez-le dans l'onglet Enregistrements." });
    else toast.info("Aucun son n'a été enregistré");
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** A recording can only be started on a call that is established. */
export const canRecord = (call: Call): boolean => call.state === "connected" || call.state === "onHold";
