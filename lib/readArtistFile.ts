import fs from "fs/promises";
import path from "path";

export async function readArtistFile(relPathFromRoot: string): Promise<string[]> {
  const fullPath = path.join(process.cwd(), relPathFromRoot);
  const raw = await fs.readFile(fullPath, "utf8");

  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("#")); 
}
