import {test} from 'node:test';
import assert from 'node:assert/strict';
import {capturedTicks,ticksNote} from '../src/core/captured-ticks.js';
test('partial exits use quantity weighted ticks independently of multiplier and quantity',()=>{
 const lots=[{direction:'long',entry_price:7744.25,exit_price:7748.25,quantity:2},{direction:'long',entry_price:7744.25,exit_price:7753.75,quantity:1},{direction:'long',entry_price:7744.25,exit_price:7763,quantity:1}];
 const result=capturedTicks(lots,.25);assert.equal(result.captured_ticks,36.25);assert.equal(result.contract_ticks,145);assert.deepEqual(result.lots.map(l=>l.ticks),[16,38,75]);
 assert.equal(capturedTicks(lots.map(l=>({...l,quantity:l.quantity*2})),.25).captured_ticks,36.25);
 assert.match(ticksNote(result),/36.25 ticks/);
});
test('shorts and losses retain sign; invalid or open evidence fails',()=>{
 assert.equal(capturedTicks([{direction:'short',entry_price:100,exit_price:99,quantity:1}],.25).captured_ticks,4);
 assert.equal(capturedTicks([{direction:'long',entry_price:100,exit_price:99,quantity:1}],.25).captured_ticks,-4);
 assert.equal(capturedTicks([{direction:'short',entry_price:100,exit_price:100,quantity:1}],.25).captured_ticks,0);
 assert.throws(()=>capturedTicks([],.25),/Closed matched/);assert.throws(()=>capturedTicks([],0),/tick size/);
 assert.throws(()=>capturedTicks([{direction:'long',entry_price:1,quantity:1}],.25),/Invalid/);
});
