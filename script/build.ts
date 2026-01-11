import { build as viteBuild } from "vite";
import { rm, cp, writeFile } from "fs/promises";

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("setting up server for production...");
  // Instead of bundling (which causes ES module issues), we create a simple wrapper
  // that uses tsx to run the TypeScript server directly
  const wrapper = `#!/usr/bin/env node
// Production wrapper - runs tsx directly to avoid ES/CJS bundling issues
const { spawn } = require('child_process');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server', 'index.ts');

const child = spawn('npx', ['tsx', serverPath], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' }
});

child.on('exit', (code) => process.exit(code || 0));
`;

  await writeFile("dist/index.cjs", wrapper);
  console.log("production setup complete");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
