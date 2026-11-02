const faqs = [
  ['What is HydroSense?', 'A citizen-centric platform that helps people report visible water-body problems with photos and location, and lets authorities review, act on, and track restoration of those reports over time.'],
  ['Can I report anonymously?', 'Yes. Toggle "Report anonymously" in the report form. Your name and email are hidden from authorities and other citizens — but since you\'re logged in, you can still see and track your own report from "My Reports."'],
  ['How does the AI image check work?', 'If enabled, it looks at your first photo and flags possible visible indicators (like garbage or algae-looking growth) and checks whether the photo plausibly shows a water body. It never confirms pollution — it\'s a helper, not a verdict.'],
  ['Does HydroSense replace laboratory water-quality testing?', 'No. It documents what citizens and authorities can visually observe. Anything requiring lab-confirmed parameters (pH, BOD, heavy metals, etc.) is outside its scope and would need proper testing.'],
  ['What happens after I submit a report?', 'It gets a unique Report ID and enters the review queue. An authority reviews it, may schedule a field inspection, records any action taken, and can request follow-up evidence. You can track every stage from "My Reports" or the public tracker.'],
  ['Can I report without GPS?', 'Yes — drag the map pin manually, or just add an approximate address/landmark. GPS is optional, never required.'],
  ['What does "I See This Too" mean?', 'It lets other citizens confirm they see the same issue at that water body, instead of filing a duplicate report. Reports with several confirmations get raised in priority.'],
  ['Who can access authority tools?', 'Only accounts registered with an official institutional email (restricted to a specific domain, verified server-side) — a normal citizen account can never gain authority access.'],
  ['How is my information protected?', 'Passwords are hashed, sessions use secure cookies, anonymous identity is hidden at the database level (not just the UI), and every sensitive action is checked against your logged-in role on the server.'],
];
document.getElementById('faqList').innerHTML = faqs.map(([q, a]) => `
  <div class="card" style="margin-bottom:12px;">
    <h4>${q}</h4>
    <p style="margin:0;">${a}</p>
  </div>
`).join('');
