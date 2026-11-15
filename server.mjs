import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const allowed=new Set(['index.html','style.css','app.mjs','budget.mjs','geometry.mjs','movement.mjs','scene3d.mjs','collision.mjs','campus-buildings.mjs','climate-ui.mjs','climate-simulation.mjs','climate-recommendations.mjs','planting-recommendations.mjs','pedestrians.mjs','vendor/three.module.js','vendor/three.core.js']);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8'};
const port=Number(process.env.PORT||4196);
http.createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';if(!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}const data=await readFile(path.join(root,name));res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);}catch{res.writeHead(500);res.end('Unable to serve page');}}).listen(port,'127.0.0.1',()=>console.log(`绿荫森林 Demo: http://127.0.0.1:${port}`));
