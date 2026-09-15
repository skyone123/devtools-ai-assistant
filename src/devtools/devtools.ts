let mainPanel: chrome.devtools.panels.ExtensionPanel | null = null;

chrome.devtools.panels.create(
  'AI Assistant',
  'icons/icon48.png',
  'panel.html',
  (panel) => {
    mainPanel = panel;
  }
);

chrome.devtools.panels.elements.createSidebarPane('AI Assistant', (sidebar) => {
  sidebar.setPage('sidebar.html');
  sidebar.setHeight('132px');
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'quickAsk' && mainPanel) {
    mainPanel.show();
  }
});
