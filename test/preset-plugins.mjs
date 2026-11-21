/**
 * dsh-bot-groups · Bot 模式依赖自测
 *
 * 校验 cordis.patch.yml 里 `preset-bot` 引用的每个插件包，都能在当前 DSH 安装目录
 * 里真的加载（导出函数或 { apply }），避免「模式一选就崩」。
 *
 * 需要 DSH 安装目录：设置 DSH_INSTALL_DIR 指向
 *   <...>/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh
 * 找不到时打印 SKIP 并以 0 退出（离线环境不阻塞 CI）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { findNodeModulesRoot, importPackageEntry, readPresetPluginNames } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const nodeModules = findNodeModulesRoot();
if (!nodeModules) {
  console.log('SKIP 未找到 DSH 安装目录（设置 DSH_INSTALL_DIR 后重跑）');
  process.exit(0);
}

const patch = readFileSync(path.join(here, '..', 'cordis.patch.yml'), 'utf8');
const names = readPresetPluginNames(patch);

let failures = 0;
for (const name of names) {
  try {
    const mod = await importPackageEntry(nodeModules, name);
    const plugin = mod.default ?? mod;
    const ok = typeof plugin === 'function' || (plugin && typeof plugin.apply === 'function');
    if (!ok) failures += 1;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error && error.message}`);
  }
}

console.log(`\npackages=${names.length} failures=${failures}`);
if (failures > 0) process.exitCode = 1;