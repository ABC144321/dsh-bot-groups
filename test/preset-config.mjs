/**
 * dsh-bot-groups · Bot 模式配置自测
 *
 * 把 cordis.patch.yml 里 `preset-bot` 每条插件的 config 喂给该插件自己导出的
 * Config（schemastery）校验一遍：写错的键会在这里当场暴露，而不是等用户新建
 * 「Bot 模式」会话时崩在激活阶段。
 *
 * 需要 DSH 安装目录与该目录里的 js-yaml；找不到时打印 SKIP 并以 0 退出。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  findNodeModulesRoot,
  importPackageEntry,
  loadYaml,
} from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const nodeModules = findNodeModulesRoot();
if (!nodeModules) {
  console.log('SKIP 未找到 DSH 安装目录（设置 DSH_INSTALL_DIR 后重跑）');
  process.exit(0);
}
const load = await loadYaml(nodeModules);
if (!load) {
  console.log('SKIP 未找到 js-yaml');
  process.exit(0);
}

// `!!js` 是 Cordis 的表达式标签，普通 YAML 解析器不认识；配置校验用不到 disabled，
// 直接抹掉标签让它能解析。
const raw = readFileSync(path.join(here, '..', 'cordis.patch.yml'), 'utf8').replace(/!!js\s+/g, '');
const rows = load(raw).flatMap((row) => row.insert ?? []);
const preset = rows.find((row) => row.id === 'preset-bot');
if (!preset) {
  console.log('FAIL cordis.patch.yml 里没有 preset-bot 行');
  process.exit(1);
}

let checked = 0;
let failures = 0;
for (const plugin of preset.config.plugins) {
  if (!plugin || !plugin.name || plugin.group === true) continue;
  const spec = String(plugin.name);
  if (spec.startsWith('.') || spec.startsWith('/') || !spec.includes('/')) continue;
  let mod;
  try {
    mod = await importPackageEntry(nodeModules, spec);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${spec}: ${error.message}`);
    continue;
  }
  const Config = mod.Config ?? (mod.default ?? mod)?.Config;
  if (typeof Config !== 'function') {
    console.log(`skip ${spec}（无 Config 导出）`);
    continue;
  }
  checked += 1;
  try {
    Config(plugin.config ?? {});
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${spec} config: ${error.message}`);
  }
}

console.log(`\nconfigChecked=${checked} failures=${failures}`);
if (failures > 0) process.exitCode = 1;