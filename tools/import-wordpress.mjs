import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import TurndownService from 'turndown';
import { parseHTML } from 'linkedom';
import { autop } from '@wordpress/autop';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dump = process.argv[2];
if (!dump) throw new Error('Usage: npm run import:wordpress -- /private/path/backup.sql.gz');
const extracted = spawnSync('python3', [path.join(root, 'tools/extract_wordpress.py'), path.resolve(dump)], {encoding:'utf8', maxBuffer:70*1024*1024});
if (extracted.status !== 0) throw new Error(extracted.stderr || 'Offline SQL extraction failed');
const data = JSON.parse(extracted.stdout);
const postIDs = new Set(data.posts.map(p => p.id));
const recoveryPath=path.join(root,'data/image-map.json');
const recovery=fs.existsSync(recoveryPath)?JSON.parse(fs.readFileSync(recoveryPath,'utf8')):[];
const imageMap=new Map(recovery.filter(a=>a.local_url).map(a=>[a.original_url,a.local_url]));
const dest = path.join(root,'source/_posts');
fs.mkdirSync(dest,{recursive:true});
const oldManifestPath = path.join(root,'migration/import-report.json');
const old = fs.existsSync(oldManifestPath) ? JSON.parse(fs.readFileSync(oldManifestPath,'utf8')) : null;
if (old) {
  for (const filename of old.generated_files ?? []) {
    if (path.basename(filename) !== filename) throw new Error('Unsafe existing import manifest');
    const target=path.join(dest,filename); if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}
const td = new TurndownService({headingStyle:'atx',bulletListMarker:'-',codeBlockStyle:'fenced',emDelimiter:'*'});
const escapeText=td.escape.bind(td);
td.escape=text=>{
  const urls=[];
  const protectedText=text.replace(/https?:\/\/[A-Za-z0-9._~:/?#@!$&'=%+-]+/g,url=>{urls.push(url);return `WPURLTOKEN${urls.length-1}END`;});
  return escapeText(protectedText).replace(/~/g,'\\~').replace(/WPURLTOKEN(\d+)END/g,(_,i)=>urls[Number(i)]);
};
// Raw inline HTML avoids ambiguous Markdown next to CJK text and quoted link titles.
td.addRule('inlineFormatting',{filter:['strong','b','em','i','del','s','strike'],replacement:(_,node)=>node.outerHTML});
td.addRule('titledLink',{filter:node=>node.nodeName==='A'&&!!node.getAttribute('title'),replacement:(_,node)=>node.outerHTML});
// Preserve WordPress layout tables/figures and retired embeds verbatim; no lossy table conversion.
td.keep(['table','figure','figcaption','embed','object','iframe','video','audio','sup','sub','abbr']);
td.addRule('wordpressMore',{filter:node=>node.nodeName==='WP-MORE',replacement:()=> '\n\n<!-- more -->\n\n'});
const assets = new Map(); const unresolved = []; const retiredEmbeds=[]; const generated=[];
const localOrigins = new Set([new URL(data.site.home).hostname,new URL(data.site.siteurl).hostname]);
function recordAsset(url,p,kind) {
  let parsed;try {parsed=new URL(url,data.site.siteurl+'/');} catch{return;}
  if (!['http:','https:'].includes(parsed.protocol)) return;
  const key=parsed.href;
  if (!assets.has(key)) assets.set(key,{original_url:key,local_site:localOrigins.has(parsed.hostname),posts:[],kinds:[]});
  const a=assets.get(key);if(!a.posts.includes(p.id))a.posts.push(p.id);if(!a.kinds.includes(kind))a.kinds.push(kind);
}
function localImage(value) {
  if(!value || value.startsWith('data:'))return value;
  try {const absolute=new URL(value,data.site.siteurl+'/').href;return imageMap.get(absolute)||absolute;}catch{return value;}
}
function rewriteLink(value,p) {
  if (!value || value.startsWith('#')) return value;
  let u;try {u=new URL(value,data.site.siteurl+'/');}catch{return value;}
  if (!localOrigins.has(u.hostname)) return value;
  const queryID=u.searchParams.get('p');
  const match=u.pathname.match(/^\/archives\/(\d+)\.html\/?$/);
  const id=queryID?Number(queryID):match?Number(match[1]):null;
  if (id) {
    if(!postIDs.has(id))unresolved.push({post_id:p.id,target_post_id:id,original_url:u.href});
    return `/archives/${id}.html${u.hash}`;
  }
  return u.pathname+u.search+u.hash;
}
for(const p of data.posts) {
  let html=autop(p.html).replace(/<!--\s*more(?:.*?)?-->/gi,'<wp-more></wp-more>');
  const {document}=parseHTML(`<html><body>${html}</body></html>`);
  for (const node of document.querySelectorAll('img')) {
    for(const attribute of ['src','data-src','data-original','data-lazy-src']) {
      const v=node.getAttribute(attribute);if(v)recordAsset(v,p,attribute);
    }
    for(const attribute of ['srcset','data-srcset']) {
      const v=node.getAttribute(attribute);if(v)for(const candidate of v.split(','))recordAsset(candidate.trim().split(/\s+/)[0],p,attribute);
    }
    if(!node.getAttribute('src') && node.getAttribute('data-src'))node.setAttribute('src',node.getAttribute('data-src'));
    for(const attribute of ['src','data-src','data-original','data-lazy-src']){
      const v=node.getAttribute(attribute);if(v)node.setAttribute(attribute,localImage(v));
    }
    for(const attribute of ['srcset','data-srcset']){
      const v=node.getAttribute(attribute);if(v)node.setAttribute(attribute,v.split(',').map(candidate=>{
        const [url,...descriptor]=candidate.trim().split(/\s+/);return [localImage(url),...descriptor].join(' ');
      }).join(', '));
    }
  }
  for(const node of document.querySelectorAll('a[href]')) {
    const url=node.getAttribute('href');
    if(/\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?)(?:[?#]|$)/i.test(url))recordAsset(url,p,'linked-image');
    node.setAttribute('href',/\.(?:png|jpe?g|gif|webp|svg|bmp|tiff?)(?:[?#]|$)/i.test(url)?localImage(url):(imageMap.get(new URL(url,data.site.siteurl+'/').href)||rewriteLink(url,p)));
  }
  for(const node of document.querySelectorAll('[style]')) {
    let style=node.getAttribute('style');
    for(const m of style.matchAll(/url\(['"]?([^'"\)]+)['"]?\)/g)){recordAsset(m[1],p,'css-url');style=style.replace(m[1],localImage(m[1]));}
    node.setAttribute('style',style);
  }
  for(const node of document.querySelectorAll('embed,object'))retiredEmbeds.push({post_id:p.id,tag:node.localName,type:node.getAttribute('type'),resource:node.getAttribute('src')||node.getAttribute('data')});
  const markdown=td.turndown(document.body.innerHTML).trim();
  const slug=p.title.normalize('NFC').replace(/[\x00-\x1f/\\:*?"<>|]/g,'-').slice(0,75).trim()||'post';
  const filename=`${p.id}-${slug}.md`;
  const target=path.join(dest,filename);
  if(fs.existsSync(target))throw new Error(`Refusing to overwrite unmanaged post ${filename}`);
  const quote=v=>JSON.stringify(v);
  const front=[`title: ${quote(p.title)}`,`date: ${quote(p.date)}`,`updated: ${quote(p.updated)}`,`permalink: archives/${p.id}.html`,`wp_id: ${p.id}`,`wp_slug: ${quote(p.slug)}`,`categories: ${quote(p.categories)}`,`tags: ${quote(p.tags)}`,`comments: false`];
  fs.writeFileSync(target,`---\n${front.join('\n')}\n---\n\n${markdown}\n`);
  generated.push(filename);
}
fs.mkdirSync(path.join(root,'migration'),{recursive:true});
const report={published_posts:data.posts.length,excluded_nonpublic_posts:data.excluded_nonpublic_posts,comments_imported:0,source_backup_date:'2023-09-01',site:data.site,generated_files:generated,image_reference_count:assets.size,recovered_image_count:imageMap.size,unresolved_internal_post_links:unresolved,retired_embeds:retiredEmbeds,images_not_yet_recovered:imageMap.size<assets.size};
fs.writeFileSync(oldManifestPath,JSON.stringify(report,null,2)+'\n');
fs.writeFileSync(path.join(root,'migration/image-manifest.json'),JSON.stringify([...assets.values()],null,2)+'\n');
console.log(`Imported ${data.posts.length} published posts; excluded ${data.excluded_nonpublic_posts} nonpublic posts. Comments omitted.`);
console.log(`Unique image references: ${assets.size}; unresolved post links: ${unresolved.length}; legacy embeds: ${retiredEmbeds.length}.`);
