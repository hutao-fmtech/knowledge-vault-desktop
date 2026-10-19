import { writeClipViaFsAccess } from '../modules/write-fsaccess.js';

const els = {
  quote: document.getElementById('quote'),
  annotation: document.getElementById('annotation'),
  meta: document.getElementById('meta'),
  status: document.getElementById('status'),
  save: document.getElementById('save'),
};

/** @type {{ pageTitle: string, sourceUrl: string }} */
let page = { pageTitle: '', sourceUrl: '' };

function setStatus(text, kind) {
  els.status.textContent = text || '';
  els.status.className = kind || '';
}

async function loadSelectionFromTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  page = { pageTitle: tab.title || '', sourceUrl: tab.url || '' };
  els.meta.textContent = page.pageTitle ? page.pageTitle : page.sourceUrl;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'kvd-get-selection' });
    if (res && typeof res.quote === 'string') {
      els.quote.value = res.quote;
      if (res.pageTitle) page.pageTitle = res.pageTitle;
      if (res.sourceUrl) page.sourceUrl = res.sourceUrl;
      els.meta.textContent = page.pageTitle || page.sourceUrl;
    }
  } catch {
    // Content script may be missing on chrome:// etc.
  }
  const sess = await chrome.storage.session.get(['pendingClip']);
  if (sess.pendingClip && sess.pendingClip.quote && !els.quote.value) {
    els.quote.value = sess.pendingClip.quote;
    page.pageTitle = sess.pendingClip.pageTitle || page.pageTitle;
    page.sourceUrl = sess.pendingClip.sourceUrl || page.sourceUrl;
    els.meta.textContent = page.pageTitle || page.sourceUrl;
    await chrome.storage.session.remove('pendingClip');
  }
}

els.save.addEventListener('click', async () => {
  const quote = els.quote.value;
  if (!quote.trim()) {
    setStatus('请先选中或粘贴要摘录的文本', 'err');
    return;
  }
  els.save.disabled = true;
  setStatus('正在写入…', '');
  const result = await writeClipViaFsAccess({
    sourceUrl: page.sourceUrl,
    pageTitle: page.pageTitle || 'untitled',
    quote,
    annotation: els.annotation.value,
  });
  els.save.disabled = false;
  if (result.ok) {
    setStatus(`已保存：01-收件箱/${result.filename}`, 'ok');
  } else {
    setStatus(result.error || '保存失败', 'err');
  }
});

loadSelectionFromTab();
