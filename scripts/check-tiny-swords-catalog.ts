import { readFileSync } from "node:fs";
import {
  CLIENT_CATALOG_PATH,
  COVERAGE_REPORT_PATH,
  clientCatalogJson,
  coverageReportMarkdown,
  GENERATED_SHARED_PATH,
  generatedSharedSource,
  readCatalogSource,
  readRawIndex,
  validateCatalog,
} from "./tiny-swords-catalog-lib.js";

const index = readRawIndex();
const catalog = readCatalogSource();
const validation = validateCatalog(index, catalog);
if (validation.errors.length > 0) {
  throw new Error(`Tiny Swords catalogue invalid:\n${validation.errors.join("\n")}`);
}
if (readFileSync(CLIENT_CATALOG_PATH, "utf8") !== clientCatalogJson(catalog)) {
  throw new Error("Client catalogue is stale. Run npm run catalog:build.");
}
if (readFileSync(GENERATED_SHARED_PATH, "utf8") !== generatedSharedSource(catalog)) {
  throw new Error("Shared catalogue is stale. Run npm run catalog:build.");
}
if (
  readFileSync(COVERAGE_REPORT_PATH, "utf8") !== coverageReportMarkdown(catalog, validation.report)
) {
  throw new Error("Catalogue coverage report is stale. Run npm run catalog:build.");
}

const report = validation.report;
console.log(
  `Tiny Swords catalogue valid: ${report.raw} raw, ${report.catalogued} catalogued, ${report.ui} UI, ${report.editor} editor, ${report.ignored} ignored, ${report.unclassified.length} unclassified`,
);
