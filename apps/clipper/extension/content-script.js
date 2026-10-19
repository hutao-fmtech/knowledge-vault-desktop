chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'kvd-get-selection') return;
  const sel = window.getSelection();
  const quote = sel && String(sel.toString()) ? String(sel.toString()) : '';
  sendResponse({
    quote,
    pageTitle: document.title || '',
    sourceUrl: location.href || '',
  });
  return true;
});
