import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  CATALOG_SOURCE_PATH,
  CLIENT_CATALOG_PATH,
  COVERAGE_REPORT_PATH,
  clientCatalogJson,
  coverageReportMarkdown,
  createCatalogSource,
  GENERATED_SHARED_PATH,
  generatedSharedSource,
  readCatalogSource,
  readRawIndex,
  sourceCatalogJson,
  validateCatalog,
} from "./tiny-swords-catalog-lib.js";

const bootstrap = process.argv.includes("--bootstrap");
const index = readRawIndex();
const catalog = bootstrap ? createCatalogSource(index) : readCatalogSource();
const validation = validateCatalog(index, catalog);
if (validation.errors.length > 0) {
  throw new Error(`Tiny Swords catalogue invalid:\n${validation.errors.join("\n")}`);
}

if (bootstrap) writeFileSync(CATALOG_SOURCE_PATH, sourceCatalogJson(catalog));
mkdirSync(path.dirname(CLIENT_CATALOG_PATH), { recursive: true });
mkdirSync(path.dirname(COVERAGE_REPORT_PATH), { recursive: true });
writeFileSync(CLIENT_CATALOG_PATH, clientCatalogJson(catalog));
writeFileSync(GENERATED_SHARED_PATH, generatedSharedSource(catalog));
writeFileSync(COVERAGE_REPORT_PATH, coverageReportMarkdown(catalog, validation.report));

const report = validation.report;
console.log(
  `Tiny Swords: ${report.raw} raw, ${report.catalogued} catalogued, ${report.ui} UI, ${report.editor} editor, ${report.ignored} ignored, ${report.unclassified.length} unclassified`,
);
