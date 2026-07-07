// scripts/validate-meta.mjs
// テーブル定義YAMLを JSON Schema で検証する(CI / make validate-meta 用)。
// 依存: npm i -D ajv yaml  (リポジトリルートで)
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import YAML from "yaml";
import Ajv2020 from "ajv/dist/2020.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const metaDir = join(root, "backend", "meta");

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
const schema = JSON.parse(readFileSync(join(metaDir, "table.schema.json"), "utf8"));
const validate = ajv.compile(schema);

let failed = false;
for (const f of readdirSync(join(metaDir, "tables")).filter(f => f.endsWith(".yaml"))) {
  const doc = YAML.parse(readFileSync(join(metaDir, "tables", f), "utf8"));
  if (validate(doc)) {
    console.log(`${f}: OK`);
  } else {
    failed = true;
    console.error(`${f}: FAILED`);
    console.error(JSON.stringify(validate.errors, null, 2));
  }
}
process.exit(failed ? 1 : 0);
