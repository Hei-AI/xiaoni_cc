function validateObservation(observation, count) {
  if (typeof observation?.ready !== 'boolean' || !Array.isArray(observation.cells)) throw new Error('Invalid observation');
  if (!observation.ready) return;
  if (observation.rows * observation.columns !== count || observation.cells.length !== count ||
      new Set(observation.cells.map(c => c.index)).size !== count ||
      observation.cells.some(c => !Number.isInteger(c.index) || c.index < 1 || c.index > count || typeof c.contains_target !== 'boolean')) {
    throw new Error('Invalid visual grid observation');
  }
}
function validateDecision(observation, decision) {
  if (!['select','verify','wait','blocked'].includes(decision?.action) || !Array.isArray(decision.cells)) throw new Error('Invalid decision');
  const indices = [...new Set(decision.cells)];
  if (decision.action === 'select' && (!indices.length || !observation.ready || indices.some(i => !observation.cells.find(c => c.index === i && c.contains_target)))) {
    throw new Error('Action is not supported by current observation');
  }
  if (decision.action === 'verify' && (!observation.ready || indices.length || observation.cells.some(c => c.contains_target))) {
    throw new Error('Verify contradicts current observation');
  }
  return indices;
}
function isVerifiedCompletion(sawImages, verdict, verification) {
  return verification?.result === 10 && sawImages === true && verdict?.success === true && verdict.mode === 'live' && verdict.hostname === 'captcha.liahuas.top';
}
module.exports = { validateObservation, validateDecision, isVerifiedCompletion };
