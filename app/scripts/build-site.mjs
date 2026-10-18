// Builds the project's website (GitHub Pages) from what the app already ships: the READMEs as the documentation,
// the FAQ the help bot answers from, and the README screenshots. One source for all three, so the site, the
// bot and the repository never disagree.
//   node scripts/build-site.mjs [outDir]     → <repo>/site by default (index.html in English, tr/ in Turkish)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Marked } from 'marked';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..');
const out = path.resolve(process.argv[2] ?? path.join(repoRoot, 'site'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// ---- the FAQ module is TypeScript: bundled once into a temporary ES module
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'samsync-site-'));
const faqFile = path.join(tmp, 'faq.mjs');
await build({ entryPoints: [path.join(root, 'src', 'shared', 'help', 'faq.ts')], bundle: true, format: 'esm', platform: 'neutral', outfile: faqFile, logLevel: 'silent' });
const { FAQ, FAQ_TOPICS } = await import(pathToFileURL(faqFile).href);
fs.rmSync(tmp, { recursive: true, force: true });

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** The README as HTML: screenshots pointed at the copies next to the page, headings with anchors for the contents. */
function readmeHtml(file, depth) {
  const toc = [];
  const md = new Marked({
    renderer: {
      heading({ tokens, depth: level }) {
        const text = this.parser.parseInline(tokens);
        const plain = text.replace(/<[^>]+>/g, '');
        const id = slug(plain);
        if (level === 2) toc.push({ id, text: plain });
        return `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${text}</h${level}>\n`;
      },
      image({ href, title, text }) {
        const src = href.replace(/^(\.\.\/)?docs\/screenshots\//, `${'../'.repeat(depth)}screenshots/`);
        return `<img src="${esc(src)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''} loading="lazy">`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        // links inside the repository go to GitHub, outside ones stay as they are
        const abs = /^(https?:|mailto:|#)/.test(href) ? href : `${REPO}/blob/HEAD/${path.posix.normalize(`app/${href}`)}`;
        return `<a href="${esc(abs)}"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
      },
    },
  });
  // the first heading and the language link are the page's own header
  const src = fs
    .readFileSync(file, 'utf8')
    .replace(/^# .*\n/, '')
    .replace(/^\[(Türkçe|English)\]\([^)]*\)\s*\n/m, '');
  return { html: md.parse(src), toc };
}

function repoUrl() {
  try {
    const cfg = fs.readFileSync(path.join(repoRoot, '.git', 'config'), 'utf8');
    const m = /url = .*github\.com[:/]([^/\s]+)\/([^\s]+?)(?:\.git)?\s/.exec(cfg);
    if (m) return `https://github.com/${m[1]}/${m[2]}`;
  } catch {
    /* no git folder (a CI checkout has one) */
  }
  return process.env.GITHUB_REPOSITORY ? `https://github.com/${process.env.GITHUB_REPOSITORY}` : 'https://github.com';
}
const REPO = repoUrl();

const TEXT = {
  en: {
    lang: 'en',
    other: { href: 'tr/', label: 'Türkçe' },
    title: 'SamSync — send files to many machines at once',
    headline: 'Send files to many machines at once',
    tagline: 'Send files, folders and Git changes to many machines at the same relative path. Compare before writing, keep backups, undo a whole send, sync folders, and let one machine of a group pass a release on to the others.',
    download: 'Download for Windows',
    other_platforms: 'macOS and Linux',
    checksums: 'Checksums',
    features: 'What it does',
    screenshots: 'Screenshots',
    docs: 'Documentation',
    faq: 'Questions and answers',
    contents: 'Contents',
    version: `Latest version ${pkg.version}`,
    items: [
      ['Send to many', 'Pick files or folders, pick machines or whole groups, review what changes on each, send. The relative path below each machine’s root stays the same.'],
      ['Review first', 'Every send is compared with each target first: new, changed, newer on the target, extra. Nothing is written before you say so.'],
      ['Undo', 'Backups of what a send replaced or deleted stay on the target; the History page takes a whole send back in one click.'],
      ['Git aware', 'Send the files of chosen commits or your local changes, deletions included.'],
      ['Sync and automation', 'Two-way, mirror or update sync with conflict resolution; watches that send what changes; schedules.'],
      ['Relay and packs', 'One machine of a group passes a release on over the group’s own network and queues it for machines that are off. Or carry it on a disk as one (optionally encrypted) pack.'],
    ],
  },
  tr: {
    lang: 'tr',
    other: { href: '../', label: 'English' },
    title: 'SamSync — dosyaları aynı anda birçok makineye gönderin',
    headline: 'Dosyaları aynı anda birçok makineye gönderin',
    tagline: 'Dosyaları, klasörleri ve Git değişikliklerini birden çok makineye aynı göreli yolla gönderin. Yazmadan önce karşılaştırın, yedek tutun, bir gönderimin tamamını geri alın, klasörleri eşitleyin ve bir grubun bir makinesine sürümü diğerlerine dağıttırın.',
    download: 'Windows için indir',
    other_platforms: 'macOS ve Linux',
    checksums: 'Özetler',
    features: 'Neler yapar',
    screenshots: 'Ekran görüntüleri',
    docs: 'Belgeler',
    faq: 'Sorular ve yanıtlar',
    contents: 'İçindekiler',
    version: `Son sürüm ${pkg.version}`,
    items: [
      ['Birçok makineye gönder', 'Dosya ya da klasörleri, makineleri ya da grupları seçin, her birinde neyin değişeceğine bakın, gönderin. Her makinenin kökü altındaki göreli yol aynı kalır.'],
      ['Önce incele', 'Her gönderim önce hedeflerle karşılaştırılır: yeni, değişen, hedefte daha yeni, fazla. Siz demeden hiçbir şey yazılmaz.'],
      ['Geri al', 'Gönderimin değiştirdiği ve sildiği dosyaların yedeği hedefte kalır; Geçmiş sayfası bir gönderimin tamamını tek tıkla geri alır.'],
      ['Git ile', 'Seçili commit’lerin dosyalarını ya da yerel değişiklikleri, silinenlerle birlikte gönderin.'],
      ['Senkron ve otomasyon', 'Çakışma çözücülü iki yönlü, ayna ya da güncelleme senkronu; değişeni gönderen izlemeler; zamanlamalar.'],
      ['Röle ve paket', 'Grubun bir makinesi sürümü grubun kendi ağından dağıtır, kapalı makineler için kuyrukta tutar. Ya da sürümü tek (istenirse şifreli) bir paket olarak diskle götürün.'],
    ],
  },
};

const SHOTS = ['overview', 'send', 'compare', 'targets', 'sync', 'history'];

function page(lang) {
  const T = TEXT[lang];
  const depth = lang === 'en' ? 0 : 1;
  const up = '../'.repeat(depth);
  const { html, toc } = readmeHtml(path.join(root, lang === 'en' ? 'README.md' : 'README.tr.md'), depth);
  const topics = FAQ_TOPICS.map((tp) => ({ tp, items: FAQ.filter((f) => f.topic === tp.id) })).filter((g) => g.items.length);
  const faqHtml = topics
    .map(
      ({ tp, items }) => `<h3>${esc(tp[lang])}</h3>
${items.map((f) => `<details id="faq-${esc(f.id)}"><summary>${esc(f.q[lang])}</summary><div>${new Marked().parse(f.a[lang])}</div></details>`).join('\n')}`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="${T.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(T.title)}</title>
<meta name="description" content="${esc(T.tagline)}">
<link rel="icon" href="${up}icon.png">
<link rel="alternate" hreflang="${lang === 'en' ? 'tr' : 'en'}" href="${T.other.href}">
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <a class="brand" href="./"><img src="${up}icon.png" alt="" width="28" height="28"><span>SamSync</span></a>
  <nav aria-label="${esc(T.contents)}">
    <a href="#features">${esc(T.features)}</a><a href="#screenshots">${esc(T.screenshots)}</a><a href="#docs">${esc(T.docs)}</a><a href="#faq">${esc(T.faq)}</a>
    <a href="${T.other.href}" lang="${lang === 'en' ? 'tr' : 'en'}">${esc(T.other.label)}</a>
    <a href="${REPO}">GitHub</a>
  </nav>
</header>
<main>
<section class="hero">
  <h1>${esc(T.headline)}</h1>
  <p class="lead">${esc(T.tagline)}</p>
  <p class="cta">
    <a class="btn primary" href="${REPO}/releases/latest">${esc(T.download)}</a>
    <a class="btn" href="${REPO}/releases/latest">${esc(T.other_platforms)}</a>
    <a class="btn ghost" href="${REPO}/releases/latest/download/SHA256SUMS.txt">${esc(T.checksums)}</a>
  </p>
  <p class="muted">${esc(T.version)} · Windows · macOS · Linux · winget install SametKurumahmut.SamSync</p>
  <img class="hero-shot" src="${up}screenshots/${lang}-overview.png" alt="SamSync">
</section>
<section id="features"><h2>${esc(T.features)}</h2>
<div class="grid">${T.items.map(([h, p]) => `<div class="card"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join('')}</div>
</section>
<section id="screenshots"><h2>${esc(T.screenshots)}</h2>
<div class="shots">${SHOTS.map((s) => `<a href="${up}screenshots/${lang}-${s}.png"><img src="${up}screenshots/${lang}-${s}.png" alt="${esc(s)}" loading="lazy"></a>`).join('')}</div>
</section>
<section id="docs" class="docs"><h2>${esc(T.docs)}</h2>
<nav class="toc" aria-label="${esc(T.contents)}"><b>${esc(T.contents)}</b>${toc.map((x) => `<a href="#${x.id}">${esc(x.text)}</a>`).join('')}</nav>
<article>${html}</article>
</section>
<section id="faq" class="faq"><h2>${esc(T.faq)}</h2>
${faqHtml}
</section>
</main>
<footer><p>© ${new Date().getFullYear()} ${esc(pkg.author)} · <a href="${REPO}">${esc(REPO.replace('https://', ''))}</a></p></footer>
</body>
</html>
`;
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#141821;--muted:#566070;--border:#e1e5eb;--accent:#2f7cf6;--code:#eef1f5;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0c0e13;--card:#141821;--text:#e7eaf0;--muted:#a0a9b8;--border:#252b36;--accent:#4b8ff8;--code:#1a1f29;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 'Segoe UI Variable','Segoe UI',system-ui,-apple-system,sans-serif}
a{color:var(--accent)}
.top{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:20px;padding:12px max(16px,calc((100vw - 1100px)/2));background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--border)}
.brand{display:flex;align-items:center;gap:8px;font-weight:700;color:var(--text);text-decoration:none}
.top nav{display:flex;flex-wrap:wrap;gap:14px;margin-left:auto;font-size:14px}
.top nav a{color:var(--muted);text-decoration:none}.top nav a:hover{color:var(--text)}
main{max-width:1100px;margin:0 auto;padding:0 16px}
section{padding:48px 0 8px}
h1{font-size:clamp(28px,5vw,44px);line-height:1.15;margin:0 0 12px;letter-spacing:-.5px}
h2{font-size:26px;margin:0 0 18px}
.lead{font-size:18px;color:var(--muted);max-width:760px}
.muted{color:var(--muted);font-size:14px}
.cta{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 8px}
.btn{display:inline-flex;align-items:center;height:40px;padding:0 16px;border-radius:10px;border:1px solid var(--border);background:var(--card);color:var(--text);text-decoration:none;font-weight:600}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.ghost{background:transparent}
.hero-shot{display:block;width:100%;margin-top:26px;border-radius:14px;border:1px solid var(--border);box-shadow:0 20px 60px rgb(0 0 0 / 18%)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px}
.card h3{margin:0 0 6px;font-size:17px}.card p{margin:0;color:var(--muted);font-size:15px}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.shots img{width:100%;border-radius:10px;border:1px solid var(--border);display:block}
.docs{display:grid;grid-template-columns:220px minmax(0,1fr);gap:28px}
.docs>h2{grid-column:1/-1}
.toc{position:sticky;top:70px;align-self:start;display:flex;flex-direction:column;gap:6px;font-size:14px}
.toc a{color:var(--muted);text-decoration:none}.toc a:hover{color:var(--text)}
article{min-width:0}
article img{max-width:100%;border-radius:8px;border:1px solid var(--border)}
article table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}
article th,article td{border:1px solid var(--border);padding:6px 10px;text-align:left;vertical-align:top}
article code{background:var(--code);padding:1px 5px;border-radius:5px;font-size:.92em}
article pre{background:var(--code);padding:12px 14px;border-radius:10px;overflow:auto}
article pre code{background:none;padding:0}
.anchor{opacity:0;margin-left:-1em;padding-right:.25em;text-decoration:none}
h2:hover .anchor,h3:hover .anchor{opacity:.5}
.faq details{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin:8px 0}
.faq summary{cursor:pointer;font-weight:600}
.faq details div{color:var(--muted)}
footer{max-width:1100px;margin:40px auto 0;padding:20px 16px 40px;color:var(--muted);font-size:14px;border-top:1px solid var(--border)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:800px){.docs{grid-template-columns:1fr}.toc{position:static}.top nav{display:none}}
`;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'tr'), { recursive: true });
fs.mkdirSync(path.join(out, 'screenshots'), { recursive: true });
fs.copyFileSync(path.join(root, 'resources', 'icon.png'), path.join(out, 'icon.png'));
const shotsDir = path.join(repoRoot, 'docs', 'screenshots');
for (const f of fs.readdirSync(shotsDir)) fs.copyFileSync(path.join(shotsDir, f), path.join(out, 'screenshots', f));
fs.writeFileSync(path.join(out, 'index.html'), page('en'));
fs.writeFileSync(path.join(out, 'tr', 'index.html'), page('tr'));
// GitHub Pages: no Jekyll processing of the files
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`site → ${out} (${FAQ.length} questions, ${fs.readdirSync(shotsDir).length} screenshots)`);
