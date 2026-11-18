import { json, route } from "@/lib/api";
import { requireUser } from "@/lib/session";
import { registerDeviceSchema } from "@/lib/validation";
import { registerDevice } from "@/lib/chat";
import { readJson } from "@/lib/api";

// Register this browser's public key. Called on every load: it either confirms
// the existing row or mints one. The private half stays in the browser.
export const POST = route(async (req: Request) => {
  const user = await requireUser();
  const body = registerDeviceSchema.parse(await readJson(req));
  const { deviceId } = await registerDevice(user, body.publicKey, body.label ?? null, body.deviceId ?? null);
  return json({ deviceId });
});
