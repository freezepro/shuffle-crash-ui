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
  assert.equal(value("grid-template-columns"), "repeat(5, minmax(90px, 1fr)) minmax(136px, 1.5fr) minmax(90px, .95fr)");
  assert.equal(value("--stat-value-size"), "32px");
  assert.notEqual(value("justify-content"), "space-between");
  const compact = css.nodes.find(node => node.type === "atrule" && node.name === "container");
  assert.equal(compact.nodes.find(node => node.selector === ".row").nodes.find(node => node.prop === "--stat-value-size").value, "24px");
  const tabs = fs.readFileSync(path.join(__dirname, "../app/components/StakeViewTabs.tsx"), "utf8");
  assert.match(tabs, /wrap\(1120\), padding: 0, boxSizing/);
  css.walkDecls("grid-template-columns", decl => assert(!decl.value.includes("repeat(2,")));
  css.walkDecls("grid-column", decl => assert.notEqual(decl.value, "1 / -1"));
  css.walkDecls("overflow-x", decl => assert(!["auto", "scroll"].includes(decl.value)));
  css.walkDecls("order", decl => assert.notEqual(decl.value, "-1"));
});
