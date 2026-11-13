// Builds web/compare.html by inlining the extension's own libraries into the
// web tool, so the page and the extension always score the same way.
// Usage: node web/build.js
const fs = require("fs"), path = require("path");
const root = path.join(__dirname, "..");
const libs = ["offers", "reviews", "unitprice", "scoring"]
  .map((f) => `/* lib/${f}.js */\n` + fs.readFileSync(path.join(root, "lib", f + ".js"), "utf8"))
  .join("\n");
const src = fs.readFileSync(path.join(__dirname, "compare.src.html"), "utf8");
fs.writeFileSync(path.join(__dirname, "compare.html"), src.replace("/*__LIBS__*/", () => libs));
console.log("wrote web/compare.html");
