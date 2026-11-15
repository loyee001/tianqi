import test from 'node:test';
import assert from 'node:assert/strict';
import {blocksBody,verticalLimits,rayColliderDistance} from './collision.mjs';
const roof={cx:0,cz:0,halfWidth:2,halfDepth:5,minY:3.4,maxY:3.6,kind:'canopy'};
test('canopy roof blocks the head from below and supports feet from above',()=>{
  const below=verticalLimits({x:0,z:0},{feetY:0,height:1.7,baseY:0,colliders:[roof]});assert.equal(below.floorY,0);assert.equal(below.ceilingFeetY,1.7);
  const above=verticalLimits({x:0,z:0},{feetY:4,height:1.7,baseY:0,colliders:[roof]});assert.equal(above.floorY,3.6);assert.equal(above.ceilingFeetY,Infinity);
});
test('body cannot move sideways through a roof but can pass below and above',()=>{
  const options={height:1.7,radius:.3,colliders:[roof]};assert.equal(blocksBody({x:0,z:0},{...options,feetY:2}),true);assert.equal(blocksBody({x:0,z:0},{...options,feetY:0}),false);assert.equal(blocksBody({x:0,z:0},{...options,feetY:3.6}),false);
});
test('supports block movement and rotated roof uses its actual rectangle',()=>{
  const post={minX:-.1,maxX:.1,minZ:-.1,maxZ:.1,minY:0,maxY:3.5};assert.equal(blocksBody({x:.2,z:0},{feetY:0,height:1.7,radius:.2,colliders:[post]}),true);
  const angled={...roof,halfWidth:1,halfDepth:5,angle:Math.PI/2};assert.equal(blocksBody({x:4,z:0},{feetY:2,height:1.7,colliders:[angled]}),true);assert.equal(blocksBody({x:0,z:4},{feetY:2,height:1.7,colliders:[angled]}),false);
});
test('rays through a doorway miss split walls, while a wall ray is blocked',()=>{
  const left={minX:-4,maxX:-1,minZ:-.2,maxZ:.2,minY:0,maxY:3};const right={minX:1,maxX:4,minZ:-.2,maxZ:.2,minY:0,maxY:3};
  assert.equal(rayColliderDistance({x:0,y:1,z:3},{x:0,y:0,z:-1},left),null);assert.equal(rayColliderDistance({x:0,y:1,z:3},{x:0,y:0,z:-1},right),null);assert.ok(rayColliderDistance({x:2,y:1,z:3},{x:0,y:0,z:-1},right)>0);
});
