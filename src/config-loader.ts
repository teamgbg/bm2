import { existsSync } from "fs";
import path, { resolve, extname } from "path";
import type { EcosystemConfig } from "./types";

export async function loadEcosystemConfig(filePath: string): Promise<EcosystemConfig> {
  
  const abs = resolve(filePath);
  
  if (!existsSync(abs)) {
    throw new Error(`Ecosystem file not found: ${abs}`);
  }

  const ext = extname(abs);
  
  let config;
  
  if (ext === ".json") {
    config = (await Bun.file(abs).json()) as EcosystemConfig;
  } else {
    const mod = await import(abs);
    config = (mod.default || mod) as EcosystemConfig;
  }
  
  const cwd = path.dirname(abs);
    
  config.apps = config.apps.map(i => {
    if ((i.cwd || "").trim() == "") i.cwd = cwd
    return i;
  })

  return config
}
