async function loadNews() {
  const { news } = await api.get('/api/news');
  document.getElementById('list').innerHTML = news.length ? news.map((n) => `
    <div class="card">
      <span class="eyebrow">${statusLabel(n.category)}</span>
      <h4>${esc(n.title)}</h4>
      ${n.water_body_name ? `<p class="mono" style="font-size:0.8rem;">${esc(n.water_body_name)}</p>` : ''}
      <p>${esc(n.summary)}</p>
      <p style="font-size:0.8rem; color:var(--ink-soft);">${fmtDate(n.created_at)} · ${n.author_name}</p>
    </div>
  `).join('') : '<p>No data available yet.</p>';
}

(async () => {
  const user = await currentUser();
  if (user && user.role === 'authority') {
    document.getElementById('composer').innerHTML = `
      <div class="card" style="margin-bottom:10px;">
        <h4>Publish an update</h4>
        <form id="newsForm">
          <div class="field"><label>Title</label><input type="text" name="title" required></div>
          <div class="field"><label>Category</label>
            <select name="category">
              <option value="environmental_alert">Environmental alert</option>
              <option value="restoration_update">Restoration update</option>
              <option value="inspection_update">Inspection update</option>
              <option value="water_body_condition">Water-body condition</option>
              <option value="community_update">Community update</option>
              <option value="research_awareness">Research / awareness</option>
              <option value="achievement">Achievement</option>
            </select>
          </div>
          <div class="field"><label>Summary</label><textarea name="summary" rows="3" required></textarea></div>
          <button class="btn btn-primary" type="submit">Publish</button>
        </form>
      </div>`;
    document.getElementById('newsForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { await api.postForm('/api/news', fd); e.target.reset(); loadNews(); }
      catch (err) { showError(err); }
    });
  }
  loadNews();
})();
