let role = new URLSearchParams(location.search).get('role') === 'authority' ? 'authority' : 'citizen';

function strength(pw) {
  let n = 0;
  if (pw.length >= 10) n++; if (pw.length >= 14) n++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++;
  if (/\d/.test(pw)) n++; if (/[^A-Za-z0-9]/.test(pw)) n++;
  return n;
}
function applyRoleUI() {
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x.dataset.role === role));
  document.getElementById('emailHint').textContent = role === 'authority' ? 'Must end with @krct.ac.in — this is verified on the server.' : '';
  document.getElementById('inviteField').style.display = role === 'authority' ? 'block' : 'none';
}
applyRoleUI();
document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => { role = b.dataset.role; applyRoleUI(); }));

const bar = document.getElementById('pwBar');
document.getElementById('password').addEventListener('input', (e) => {
  const n = strength(e.target.value);
  bar.style.width = (n * 20) + '%';
  bar.style.background = n <= 2 ? 'var(--danger)' : (n === 3 ? 'var(--amber)' : 'var(--moss)');
});

document.getElementById('regForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertBox = document.getElementById('alertBox');
  const btn = document.getElementById('regBtn');
  alertBox.innerHTML = '';
  btn.disabled = true;
  try {
    const data = await api.post('/api/auth/register', {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      password: document.getElementById('password').value,
      invite_code: role === 'authority' ? document.getElementById('invite').value : undefined,
      role,
    });
    location.href = data.user.role === 'authority' ? '/authority-dashboard.html' : '/dashboard.html';
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    btn.disabled = false;
  }
});
