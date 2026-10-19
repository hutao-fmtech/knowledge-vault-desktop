const MENU_ID = 'kvd-clip-selection';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Clip to Knowledge Vault 收件箱',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;
  // Open popup-less flow: stash selection then open options/popup via action
  const quote = info.selectionText || '';
  await chrome.storage.session.set({
    pendingClip: {
      quote,
      pageTitle: tab.title || '',
      sourceUrl: info.pageUrl || tab.url || '',
    },
  });
  // MV3 cannot open popup programmatically reliably; open options with a flag.
  await chrome.storage.session.set({ openClipForm: true });
  chrome.runtime.openOptionsPage();
});
