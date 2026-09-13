const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateObservation, validateDecision, isVerifiedCompletion } = require('./stage-contract.cjs');
const grid = () => ({ ready: true, rows:3, columns:3, cells: Array.from({length:9},(_,i)=>({index:i+1,contains_target:i===4})) });
test('duplicate, out-of-grid and nonboolean model observations are rejected', () => {
  const duplicate=grid();duplicate.cells[0].index=2;assert.throws(()=>validateObservation(duplicate,9));
  const outside=grid();outside.cells[0].index=10;assert.throws(()=>validateObservation(outside,9));
  const textBoolean=grid();textBoolean.cells[0].contains_target='false';assert.throws(()=>validateObservation(textBoolean,9));
});
test('an unready frame cannot authorize a click or verification', () => {
  const observation={...grid(),ready:false};
  assert.throws(()=>validateDecision(observation,{action:'select',cells:[5]}));
  assert.throws(()=>validateDecision(observation,{action:'verify',cells:[]}));
  assert.deepEqual(validateDecision(observation,{action:'wait',cells:[]}),[]);
});
test('executor cannot invent cells or verify while targets remain', () => {
  assert.throws(()=>validateDecision(grid(),{action:'select',cells:[1]}));
  assert.throws(()=>validateDecision(grid(),{action:'verify',cells:[]}));
  assert.deepEqual(validateDecision(grid(),{action:'select',cells:[5]}),[5]);
});
test('model reply 10 is not sufficient without real image challenge and server evidence', () => {
  const verdict={success:true,mode:'live',hostname:'captcha.liahuas.top'};
  assert.equal(isVerifiedCompletion(true,verdict,{result:10}),true);
  assert.equal(isVerifiedCompletion(false,verdict,{result:10}),false);
  for(const change of [{success:false},{mode:'test'},{hostname:'localhost'}])assert.equal(isVerifiedCompletion(true,{...verdict,...change},{result:10}),false);
  assert.equal(isVerifiedCompletion(true,verdict,{result:0}),false);
});
