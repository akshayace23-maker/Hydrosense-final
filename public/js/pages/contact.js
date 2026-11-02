document.getElementById('contactForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const purpose = document.getElementById('purpose').value;
  const message = document.getElementById('message').value;
  const subject = encodeURIComponent(`HydroSense contact — ${purpose}`);
  const body = encodeURIComponent(`From: ${name} (${email})\n\n${message}`);
  window.location.href = `mailto:contact@hydrosense.local?subject=${subject}&body=${body}`;
});
