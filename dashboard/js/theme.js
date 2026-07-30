function applyStoredTheme() {
  const stored = localStorage.getItem("theme");
  const theme = stored || (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", theme);
}

function toggleTheme() {
  const isLight = document.documentElement.getAttribute("data-theme") === "light";
  const next = isLight ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
  updateToggleIcon();
}

function updateToggleIcon() {
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    btn.textContent = isLight ? "\u{1F319}" : "\u{2600}\u{FE0F}";
    btn.title = isLight ? "Switch to dark mode" : "Switch to light mode";
  });
}

applyStoredTheme();

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".theme-toggle").forEach((btn) => {
    btn.addEventListener("click", toggleTheme);
  });
  updateToggleIcon();
});
