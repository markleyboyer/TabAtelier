const openDashboard = document.querySelector("#openDashboard");

openDashboard.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
  window.close();
});
