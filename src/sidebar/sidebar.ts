document.querySelectorAll<HTMLButtonElement>('button[data-q]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const question = btn.dataset.q || '';
    if (!question) return;
    chrome.runtime.sendMessage({ type: 'quickAsk', question });
  });
});
