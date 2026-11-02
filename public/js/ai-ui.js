// js/ai-ui.js — renders the "AI-assisted photo check" card honestly for every outcome.
(function () {
  const LABELS = {
    floating_garbage: 'Floating garbage', dead_fish: 'Dead fish', algal_growth: 'Algal-looking growth', excessive_vegetation: 'Excessive vegetation',
    muddy_water: 'Muddy water', foam_froth: 'Foam / froth', possible_discharge_outlet: 'Possible discharge outlet', waste_on_bank: 'Waste on the bank',
    erosion: 'Bank erosion', encroachment_construction: 'Encroachment / construction', oil_sheen: 'Oily film on the water', discoloured_water: 'Discoloured water',
  };
  const REL = {
    relevant: ['pill-resolved', 'Photo appears to show a water body'],
    uncertain: ['pill-under_review', 'Could not tell clearly from the photo'],
    not_relevant: ['pill-rejected', 'Photo may not show a water body — an authority will review it'],
  };
  // ai: { status, relevance, indicators[], note, error, question, options[] }
  window.hsAiCard = function hsAiCard(ai, opts) {
    opts = opts || {};
    const disclaimer = '<p style="font-size:0.85rem; font-style:italic; margin:10px 0 0;">AI assists evidence review only — it never confirms pollution and does not replace authority inspection.</p>';
    let body;
    if (!ai || ai.status === 'not_configured') {
      body = '<p>The AI photo check is not switched on for this website. Your report still goes to the authorities, who review every photo.</p>';
    } else if (ai.status === 'basic') {
      const inds = (ai.indicators || []).map((i) => `<span class="pill pill-under_review">${esc(LABELS[i] || statusLabel(i))}</span>`).join(' ');
      body = `<p><span class="pill pill-submitted">Basic colour check (no AI)</span></p>
        ${ai.note ? `<p>${esc(ai.note)}</p>` : ''}
        ${inds ? `<p style="margin-bottom:4px;"><strong>Possible visible indicators:</strong></p><div class="badge-row">${inds}</div>` : ''}
        <p class="hint">This is a simple colour check, not AI. A fuller AI check is not available right now; the authorities review every photo.</p>`;
    } else if (ai.status === 'failed') {
      body = `<p>The AI photo check could not be completed${ai.error ? ' (' + esc(ai.error) + ')' : ''}. Your report was still submitted and the authorities will review the photos.</p>`;
    } else {
      const rel = REL[ai.relevance] || REL.uncertain;
      const inds = (ai.indicators || []).map((i) => `<span class="pill pill-under_review">${esc(LABELS[i] || statusLabel(i))}</span>`).join(' ');
      body = `<p><span class="pill ${rel[0]}">${rel[1]}</span></p>
        ${ai.note ? `<p>${esc(ai.note)}</p>` : ''}
        <p style="margin-bottom:4px;"><strong>Possible visible indicators:</strong></p>
        <div class="badge-row">${inds || '<span>None flagged</span>'}</div>
        ${ai.question ? `<p style="margin-top:12px;"><strong>Question for the reporter:</strong> ${esc(ai.question)}${(ai.options || []).length ? ' <span class="hint">(' + ai.options.map(esc).join(' · ') + ')</span>' : ''}</p>` : ''}`;
    }
    return `<div class="card" style="margin-top:16px;" id="aiCard"><h4>AI-assisted photo check</h4>${body}${disclaimer}${opts.extra || ''}</div>`;
  };
  // Build the ai object from the columns stored on a report row.
  window.hsAiFromReport = function (r) {
    let f = {}; try { f = JSON.parse(r.ai_followup || '{}') || {}; } catch (e) { f = {}; }
    let inds = []; try { inds = JSON.parse(r.ai_indicators || '[]') || []; } catch (e) { inds = []; }
    const status = f.status || (r.ai_relevance && r.ai_relevance !== 'unchecked' ? 'ok' : 'not_configured');
    return { status, relevance: r.ai_relevance, indicators: inds, note: f.note || '', error: f.error || '', question: f.question || '', options: f.options || [] };
  };
})();
