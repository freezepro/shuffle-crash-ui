const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const postcss = require("postcss");

test("stat strip scales one row to its container without scrolling or stacking", () => {
  const css = postcss.parse(fs.readFileSync(path.join(__dirname, "../app/components/CrashPredictionTile.module.css"), "utf8"));
  const row = css.nodes.find(node => node.type === "rule" && node.selector === ".row");
  const value = prop => row.nodes.find(node => node.prop === prop)?.value;
  assert.equal(value("--stats-min-width"), "560px");
  assert.equal(value("width"), "max(100%, var(--stats-min-width))");
  assert.equal(value("zoom"), "min(1, calc(100cqi / var(--stats-min-width)))");
  css.walkDecls("grid-template-columns", decl => assert(!decl.value.includes("repeat(2,")));
  css.walkDecls("grid-column", decl => assert.notEqual(decl.value, "1 / -1"));
  css.walkDecls("overflow-x", decl => assert(!["auto", "scroll"].includes(decl.value)));
  css.walkDecls("order", decl => assert.notEqual(decl.value, "-1"));
});
