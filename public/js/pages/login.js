let role = new URLSearchParams(location.search).get('role') === 'authority' ? 'authority' : 'citizen';
const next = new URLSearchParams(location.search).get('next');

function applyRole() {
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.role === role));
  document.getElementById('emailHint').textContent = role === 'authority' ? 'Use your official @krct.ac.in email.' : '';
  document.getElementById('signupLink').href = '/register.html?role=' + role;
}
applyRole();
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => { role = b.dataset.role; applyRole(); }));

// Already signed in? Go straight to the right dashboard.
currentUser().then((u) => { if (u) location.replace(u.role === 'authority' ? '/authority-dashboard.html' : '/dashboard.html'); });

function safeNext(n) { return n && n.startsWith('/') && !n.startsWith('//') ? n : null; }

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertBox = document.getElementById('alertBox');
  const btn = document.getElementById('loginBtn');
  alertBox.innerHTML = '';
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) { alertBox.innerHTML = '<div class="alert alert-error">Enter a valid email and password.</div>'; return; }
  btn.disabled = true;
  try {
    const data = await api.post('/api/auth/login', { email, password });
    // The tab the person picked must match their account type.
    if (data.user.role !== role) {
      await api.post('/api/auth/logout');
      alertBox.innerHTML = `<div class="alert alert-error">${role === 'authority' ? 'This is a citizen account. Use the Citizen tab to log in.' : 'This is an authority account. Use the Authority tab to log in.'}</div>`;
      btn.disabled = false;
      return;
    }
    location.href = safeNext(next) || (data.user.role === 'authority' ? '/authority-dashboard.html' : '/dashboard.html');
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    btn.disabled = false;
  }
});
