// js/charts.js — tiny dependency-free bar chart (HTML + CSS, theme-aware, fully translatable labels)
function svgBarChart(data, opts) {
  opts = opts || {};
  if (!data.length) return '<p class="hint">No data available yet.</p>';
  const max = Math.max(...data.map((d) => d.value), 1);
  const color = opts.color || 'var(--accent)';
  return `<div class="hbars">${data.map((d) => `
    <div class="hbar">
      <span class="hbar__label">${esc(d.label)}</span>
      <span class="hbar__track"><i style="width:${Math.max(3, Math.round((d.value / max) * 100))}%; background:${color};"></i></span>
      <b class="hbar__value">${esc(d.value)}</b>
    </div>`).join('')}</div>`;
}
