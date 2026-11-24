"use strict";

const clickEvents = new Set(["download", "setup", "github"]);
document.addEventListener("click", (event) => {
  const action = event.target.closest("a[data-event]")?.dataset.event;
  if (!clickEvents.has(action)) return;
  try {
    const key = "email-campaign-studio.click." + action;
    const previous = Number(localStorage.getItem(key)) || 0;
    localStorage.setItem(key, String(previous + 1));
  } catch {
    // Storage restrictions should never interrupt navigation.
  }
});

if (navigator.clipboard?.writeText) {
  for (const code of document.querySelectorAll("pre > code")) {
    const pre = code.parentElement;
    const wrapper = document.createElement("div");
    wrapper.className = "code-block";
    pre.before(wrapper);
    wrapper.append(pre);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = "Copy";
    button.setAttribute("aria-live", "polite");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = "Copied";
      } catch {
        button.textContent = "Copy failed";
      }
      window.setTimeout(() => { button.textContent = "Copy"; }, 1800);
    });
    wrapper.append(button);
  }
}
