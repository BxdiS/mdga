import * as asar from "@electron/asar";

export function extract(asarPath: string, dest: string): void {
  asar.extractAll(asarPath, dest);
}

export async function pack(srcDir: string, asarPath: string): Promise<void> {
  await asar.createPackage(srcDir, asarPath);
}
