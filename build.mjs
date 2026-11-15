import { mkdir, copyFile, cp } from 'node:fs/promises';
const files=['index.html','style.css','app.mjs','budget.mjs','geometry.mjs','movement.mjs','scene3d.mjs','collision.mjs','campus-buildings.mjs','climate-ui.mjs','climate-simulation.mjs','climate-recommendations.mjs','planting-recommendations.mjs','pedestrians.mjs'];
await mkdir(new URL('./dist/',import.meta.url),{recursive:true});
await Promise.all(files.map(file=>copyFile(new URL(file,import.meta.url),new URL(`./dist/${file}`,import.meta.url))));
await cp(new URL('./vendor/',import.meta.url),new URL('./dist/vendor/',import.meta.url),{recursive:true});
console.log('Static demo prepared in dist/');
