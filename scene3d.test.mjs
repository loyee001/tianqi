import test from 'node:test';
import assert from 'node:assert/strict';
import {Ray,Vector3} from './vendor/three.module.js';
import {resolveGroundPick} from './scene3d.mjs';
const ray=(origin,direction)=>new Ray(new Vector3(...origin),new Vector3(...direction).normalize());

test('a downward ray returns a ground point in the original plan coordinates',()=>{
  const hit=resolveGroundPick(ray([0,10,0],[0,-1,0]));
  assert.equal(hit.status,'ready');assert.deepEqual(hit.mapPoint,{x:490,y:285});
});
test('sky and outside-campus clicks produce explicit failures',()=>{
  assert.equal(resolveGroundPick(ray([0,2,0],[0,.01,-1])).status,'no-ground');
  const outside=resolveGroundPick(ray([80,2,0],[0,-1,0]));assert.equal(outside.status,'out-of-bounds');assert.match(outside.message,/边界/);
});
test('clicking a building roof or through a wall cannot select hidden ground',()=>{
  assert.equal(resolveGroundPick(ray([-29.2,15,-10.4],[0,-1,0])).status,'building');
  assert.equal(resolveGroundPick(ray([-15,3,-10.4],[-1,-.1,0])).status,'building');
});
test('uploaded images do not inherit invented sample building restrictions',()=>{
  assert.equal(resolveGroundPick(ray([-29.2,15,-10.4],[0,-1,0]),{buildings:[]}).status,'ready');
});
test('tree clearance does not prevent marking a route beside a building',()=>{
  const nearWall=ray([-17.7,10,-10.4],[0,-1,0]);
  assert.equal(resolveGroundPick(nearWall,{clearance:1}).status,'clearance');
  assert.equal(resolveGroundPick(nearWall,{clearance:0}).status,'ready');
});
