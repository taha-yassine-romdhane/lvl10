import fs from "fs";
import path from "path";
import type { SavedRoom } from "./rooms";

/**
 * Rooms are saved to a JSON file so a restart or redeploy doesn't wipe
 * running games. Mount DATA_DIR on a volume in production.
 */
const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "rooms.json");

export function loadSavedRooms(): SavedRoom[] {
  try {
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw) as { version?: number; rooms?: SavedRoom[] };
    return Array.isArray(parsed.rooms) ? parsed.rooms : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("could not load saved rooms:", err);
    }
    return [];
  }
}

export function saveRooms(rooms: SavedRoom[]) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Write-then-rename so a crash mid-write never leaves a corrupt file.
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, rooms }));
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error("could not save rooms:", err);
  }
}
