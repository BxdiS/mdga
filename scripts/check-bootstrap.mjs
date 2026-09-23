// Syntax-checks the main-world bootstrap. It ships inside mdga_preload.js as
// a template string, so `node --check` on the file never parses its body; a
// typo there only surfaces inside a running Discord.
import fs from "node:fs";

const file = "packages/installer/src/templates/mdga_preload.js";
const src = fs.readFileSync(file, "utf-8");
const match = src.match(/const MAIN_WORLD_BOOTSTRAP = (`[\s\S]*?\n`);/);
if (!match) {
  console.error(`${file}: MAIN_WORLD_BOOTSTRAP not found`);
  process.exit(1);
}

try {
  // Evaluate the template literal to get the exact string Discord receives,
  // then parse it without running it.
  const body = new Function(`return ${match[1]};`)();
  new Function(body);
} catch (err) {
  console.error(`${file}: MAIN_WORLD_BOOTSTRAP does not parse: ${err.message}`);
  process.exit(1);
}
console.log("bootstrap parses");
