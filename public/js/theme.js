// Applies the saved theme before first paint (external file so the strict CSP can stay on).
(function () { var t = 'dark'; try { t = localStorage.getItem('hs_theme') || 'dark'; } catch (e) {} document.documentElement.setAttribute('data-theme', t); })();
