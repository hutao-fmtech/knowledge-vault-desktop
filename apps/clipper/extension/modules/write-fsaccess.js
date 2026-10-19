import { CLIP_INBOX_DIR } from './constants.js';
import { allocateUniqueClipFilename } from './filename.js';
import { formatClipMarkdown, formatClippedAt } from './format.js';
import { ensureReadWritePermission, loadVaultRootHandle } from './idb-handle.js';

/**
 * @param {FileSystemDirectoryHandle} dir
 * @returns {Promise<string[]>}
 */
async function listNames(dir) {
  const names = [];
  for await (const [name] of dir.entries()) {
    names.push(name);
  }
  return names;
}

/**
 * @param {FileSystemDirectoryHandle} dir
 * @param {string} name
 */
async function fileExists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a clip into vaultRoot/01-收件箱 via File System Access API.
 * @param {{ sourceUrl: string, pageTitle: string, quote: string, annotation?: string }} input
 * @returns {Promise<{ ok: true, filename: string, markdown: string } | { ok: false, error: string, needVault?: boolean }>}
 */
export async function writeClipViaFsAccess(input) {
  const vault = await loadVaultRootHandle();
  if (!vault) {
    return { ok: false, error: '尚未选择 Vault 根目录', needVault: true };
  }
  const allowed = await ensureReadWritePermission(vault);
  if (!allowed) {
    return { ok: false, error: '没有 Vault 写入权限，请在选项页重新授权', needVault: true };
  }

  let inbox;
  try {
    inbox = await vault.getDirectoryHandle(CLIP_INBOX_DIR, { create: false });
  } catch {
    return {
      ok: false,
      error: `Vault 根目录下找不到「${CLIP_INBOX_DIR}」。请选择含该文件夹的知识库根目录。`,
      needVault: true,
    };
  }

  // Only write into the inbox handle (never create siblings under vault root).
  const existing = await listNames(inbox);
  const filename = allocateUniqueClipFilename(input.pageTitle, existing);
  if (await fileExists(inbox, filename)) {
    return { ok: false, error: `目标已存在，拒绝覆盖：${filename}` };
  }

  const markdown = formatClipMarkdown({
    sourceUrl: input.sourceUrl == null ? '' : String(input.sourceUrl),
    pageTitle: input.pageTitle == null ? '' : String(input.pageTitle),
    clippedAt: formatClippedAt(new Date()),
    quote: input.quote == null ? '' : String(input.quote),
    annotation: input.annotation == null ? '' : String(input.annotation),
  });

  try {
    const fileHandle = await inbox.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(markdown);
    await writable.close();
    return { ok: true, filename, markdown };
  } catch (err) {
    return { ok: false, error: `写入失败：${err && err.message ? err.message : String(err)}` };
  }
}
