import test from 'node:test';
import assert from 'node:assert/strict';
import {createMovement} from './movement.mjs';

test('a normal press jumps once and gravity returns to the ground',()=>{
  const m=createMovement();assert.equal(m.spaceDown(10).grounded,false);
  const first=m.advance(.1);assert.ok(first.heightM>0);
  m.spaceDown(50,{repeat:true});assert.equal(m.snapshot().flying,false);
  for(let i=0;i<100;i++)m.advance(.016);
  assert.deepEqual(m.snapshot(),{state:'ground',flying:false,grounded:true,heightM:0,verticalSpeedMps:0});
});
test('quick double press enables flight while repeat events cannot enable it',()=>{
  const m=createMovement();m.spaceDown(0);m.advance(.05);m.spaceDown(100,{repeat:true});assert.equal(m.snapshot().flying,false);
  m.spaceDown(200);assert.equal(m.snapshot().flying,true);
});
test('slow presses do not toggle flight, and airborne presses cannot double jump',()=>{
  const m=createMovement();m.spaceDown(0);m.advance(.1);const before=m.snapshot().verticalSpeedMps;
  m.spaceDown(500);assert.equal(m.snapshot().flying,false);assert.equal(m.snapshot().verticalSpeedMps,before);
});
test('flight ascends, hovers, descends and stays above the floor',()=>{
  const m=createMovement();m.toggleFlight();m.advance(1,{up:true});assert.equal(m.snapshot().heightM,4.5);
  m.advance(1);assert.equal(m.snapshot().heightM,4.5);assert.equal(m.snapshot().verticalSpeedMps,0);
  m.advance(.5,{down:true});assert.equal(m.snapshot().heightM,2.25);
  m.advance(5,{down:true});assert.equal(m.snapshot().heightM,0);assert.equal(m.snapshot().flying,true);
});
test('double press exits flight and falls gradually rather than teleporting',()=>{
  const m=createMovement();m.toggleFlight();m.advance(2,{up:true});m.spaceDown(500);m.spaceDown(650);
  assert.equal(m.snapshot().flying,false);assert.equal(m.snapshot().heightM,9);
  const falling=m.advance(.1);assert.ok(falling.heightM<9&&falling.heightM>8);assert.ok(falling.verticalSpeedMps<0);
  m.advance(2);assert.equal(m.snapshot().heightM,0);assert.equal(m.snapshot().grounded,true);
});
test('roofs support landing, and stepping away begins a fall',()=>{
  const m=createMovement();m.toggleFlight();m.advance(2,{up:true});m.toggleFlight();m.advance(1,{floorM:5});
  assert.equal(m.snapshot().heightM,5);assert.equal(m.snapshot().grounded,true);
  m.advance(.1,{floorM:0});assert.ok(m.snapshot().heightM<5);assert.equal(m.snapshot().grounded,false);
});
test('reset clears flight and height; blur clears a pending double press',()=>{
  const m=createMovement();m.spaceDown(0);m.clearTap();m.spaceDown(50);assert.equal(m.snapshot().flying,false);
  m.toggleFlight();m.advance(1,{up:true});m.reset();assert.equal(m.snapshot().heightM,0);assert.equal(m.snapshot().grounded,true);assert.equal(m.snapshot().flying,false);
});
test('jumping or flying cannot raise the head through a ceiling',()=>{
  const m=createMovement();m.toggleFlight();m.advance(1,{up:true,ceilingM:1.7});assert.equal(m.snapshot().heightM,1.7);assert.equal(m.snapshot().verticalSpeedMps,0);
  m.advance(1,{up:true,ceilingM:1.7});assert.equal(m.snapshot().heightM,1.7);
  m.advance(.1,{down:true,ceilingM:1.7});assert.ok(m.snapshot().heightM<1.7);
  m.reset();m.jump();m.advance(.2,{ceilingM:.3});assert.equal(m.snapshot().heightM,.3);assert.equal(m.snapshot().verticalSpeedMps,0);
});
