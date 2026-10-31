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

// Switches to an already-open dashboard instead of opening another copy.
const openDashboard = async () => {
  const url = chrome.runtime.getURL("dashboard.html");
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.windows.update(existing.windowId, { focused: true });
    await chrome.tabs.update(existing.id, { active: true });
    return;
  }
  await chrome.tabs.create({ url });
};

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "OPEN_DASHBOARD") openDashboard();
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-dashboard") openDashboard();
});
