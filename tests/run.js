// Runs every tests/*.test.js in one process with node's built-in test runner.
// `node --test` would do the same, but its file globbing is broken in some
// distro builds of node 22 ("Missing internal module 'internal/deps/brace-expansion'"),
// so the files are required directly. A failing test sets a non-zero exit code.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith(".test.js")).sort()) {
  require(path.join(__dirname, f));
}
