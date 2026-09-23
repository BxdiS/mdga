// Builds exactly what the installer ships (main-world bootstrap + every module
// bundle) and parses it without running it, so a bundling or syntax problem
// fails CI instead of surfacing inside a running Discord.
import { bundleBootstrap } from "../packages/installer/src/bundle.js";
import { collectModules } from "../packages/installer/src/modules.js";

let failed = false;
const check = (label: string, code: string): void => {
  try {
    new Function(code);
    console.log(`ok  ${label} (${code.length} bytes)`);
  } catch (err) {
    failed = true;
    console.error(`bad ${label}: ${(err as Error).message}`);
  }
};

check("bootstrap", await bundleBootstrap());
for (const m of await collectModules()) check(`module ${m.id}`, m.code);
if (failed) process.exit(1);
