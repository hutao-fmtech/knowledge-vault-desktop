import { CLIP_INBOX_DIR } from '../modules/constants.js';
import {
  clearVaultRootHandle,
  ensureReadWritePermission,
  loadVaultRootHandle,
  saveVaultRootHandle,
} from '../modules/idb-handle.js';
import { writeClipViaFsAccess } from '../modules/write-fsaccess.js';

const vaultLabel = document.getElementById('vault-label');
const status = document.getElementById('status');
const pickBtn = document.getElementById('pick');
const clearBtn = document.getElementById('clear');

function setStatus(el, text, kind) {
  el.textContent = text || '';
  el.className = kind || '';
}

async function refreshLabel() {
  const handle = await loadVaultRootHandle();
  if (!handle) {
    vaultLabel.textContent = '尚未选择';
    return;
  }
  vaultLabel.textContent = `已选择：${handle.name}（将写入 ${handle.name}/${CLIP_INBOX_DIR}/）`;
}

pickBtn.addEventListener('click', async () => {
  try {
    const handle = await window.showDirectoryPicker({
      id: 'kvd-vault-root',
      mode: 'readwrite',
      startIn: 'documents',
    });
    const ok = await ensureReadWritePermission(handle);
    if (!ok) {
      setStatus(status, '未获得写入权限', 'err');
      return;
    }
    try {
      await handle.getDirectoryHandle(CLIP_INBOX_DIR, { create: false });
    } catch {
      setStatus(status, `所选目录下没有「${CLIP_INBOX_DIR}」，请选择知识库根目录`, 'err');
      return;
    }
    await saveVaultRootHandle(handle);
    await refreshLabel();
    setStatus(status, '已保存 Vault 根目录（本地 IndexedDB，无云端）', 'ok');
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    setStatus(status, `选择失败：${err && err.message ? err.message : String(err)}`, 'err');
  }
});

clearBtn.addEventListener('click', async () => {
  await clearVaultRootHandle();
  await refreshLabel();
  setStatus(status, '已清除', 'ok');
});

async function maybeShowPendingClip() {
  const sess = await chrome.storage.session.get(['pendingClip', 'openClipForm']);
  if (!sess.openClipForm && !sess.pendingClip) return;
  await chrome.storage.session.remove('openClipForm');
  const card = document.getElementById('clip-card');
  card.hidden = false;
  const pending = sess.pendingClip || {};
  document.getElementById('quote').value = pending.quote || '';
  document.getElementById('clip-meta').textContent =
    [pending.pageTitle, pending.sourceUrl].filter(Boolean).join(' · ');
  document.getElementById('save-clip').onclick = async () => {
    const result = await writeClipViaFsAccess({
      sourceUrl: pending.sourceUrl || '',
      pageTitle: pending.pageTitle || 'untitled',
      quote: document.getElementById('quote').value,
      annotation: document.getElementById('annotation').value,
    });
    const el = document.getElementById('clip-status');
    if (result.ok) {
      setStatus(el, `已保存：01-收件箱/${result.filename}`, 'ok');
      await chrome.storage.session.remove('pendingClip');
    } else {
      setStatus(el, result.error || '保存失败', 'err');
    }
  };
}

refreshLabel();
maybeShowPendingClip();
