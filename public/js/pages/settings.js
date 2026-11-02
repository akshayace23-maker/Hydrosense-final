function strength(pw) {
  let n = 0;
  if (pw.length >= 10) n++; if (pw.length >= 14) n++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++;
  if (/\d/.test(pw)) n++; if (/[^A-Za-z0-9]/.test(pw)) n++;
  return n;
}
(async () => {
  const user = await requireAuth();
  if (!user) return;
  const card = document.getElementById('accountCard');
  card.innerHTML = `<h4>Account</h4><p><strong>${esc(user.name)}</strong><br>${esc(user.email)}<br><span>Role: ${esc(statusLabel(user.role))}</span></p>`;
  document.getElementById('pName').value = user.name;
  document.getElementById('pPhone').value = user.phone || '';
  if (user.role === 'citizen') document.getElementById('dangerCard').style.display = 'block';

  document.getElementById('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.put('/api/auth/profile', { name: document.getElementById('pName').value, phone: document.getElementById('pPhone').value });
      toast('Profile saved.');
      const fresh = await currentUser(true);
      card.innerHTML = `<h4>Account</h4><p><strong>${esc(fresh.name)}</strong><br>${esc(fresh.email)}<br><span>Role: ${esc(statusLabel(fresh.role))}</span></p>`;
    } catch (err) { showError(err); }
  });

  const bar = document.getElementById('pwBar');
  document.getElementById('newPw').addEventListener('input', (e) => {
    const n = strength(e.target.value);
    bar.style.width = (n * 20) + '%';
    bar.style.background = n <= 2 ? 'var(--danger)' : (n === 3 ? 'var(--amber)' : 'var(--moss)');
  });
  document.getElementById('pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/auth/change-password', { current_password: document.getElementById('curPw').value, new_password: document.getElementById('newPw').value });
      toast('Password changed. Other devices have been signed out.');
      e.target.reset(); bar.style.width = '0';
    } catch (err) { showError(err); }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => { await api.post('/api/auth/logout'); location.href = '/'; });
  document.getElementById('logoutAllBtn').addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Sign out everywhere?', message: 'You will be signed out on every device, including this one.', okText: 'Sign out everywhere' }))) return;
    try { await api.post('/api/auth/logout-all'); location.href = '/login.html'; } catch (err) { showError(err); }
  });
  document.getElementById('delForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!(await confirmDialog({ title: 'Delete your account?', message: 'All your reports, photos and confirmations will be permanently removed.', okText: 'Delete my account', danger: true }))) return;
    try { await api.del('/api/auth/account', { password: document.getElementById('delPw').value }); toast('Your account has been deleted.'); setTimeout(() => { location.href = '/'; }, 900); }
    catch (err) { showError(err); }
  });
})();

const langSelect = document.getElementById('langSelect');
langSelect.value = hsLang();
langSelect.addEventListener('change', () => hsSetLang(langSelect.value));
window.addEventListener('hs-lang', (e) => { langSelect.value = e.detail; });
