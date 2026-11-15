// Build artifacts are created on a developer machine or GitHub-hosted runner.
// The production server only verifies and serves the resulting static files.
import { constants } from 'node:fs';
import { lstat, readdir, open, readFile, mkdir, writeFile, rename, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

export const LIMITS = Object.freeze({ files: 500, fileBytes: 10 * 1024 * 1024, totalBytes: 50 * 1024 * 1024 });
export const EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.txt']);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const fail = message => { throw new Error(message); };

export function validatePath(path, isFile = true) {
  if (typeof path !== 'string' || path.length < 1 || path.length > 200
    || !path.split('/').every(part => /^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(part))) {
    fail(`Unsafe static path: ${path}`);
  }
  if (isFile && !EXTENSIONS.has(extname(path).toLowerCase())) fail(`Disallowed static extension: ${path}`);
}

function tarName(path) {
  if (path.length <= 100) return { name: path, prefix: '' };
  for (let i = path.lastIndexOf('/'); i > 0; i = path.lastIndexOf('/', i - 1)) {
    if (i <= 155 && path.length - i - 1 <= 100) return { prefix: path.slice(0, i), name: path.slice(i + 1) };
  }
  fail(`Path cannot be represented in USTAR: ${path}`);
}

function tarHeader(path, bytes, timestamp) {
  const header = Buffer.alloc(512);
  const { name, prefix } = tarName(path);
  const string = (value, offset, width) => header.write(value, offset, width, 'ascii');
  const octal = (value, offset, width) => string(value.toString(8).padStart(width - 1, '0') + '\0', offset, width);
  string(name, 0, 100);
  octal(0o644, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(bytes, 124, 12);
  octal(timestamp, 136, 12);
  header.fill(32, 148, 156);
  string('0', 156, 1); // Only regular files: no links, directories, PAX or GNU extensions.
  string('ustar\0', 257, 6);
  string('00', 263, 2);
  string(prefix, 345, 155);
  string(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148, 8);
  return header;
}

async function collectFiles(distDir) {
  const rootInfo = await lstat(distDir);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('dist must be a real directory');
  const entries = [];
  let totalBytes = 0;
  async function walk(directory, prefix = '') {
    for (const name of (await readdir(directory)).sort(compare)) {
      const path = prefix ? `${prefix}/${name}` : name;
      validatePath(path, false);
      const absolute = join(directory, name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) fail(`Symbolic links are forbidden: ${path}`);
      if (info.isDirectory()) { await walk(absolute, path); continue; }
      if (!info.isFile()) fail(`Only regular files are allowed: ${path}`);
      validatePath(path);
      if (path === 'version.json') fail('dist/version.json is reserved; clean dist before building');
      if (entries.length + 1 >= LIMITS.files) fail('Too many static files (including version.json)');
      if (info.size > LIMITS.fileBytes) fail(`Static file exceeds 10 MiB: ${path}`);
      totalBytes += info.size;
      if (totalBytes > LIMITS.totalBytes) fail('Static files exceed 50 MiB');
      // O_NOFOLLOW also protects the leaf if it changes between lstat and open.
      const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      let data;
      try {
        const current = await handle.stat();
        if (!current.isFile() || current.size !== info.size || current.ino !== info.ino || current.dev !== info.dev) fail(`File changed while packaging: ${path}`);
        data = await handle.readFile();
      } finally { await handle.close(); }
      if (data.length !== info.size) fail(`File changed while packaging: ${path}`);
      tarName(path);
      entries.push({ path, data });
    }
  }
  await walk(distDir);
  const index = entries.find(entry => entry.path === 'index.html');
  if (!index || index.data.length === 0) fail('A nonempty dist/index.html is required');
  return entries;
}

export async function packageSite({ distDir = join(ROOT, 'dist'), outputDir = join(ROOT, 'release', 'site'), sourceSha = process.env.SOURCE_SHA || process.env.GITHUB_SHA, builtAt = new Date().toISOString(), version } = {}) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha || '')) fail('SOURCE_SHA must be a full lowercase Git commit SHA');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(builtAt) || !Number.isFinite(Date.parse(builtAt)) || new Date(builtAt).toISOString() !== builtAt) fail('built_at must be a UTC ISO timestamp');
  version ??= JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) fail('A valid package version is required');
  const entries = await collectFiles(resolve(distDir));
  entries.push({ path: 'version.json', data: Buffer.from(JSON.stringify({ source_sha: sourceSha, version, built_at: builtAt }, null, 2) + '\n') });
  entries.sort((a, b) => compare(a.path, b.path));
  if (entries.some(entry => entry.data.length > LIMITS.fileBytes)) fail('Static file exceeds 10 MiB, including generated metadata');
  const totalBytes = entries.reduce((sum, entry) => sum + entry.data.length, 0);
  if (entries.length > LIMITS.files || totalBytes > LIMITS.totalBytes) fail('Static package exceeds file count or total size limit');
  const parts = [];
  const timestamp = Math.floor(Date.parse(builtAt) / 1000);
  for (const { path, data } of entries) {
    parts.push(tarHeader(path, data.length, timestamp), data);
    const padding = (512 - data.length % 512) % 512;
    if (padding) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  const archive = gzipSync(Buffer.concat(parts), { level: 9 });
  const manifest = {
    schema_version: 1, repository: 'loyee001/tianqi', branch: 'main', source_sha: sourceSha, version, built_at: builtAt,
    archive: { path: 'site.tar.gz', sha256: sha256(archive), bytes: archive.length },
    files: entries.map(({ path, data }) => ({ path, bytes: data.length, sha256: sha256(data) })),
  };
  await mkdir(outputDir, { recursive: true });
  if ((await lstat(outputDir)).isSymbolicLink()) fail('Output directory must not be a symbolic link');
  // Publish only complete files. The workflow uploads these exact two paths.
  for (const [name, data] of [['site.tar.gz', archive], ['manifest.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const temporary = join(outputDir, `.${name}.${process.pid}.tmp`);
    await writeFile(temporary, data, { flag: 'wx', mode: 0o644 });
    await rename(temporary, join(outputDir, name));
  }
  return manifest;
}

async function selfTest() {
  const assert = await import('node:assert/strict');
  const { test } = await import('node:test');
  const root = await mkdtemp(join(tmpdir(), 'green-site-package-test-'));
  const options = { sourceSha: 'a'.repeat(40), builtAt: '2026-11-15T00:00:00.000Z', version: '0.8.0' };
  let serial = 0;
  async function fixture() {
    const dir = join(root, String(serial++));
    const distDir = join(dir, 'dist');
    await mkdir(distDir, { recursive: true });
    await writeFile(join(distDir, 'index.html'), '<!doctype html><title>Campus</title>');
    return { ...options, distDir, outputDir: join(dir, 'out') };
  }
  try {
    await test('archive and manifest bind exact bytes, paths and version metadata', async () => {
      const config = await fixture();
      await mkdir(join(config.distDir, 'vendor'));
      await writeFile(join(config.distDir, 'vendor', 'LICENSE.txt'), 'third-party license');
      const manifest = await packageSite(config);
      const packed = await readFile(join(config.outputDir, 'site.tar.gz'));
      assert.equal(manifest.archive.sha256, sha256(packed));
      assert.equal(manifest.archive.bytes, packed.length);
      const tar = gunzipSync(packed);
      const extracted = new Map();
      for (let offset = 0; offset < tar.length && tar[offset] !== 0;) {
        const header = tar.subarray(offset, offset + 512);
        const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
        const size = parseInt(header.subarray(124, 136).toString(), 8);
        assert.equal(header[156], '0'.charCodeAt(0));
        const expectedChecksum = parseInt(header.subarray(148, 156).toString(), 8);
        const checksumHeader = Buffer.from(header); checksumHeader.fill(32, 148, 156);
        assert.equal(checksumHeader.reduce((sum, byte) => sum + byte, 0), expectedChecksum);
        extracted.set(name, tar.subarray(offset + 512, offset + 512 + size));
        offset += 512 + Math.ceil(size / 512) * 512;
      }
      assert.deepEqual([...extracted.keys()], manifest.files.map(file => file.path));
      for (const file of manifest.files) {
        assert.equal(extracted.get(file.path).length, file.bytes);
        assert.equal(sha256(extracted.get(file.path)), file.sha256);
      }
      assert.deepEqual(JSON.parse(extracted.get('version.json')), { source_sha: options.sourceSha, version: options.version, built_at: options.builtAt });
      const repeated = await packageSite(config);
      assert.equal(repeated.archive.sha256, manifest.archive.sha256, 'same inputs must produce same archive');
    });
    await test('unsafe paths and non-static files are rejected', async () => {
      for (const path of ['../x.js', '/x.js', '.env', 'a/.secret.js', 'a//x.js', 'a/../x.js', 'a\\x.js', 'x\n.js', '校园.svg', 'run.sh', 'a'.repeat(201) + '.js']) assert.throws(() => validatePath(path));
      const config = await fixture();
      await writeFile(join(config.distDir, 'run.sh'), 'echo forbidden');
      await assert.rejects(packageSite(config), /Disallowed static extension/);
    });
    await test('file and directory symlinks are rejected', async () => {
      for (const directory of [false, true]) {
        const config = await fixture();
        await symlink(directory ? config.outputDir : join(config.distDir, 'index.html'), join(config.distDir, directory ? 'linked' : 'linked.html'));
        await assert.rejects(packageSite(config), /Symbolic links/);
      }
    });
    await test('oversized file and combined file sizes are rejected', async () => {
      const config = await fixture();
      const file = await open(join(config.distDir, 'large.js'), 'w');
      await file.truncate(LIMITS.fileBytes + 1); await file.close();
      await assert.rejects(packageSite(config), /exceeds 10 MiB/);
      const combined = await fixture();
      for (let i = 0; i < 6; i++) { const item = await open(join(combined.distDir, `${i}.js`), 'w'); await item.truncate(9 * 1024 * 1024); await item.close(); }
      await assert.rejects(packageSite(combined), /exceed 50 MiB/);
    });
    await test('file count includes generated version.json', async () => {
      const config = await fixture();
      await Promise.all(Array.from({ length: LIMITS.files - 1 }, (_, i) => writeFile(join(config.distDir, `${i}.js`), '')));
      await assert.rejects(packageSite(config), /Too many static files/);
    });
    await test('invalid release identity and stale version metadata are rejected', async () => {
      const config = await fixture();
      await assert.rejects(packageSite({ ...config, sourceSha: 'main' }), /SOURCE_SHA/);
      await assert.rejects(packageSite({ ...config, builtAt: 'yesterday' }), /UTC ISO/);
      await assert.rejects(packageSite({ ...config, version: '../../private' }), /package version/);
      await writeFile(join(config.distDir, 'version.json'), '{}');
      await assert.rejects(packageSite(config), /reserved/);
    });
    await test('a real index is required while empty optional static resources are valid', async () => {
      const config = await fixture();
      await writeFile(join(config.distDir, 'empty.css'), '');
      const manifest = await packageSite(config);
      assert.equal(manifest.files.find(file => file.path === 'empty.css').bytes, 0);
      await writeFile(join(config.distDir, 'index.html'), '');
      await assert.rejects(packageSite(config), /nonempty dist\/index.html/);
      await rm(join(config.distDir, 'index.html'));
      await assert.rejects(packageSite(config), /nonempty dist\/index.html/);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === '--self-test') await selfTest();
  else if (process.argv.length === 2) {
    const manifest = await packageSite();
    console.log(`Packaged ${manifest.files.length} static files for ${manifest.source_sha}; archive ${manifest.archive.bytes} bytes`);
  } else fail('Usage: SOURCE_SHA=<commit> node scripts/package-site.mjs [--self-test]');
}
