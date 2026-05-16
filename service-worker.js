chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ sessions: [], projectRules: [] }, (state) => {
    chrome.storage.local.set({
      sessions: state.sessions,
      projectRules: state.projectRules.length
        ? state.projectRules
        : [
            { name: "Writing", keywords: "docs, notion, medium, substack, overleaf, google.com/document", color: "blue" },
            { name: "Research", keywords: "scholar, arxiv, wikipedia, pubmed, archive", color: "green" },
            { name: "Admin", keywords: "mail, calendar, bank, billing, invoice", color: "yellow" }
          ]
    });
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "OPEN_DASHBOARD") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-dashboard") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  }
});
