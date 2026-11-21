/** 自测共用的小工具：定位 DSH 安装目录、读 patch、按包名加载插件。 */
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/**
 * DSH 安装目录的 node_modules 根目录（`<...>/dsh/node_modules`）。
 * 优先读 DSH_NODE_MODULES，其次由 DSH_INSTALL_DIR 推出；
 * 找不到返回 null（离线环境由调用方打印 SKIP）。
 */
export function findNodeModulesRoot() {
  const candidates = [];
  if (process.env.DSH_NODE_MODULES) candidates.push(process.env.DSH_NODE_MODULES);
  if (process.env.DSH_INSTALL_DIR) candidates.push(path.resolve(process.env.DSH_INSTALL_DIR, '..', '..'));
  return (
    candidates.find(
      (dir) => dir && existsSync(path.join(dir, '@deepseek-ai', 'dsh-agent-preset', 'package.json')),
    ) || null
  );
}

/** 从 cordis.patch.yml 文本里取出 preset-bot 段引用的全部包名。 */
export function readPresetPluginNames(patchText) {
  const index = patchText.indexOf('preset-bot');
  const text = index === -1 ? patchText : patchText.slice(index);
  return [
    ...new Set(
      [...text.matchAll(/name:\s*'([^']+)'|name:\s*"([^"]+)"/g)]
        .map((match) => match[1] ?? match[2])
        .filter((name) => name && name.includes('/')),
    ),
  ];
}

/** 按包名（含 scope，如 @deepseek-ai/dsh-persona）导入插件入口模块。 */
export async function importPackageEntry(nodeModulesRoot, name) {
  const pkgDir = path.join(nodeModulesRoot, name);
  const metaPath = path.join(pkgDir, 'package.json');
  if (!existsSync(metaPath)) throw new Error(`缺少 package.json：${name}`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const exposed = meta.exports?.['.'] ?? meta.main ?? 'index.js';
  const entry = typeof exposed === 'string' ? exposed : exposed?.import ?? exposed?.default;
  return import(pathToFileURL(path.resolve(pkgDir, entry)).href);
}

/** 从 DSH 自带依赖里加载 js-yaml 的 load()，找不到返回 null。 */
export async function loadYaml(nodeModulesRoot) {
  const candidates = [
    path.resolve(nodeModulesRoot, 'js-yaml', 'index.js'),
    path.resolve(nodeModulesRoot, '..', '..', 'node_modules', 'js-yaml', 'index.js'),
  ];
  for (const candidate of candidates) {
    try {
      const mod = await import(pathToFileURL(candidate).href);
      const load = mod.default?.load ?? mod.load;
      if (typeof load === 'function') return load;
    } catch {
      /* 试下一个候选路径 */
    }
  }
  return null;
}