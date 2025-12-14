/*
  Build script:
  - Aggregates and minifies CSS (Bootstrap, Bootstrap Icons, app.css) into dist/build/css/app.bundle.min.css
  - Aggregates and minifies core JS (jQuery, Bootstrap bundle, app.js) into dist/build/js/core.bundle.min.js
  - Creates per-page JS bundles by concatenating the page-specific scripts found in each HTML file (dist/build/js/pages/...)
  - Writes transformed HTML files to dist/ and updates them to reference the new bundled assets
*/

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const fg = require('fast-glob');
const postcss = require('postcss');
const cssnano = require('cssnano');
const postcssUrl = require('postcss-url');
const { minify } = require('terser');
const { minify: minifyHtml } = require('html-minifier-terser');
const { HtmlValidate } = require('html-validate');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(DIST, 'build');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function cleanDir(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
}

function readFileSyncSafe(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

function toAbsWeb(src) {
  // Normalize a script/link src from HTML to an absolute filesystem path under PUBLIC
  if (src.startsWith('http')) return null; // skip external
  let rel = src.startsWith('/') ? src.slice(1) : src;
  return path.join(PUBLIC, rel);
}

function pageNameFromHtml(htmlFile) {
  const rel = path.relative(PUBLIC, htmlFile).replace(/\\/g, '/');
  const noExt = rel.replace(/\.html$/i, '');
  return noExt.replace(/\//g, '-');
}

async function buildCSS() {
  const cssDir = path.join(BUILD, 'css');
  const fontsDir = path.join(BUILD, 'fonts');
  await ensureDir(cssDir);
  await ensureDir(fontsDir);

  const cssFiles = [path.join(PUBLIC, 'vendor/bootstrap/css/bootstrap.min.css'), path.join(PUBLIC, 'vendor/bootstrap/css/bootstrap-icons.css'), path.join(PUBLIC, 'css/app.css')];

  // Process each CSS file to copy assets (fonts) and rewrite URLs
  const processedCss = [];
  for (const file of cssFiles) {
    const css = readFileSyncSafe(file);
    if (!css) continue;
    const res = await postcss([postcssUrl({ url: 'copy', assetsPath: fontsDir, useHash: false })]).process(css, { from: file, to: path.join(cssDir, path.basename(file)) });
    processedCss.push(res.css);
  }

  const combined = processedCss.join('\n\n');
  const minified = await postcss([cssnano({ preset: 'default' })]).process(combined, {
    from: undefined,
    to: path.join(cssDir, 'app.bundle.min.css'),
    map: false,
  });
  await fsp.writeFile(path.join(cssDir, 'app.bundle.min.css'), minified.css, 'utf8');
}

async function buildCoreJS() {
  const jsDir = path.join(BUILD, 'js');
  await ensureDir(jsDir);
  const files = [path.join(PUBLIC, 'vendor/jquery/jquery.min.js'), path.join(PUBLIC, 'vendor/bootstrap/js/bootstrap.bundle.min.js'), path.join(PUBLIC, 'js/app.js')];
  const content = files
    .map((f) => readFileSyncSafe(f))
    .filter(Boolean)
    .join('\n;\n');
  const result = await minify(content, { compress: true, mangle: true });
  await fsp.writeFile(path.join(jsDir, 'core.bundle.min.js'), result.code || '', 'utf8');
}

function extractLocalScripts(html) {
  // Return ordered list of script srcs (local only), excluding core vendor and app.js which we bundle separately
  const regex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
  const srcs = [];
  let match;
  while ((match = regex.exec(html))) {
    const src = match[1];
    if (/\/vendor\/jquery\/jquery\.min\.js/.test(src)) continue;
    if (/\/vendor\/bootstrap\/js\/bootstrap\.bundle\.min\.js/.test(src)) continue;
    if (/(^|\/)js\/app\.js$/.test(src)) continue; // matches /js/app.js or js/app.js
    // Only include our local JS under /js
    if (/(^|\/)js\//.test(src)) srcs.push(src);
  }
  return srcs;
}

async function buildPerPageJS(htmlFiles) {
  const pagesDir = path.join(BUILD, 'js', 'pages');
  await ensureDir(pagesDir);
  const map = {}; // pageName -> array of sources

  for (const file of htmlFiles) {
    const html = readFileSyncSafe(file);
    const pageName = pageNameFromHtml(file);
    const srcs = extractLocalScripts(html);
    if (!srcs.length) continue;
    const absFiles = srcs
      .map(toAbsWeb)
      .filter(Boolean)
      .filter((p) => fs.existsSync(p));
    const content = absFiles.map((f) => readFileSyncSafe(f)).join('\n;\n');
    const result = await minify(content, { compress: true, mangle: true });
    const outPath = path.join(pagesDir, `${pageName}.bundle.min.js`);
    await fsp.writeFile(outPath, result.code || '', 'utf8');
    map[file] = `/build/js/pages/${pageName}.bundle.min.js`;
  }
  return map; // mapping of html file -> page bundle web path
}

function replaceCssLinks(html) {
  // Remove vendor bootstrap css + icons + /css/app.css and insert one bundled link
  const lines = html.split(/\r?\n/);
  const keep = [];
  let inserted = false;
  let insertIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isVendorBootstrap = /href=["']\/?vendor\/bootstrap\/css\/bootstrap\.min\.css["']/.test(line);
    const isIcons = /href=["']\/?vendor\/bootstrap\/css\/bootstrap-icons\.css["']/.test(line);
    const isAppCss = /href=["']\/?css\/app\.css["']/.test(line);
    if (isVendorBootstrap || isIcons || isAppCss) {
      if (insertIndex === -1) insertIndex = keep.length;
      continue; // skip
    }
    keep.push(line);
  }
  if (insertIndex !== -1) {
    keep.splice(insertIndex, 0, '    <link rel="stylesheet" href="/build/css/app.bundle.min.css" />');
    inserted = true;
  }
  return { html: keep.join('\n'), changed: inserted };
}

function replaceScripts(html, pageBundleWebPath) {
  // Remove vendor jquery + bootstrap + app.js and any page js we bundled; insert core + page bundle
  const scriptRegex = /<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi;
  const scripts = [];
  let m;
  while ((m = scriptRegex.exec(html))) scripts.push({ src: m[1], start: m.index, end: scriptRegex.lastIndex });

  let firstVendorIdx = -1;
  const toRemove = new Set();
  for (let i = 0; i < scripts.length; i++) {
    const src = scripts[i].src;
    if (
      /\/vendor\/jquery\/jquery\.min\.js/.test(src) ||
      /\/vendor\/bootstrap\/js\/bootstrap\.bundle\.min\.js/.test(src) ||
      /(^|\/)js\/app\.js$/.test(src) ||
      (/^\/?js\//.test(src) && pageBundleWebPath)
    ) {
      if (firstVendorIdx === -1) firstVendorIdx = scripts[i].start;
      // mark entire tag for removal
      toRemove.add(i);
    }
  }
  // Build new HTML by removing marked scripts
  let newHtml = '';
  let lastIndex = 0;
  for (let i = 0; i < scripts.length; i++) {
    if (toRemove.has(i)) {
      newHtml += html.slice(lastIndex, scripts[i].start);
      lastIndex = scripts[i].end;
    }
  }
  newHtml += html.slice(lastIndex);

  if (firstVendorIdx === -1) {
    // Insert before closing body if we didn't find a vendor block
    const closingBody = /<\/body>/i;
    const match = closingBody.exec(newHtml);
    const inject = `\n    <script src="/build/js/core.bundle.min.js"></script>\n${pageBundleWebPath ? `    <script src="${pageBundleWebPath}"></script>\n` : ''}`;
    if (match) {
      newHtml = newHtml.slice(0, match.index) + inject + newHtml.slice(match.index);
    } else {
      newHtml += inject;
    }
    return { html: newHtml, changed: true };
  }

  const inject = `    <script src="/build/js/core.bundle.min.js"></script>\n${pageBundleWebPath ? `    <script src="${pageBundleWebPath}"></script>` : ''}`;
  // Insert the new scripts at the position of first vendor script
  newHtml = newHtml.slice(0, firstVendorIdx) + inject + newHtml.slice(firstVendorIdx);
  return { html: newHtml, changed: true };
}

async function updateHtmlFiles(pageBundleMap) {
  const htmlFiles = fg.sync([
    path.join(PUBLIC, '**/*.html').replace(/\\/g, '/'),
    `!${path.join(PUBLIC, 'partials/**').replace(/\\/g, '/')}`,
    `!${path.join(PUBLIC, 'vendor/**').replace(/\\/g, '/')}`,
  ]);

  const htmlvalidate = new HtmlValidate({
    extends: ['html-validate:recommended'],
    rules: {
      // be pragmatic: keep noise low for typical bootstrap/html includes
      'void-style': 'off',
      'no-trailing-whitespace': 'off',
      'attr-case': 'off',
    },
  });

  for (const srcFile of htmlFiles) {
    let html = readFileSyncSafe(srcFile);
    const { html: cssHtml } = replaceCssLinks(html);
    html = cssHtml;
    const { html: jsHtml } = replaceScripts(html, pageBundleMap[srcFile]);
    html = jsHtml;
    // Sanity-check HTML
    const report = htmlvalidate.validateString(html, srcFile);
    if (!report.valid) {
      const msgs = report.results?.[0]?.messages || [];
      console.warn(`HTML validation issues in ${path.relative(PUBLIC, srcFile)} (${msgs.length}):`);
      msgs.slice(0, 10).forEach((m) => {
        const where = m.line != null && m.column != null ? `${m.line}:${m.column}` : '';
        console.warn(` - [${m.ruleId || m.rule}] ${where} ${m.message}`);
      });
      if (msgs.length > 10) console.warn(` - ...and ${msgs.length - 10} more`);
    }
    // Minify HTML
    const minified = await minifyHtml(html, {
      collapseWhitespace: true,
      conservativeCollapse: true,
      removeComments: true,
      removeRedundantAttributes: true,
      removeEmptyAttributes: false,
      decodeEntities: true,
      keepClosingSlash: true,
      sortClassName: true,
      minifyCSS: true,
      minifyJS: true,
    });
    const rel = path.relative(PUBLIC, srcFile);
    const destFile = path.join(DIST, rel);
    await ensureDir(path.dirname(destFile));
    await fsp.writeFile(destFile, minified, 'utf8');
  }
}

async function copyStatic() {
  // Copy partials, images, vendor, and other required static files
  const dirsToCopy = ['partials', 'images', 'vendor'];
  for (const dir of dirsToCopy) {
    const srcDir = path.join(PUBLIC, dir);
    if (fs.existsSync(srcDir)) {
      const files = fg.sync([path.join(srcDir, '**/*')], { dot: true });
      for (const f of files) {
        const rel = path.relative(PUBLIC, f);
        const dest = path.join(DIST, rel);
        if (fs.statSync(f).isDirectory()) {
          await ensureDir(dest);
        } else {
          await ensureDir(path.dirname(dest));
          await fsp.copyFile(f, dest);
        }
      }
    }
  }

  // Favicon
  const favSrc = path.join(PUBLIC, 'favicon.png');
  if (fs.existsSync(favSrc)) {
    await ensureDir(DIST);
    await fsp.copyFile(favSrc, path.join(DIST, 'favicon.png'));
  }
}

async function main() {
  console.log('Cleaning dist directory...');
  await cleanDir(DIST);
  await ensureDir(BUILD);

  console.log('Building CSS bundle...');
  await buildCSS();

  console.log('Building core JS bundle...');
  await buildCoreJS();

  console.log('Creating per-page JS bundles...');
  const allHtml = fg.sync([
    path.join(PUBLIC, '**/*.html').replace(/\\/g, '/'),
    `!${path.join(PUBLIC, 'partials/**').replace(/\\/g, '/')}`,
    `!${path.join(PUBLIC, 'vendor/**').replace(/\\/g, '/')}`,
  ]);
  const pageBundleMap = await buildPerPageJS(allHtml);

  console.log('Updating HTML files to reference bundles (to dist)...');
  await updateHtmlFiles(pageBundleMap);

  console.log('Copying static assets...');
  await copyStatic();

  console.log('Build complete. Output in dist/.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
