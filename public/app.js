const $ = (id) => document.getElementById(id);
const controls = ['amount', 'limit', 'recipient', 'instruction'].map($);
let scenarios = [];
let selectedScenario = 'within-budget';
let busy = false;
let hasResult = false;

const displayText = (value) => String(value ?? '')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email hidden]')
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[network address hidden]')
  .replace(/\b[1-9A-HJ-NP-Za-km-z]{32,88}\b/g, '[address hidden]');
function setText(id, value) { $(id).textContent = displayText(value); }
function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = displayText(text);
  return element;
}
async function getJSON(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('The review service could not complete this request. Check the inputs and try again.');
  return response.json();
}
function showError(message) {
  setText('form-error', message);
  $('form-error').hidden = false;
}
function clearError() { $('form-error').hidden = true; $('form-error').textContent = ''; }
function markChanged() {
  clearError();
  if (!hasResult) return;
  setText('review-state', 'INPUT CHANGED');
  $('review-state').className = 'review-state';
  setText('evidence-caption', 'Previous review · run again');
  setText('result-announcement', 'Inputs changed. The displayed result is from the previous review. Review again for updated results.');
}
function selectScenario(id) {
  const scenario = scenarios.find((item) => item.id === id);
  if (!scenario || busy) return;
  selectedScenario = id;
  $('amount').value = scenario.input.amountSol;
  $('limit').value = scenario.input.limitSol;
  $('recipient').value = scenario.input.recipient;
  $('instruction').value = scenario.input.instruction;
  for (const button of $('scenario-list').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.scenario === id));
  }
  markChanged();
}
function renderScenarios(items) {
  const symbols = { 'within-budget': '↗', 'over-budget': '↟', 'unknown-recipient': '◇', 'injected-request': '⌁' };
  $('scenario-list').replaceChildren();
  for (const scenario of items) {
    const button = make('button', 'scenario-card');
    button.type = 'button';
    button.dataset.scenario = scenario.id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `${scenario.title}. ${scenario.description}`);
    const symbol = make('span', 'scenario-symbol', symbols[scenario.id] ?? '◇');
    symbol.setAttribute('aria-hidden', 'true');
    const copy = make('span', 'scenario-copy');
    copy.append(make('span', 'scenario-title', scenario.title), make('span', 'scenario-description', scenario.description));
    const radio = make('span', 'scenario-radio');
    radio.setAttribute('aria-hidden', 'true');
    button.append(symbol, copy, radio);
    button.addEventListener('click', () => selectScenario(scenario.id));
    $('scenario-list').append(button);
  }
  selectScenario(items[0]?.id);
}
function setBusy(value) {
  busy = value;
  $('review-button').disabled = value;
  $('review-button').querySelector('.button-text').textContent = value ? 'Reviewing transaction…' : 'Review this transaction';
  for (const control of controls) control.disabled = value;
  for (const button of $('scenario-list').querySelectorAll('button')) button.disabled = value;
  document.querySelector('.results-panel').setAttribute('aria-busy', String(value));
  $('loading-state').hidden = !value;
  if (value) {
    $('empty-state').hidden = true;
    $('review-result').hidden = true;
    setText('review-state', 'REVIEWING');
    $('review-state').className = 'review-state working';
    setText('evidence-caption', 'Review in progress');
    setText('simulation-status', 'Checking…');
    setText('simulation-detail', 'Waiting for ERPC');
    setText('simulation-meta', '');
    setText('verification-status', 'Pending');
    setText('verification-detail', 'No verification claim until evidence returns');
    $('simulation-status').className = 'evidence-value';
    $('verification-status').className = 'evidence-value';
    setText('result-announcement', 'Review started. Nothing is being signed or broadcast.');
  }
}
function renderResult(result) {
  const allowed = result.policy.decision === 'allow';
  $('empty-state').hidden = true;
  $('review-result').hidden = false;
  $('decision-card').className = `decision-card${allowed ? '' : ' blocked'}`;
  setText('decision-icon', allowed ? '✓' : '×');
  setText('decision-title', allowed ? 'Within your policy.' : 'Outside your policy.');
  setText('decision-subtitle', allowed ? 'The proposal passes the explicit rules below. No transaction was sent.' : 'The proposal fails an explicit rule. AI cannot override this decision.');
  setText('review-state', 'REVIEW COMPLETE');
  $('review-state').className = 'review-state done';
  $('policy-checks').replaceChildren();
  for (const check of result.policy.checks) {
    const item = make('li', 'policy-check');
    const mark = make('span', `check-mark${check.passed ? '' : ' fail'}`, check.passed ? '✓' : '×');
    mark.setAttribute('aria-hidden', 'true');
    const content = make('span', 'check-content');
    content.append(make('strong', '', check.label), make('span', '', check.detail));
    item.append(mark, content, make('span', `check-status${check.passed ? '' : ' fail'}`, check.passed ? 'Pass' : 'Blocked'));
    $('policy-checks').append(item);
  }
  const explanation = result.explanation;
  setText('explanation-text', explanation.text || 'The private AI explanation is unavailable for this review. The policy decision remains based on the explicit checks above.');
  setText('ai-status', explanation.status === 'complete' ? 'NEAR AI CLOUD' : 'UNAVAILABLE');
  $('ai-status').className = `mini-badge${explanation.status === 'complete' ? '' : ' unavailable'}`;
  setText('model-label', explanation.status === 'complete' ? `Model · ${explanation.model}` : 'Connect NEAR AI Cloud to enable private explanations.');

  const simulationLabels = { passed: 'Simulation passed', failed: 'Simulation failed', unavailable: 'Unavailable', 'not-run': 'Not run' };
  const simulation = result.simulation;
  setText('simulation-status', simulationLabels[simulation.status] ?? 'Unknown');
  $('simulation-status').className = `evidence-value${simulation.status === 'passed' ? '' : ' warn'}`;
  setText('simulation-detail', simulation.detail);
  const metadata = [];
  if (typeof simulation.slot === 'number') metadata.push(`Slot ${simulation.slot.toLocaleString('en-US')}`);
  if (typeof simulation.unitsConsumed === 'number') metadata.push(`${simulation.unitsConsumed.toLocaleString('en-US')} compute units`);
  setText('simulation-meta', metadata.join(' · '));

  const verification = explanation.verification;
  const verificationLabels = { verified: 'Verified', unverified: 'Not fully verified', unavailable: 'Unavailable' };
  setText('verification-status', verificationLabels[verification.status] ?? 'Unknown');
  $('verification-status').className = `evidence-value${verification.status === 'verified' ? '' : ' warn'}`;
  setText('verification-detail', verification.detail);
  const hasProviderResult = explanation.status === 'complete' || simulation.status === 'passed' || simulation.status === 'failed';
  setText('evidence-caption', hasProviderResult ? 'Provider results received' : 'Local policy · no provider result');
  setText('result-announcement', `Review complete. Policy ${allowed ? 'allows' : 'blocks'} this proposal. ${simulationLabels[simulation.status]}. NEAR AI: ${verificationLabels[verification.status]}. No transaction was sent.`);
  hasResult = true;
}
controls.forEach((control) => control.addEventListener('input', markChanged));
$('review-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !$('review-form').reportValidity()) return;
  clearError();
  const input = {
    scenarioId: selectedScenario,
    amountSol: $('amount').value.trim(),
    limitSol: $('limit').value.trim(),
    recipient: $('recipient').value,
    instruction: $('instruction').value.trim(),
  };
  setBusy(true);
  try {
    const result = await getJSON('/api/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    renderResult(result);
  } catch (error) {
    showError(error instanceof Error && error.name === 'TimeoutError' ? 'The review timed out. No transaction was signed or sent. Please try again.' : 'The review could not finish. Check the connection and input values, then try again. No transaction was sent.');
    hasResult = false;
    $('empty-state').hidden = false;
    $('review-result').hidden = true;
    setText('review-state', 'REVIEW INCOMPLETE');
    $('review-state').className = 'review-state';
    setText('evidence-caption', 'Review incomplete');
    setText('simulation-status', 'No result');
    setText('simulation-detail', 'The request did not complete');
    setText('simulation-meta', '');
    setText('verification-status', 'No result');
    setText('verification-detail', 'No evidence available for this request');
    setText('result-announcement', 'The review could not finish. No transaction was signed or sent.');
  } finally {
    setBusy(false);
  }
});
async function initialize() {
  const [status, scenarioResponse] = await Promise.allSettled([getJSON('/api/status'), getJSON('/api/scenarios')]);
  if (status.status === 'fulfilled') {
    const data = status.value;
    const ready = data.rpcConfigured && data.aiConfigured;
    const partial = data.rpcConfigured || data.aiConfigured;
    $('connection-state').replaceChildren(make('span', `status-dot${ready ? '' : ' offline'}`), document.createTextNode(ready ? 'NEAR AI + ERPC configured' : partial ? 'Partial setup · one provider configured' : 'Offline · policy checks only'));
  } else {
    $('connection-state').replaceChildren(make('span', 'status-dot offline'), document.createTextNode('Service unavailable'));
  }
  if (scenarioResponse.status === 'fulfilled' && Array.isArray(scenarioResponse.value) && scenarioResponse.value.length) {
    scenarios = scenarioResponse.value;
    renderScenarios(scenarios);
    $('review-button').disabled = false;
  } else {
    $('scenario-list').replaceChildren(make('p', 'scenario-loading', 'Scenarios could not load. Refresh when the local service is running.'));
    showError('The local review service is unavailable. Start the application and refresh this page.');
  }
}
initialize();
