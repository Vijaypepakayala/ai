#!/usr/bin/env node
// Dedicated bin entry: always starts the server, regardless of how the
// process was invoked (node dist/cli.js, npx bin symlink, etc). Keeping
// server.ts import-safe lets tests build servers without side effects.
import { main } from "./server.js";

main().catch((err) => {
  console.error("[telnyx-claude-connector] fatal:", err);
  process.exit(1);
});
