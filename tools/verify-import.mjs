import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseHTML} from 'linkedom';
import {autop} from '@wordpress/autop';
import Hexo from 'hexo';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.argv[2])throw new Error('Usage: node tools/verify-import.mjs /private/path/backup.sql.gz');
const extracted=spawnSync('python3',[path.join(root,'tools/extract_wordpress.py'),process.argv[2]],{encoding:'utf8',maxBuffer:70*1024*1024});
if(extracted.status!==0)throw new Error(extracted.stderr);
const data=JSON.parse(extracted.stdout);const failures=[];const check=(ok,msg)=>{if(!ok)failures.push(msg);};
const md=fs.readdirSync(path.join(root,'source/_posts')).filter(n=>n.endsWith('.md'));
check(md.length===data.posts.length,'Markdown post count differs from published SQL posts');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'migration/import-report.json')));
check(manifest.comments_imported===0,'Comments must remain excluded');
check(manifest.excluded_nonpublic_posts===data.excluded_nonpublic_posts,'Unexpected nonpublic exclusion count');
check(new Set(md.map(n=>n.match(/^(\d+)-/)?.[1])).size===data.posts.length,'Duplicate or non-ID filenames');
const hexo=new Hexo(root,{silent:true});await hexo.init();await hexo.load();
const posts=hexo.model('Post').find({}).toArray();
check(posts.length===data.posts.length,'Hexo loaded a different number of posts');
const byID=new Map(posts.map(p=>[Number(p.wp_id),p]));
const normalize=s=>s.replace(/\s|\u200b/g,'');
let textMatches=0;let tablePosts=0;let images=0;let localImages=0;
for(const original of data.posts){
  const p=byID.get(original.id);check(!!p,`Missing post ID ${original.id}`);if(!p)continue;
  check(p.title===original.title,`Title changed for ${original.id}`);
  check(p.path.replace(/^\//,'')===`archives/${original.id}.html`,`Permalink changed for ${original.id}: ${p.path}`);
  check(p.comments===false,`Comments enabled for ${original.id}`);
  const expectedCategories=new Set(original.categories.flat());
  const actualCategories=new Set(p.categories.toArray().map(c=>c.name));
  check([...expectedCategories].every(n=>actualCategories.has(n))&&expectedCategories.size===actualCategories.size,`Categories differ for ${original.id}`);
  const actualTags=new Set(p.tags.toArray().map(t=>t.name));
  check(original.tags.length===actualTags.size&&original.tags.every(n=>actualTags.has(n)),`Tags differ for ${original.id}`);
  const htmlFile=path.join(root,'public',p.path);check(fs.existsSync(htmlFile),`Missing HTML for ${original.id}`);if(!fs.existsSync(htmlFile))continue;
  const {document}=parseHTML(fs.readFileSync(htmlFile,'utf8'));const entry=document.querySelector('.article-entry');
  check(!!entry,`Missing article content ${original.id}`);if(!entry)continue;
  for(const extra of entry.querySelectorAll('.article-more-link'))extra.remove();
  const source=parseHTML(`<html><body>${autop(original.html)}</body></html>`).document;
  const before=normalize(source.body.textContent);const after=normalize(entry.textContent);
  if(before===after)textMatches++;else check(false,`Text mismatch ${original.id}: expected ${before.length} chars, rendered ${after.length}`);
  const beforeTables=source.querySelectorAll('table').length;const afterTables=entry.querySelectorAll('table').length;
  check(beforeTables===afterTables,`Table count differs ${original.id}`);if(beforeTables)tablePosts++;
  const expectedImages=source.querySelectorAll('img').length;const gotImages=entry.querySelectorAll('img').length;
  check(expectedImages===gotImages,`Image element count differs ${original.id}`);images+=gotImages;
  for(const img of entry.querySelectorAll('img[src]')){
    const src=img.getAttribute('src');if(src.startsWith('/images/')){localImages++;check(fs.existsSync(path.join(root,'public',decodeURIComponent(src))),`Broken generated local image ${src}`);}
  }
  for(const link of entry.querySelectorAll('a[href]')){
    const href=link.getAttribute('href');if(/^\/archives\/\d+\.html(?:#|$)/.test(href))check(fs.existsSync(path.join(root,'public',href.split('#')[0])),`Broken internal link ${href}`);
  }
}
// Parent relations matter: parallel categories must not become a fabricated chain.
const categories=hexo.model('Category').find({}).toArray();
for(const chains of data.posts.map(p=>p.categories))for(const chain of chains)for(let i=0;i<chain.length;i++){
  const category=categories.find(c=>c.name===chain[i]);const parent=category?.parent?categories.find(c=>String(c._id)===String(category.parent)):null;
  check((parent?.name||null)===(i?chain[i-1]:null),`Wrong category parent for ${chain[i]}`);
}
const report={posts:posts.length,text_content_exact_after_whitespace_normalization:textMatches,posts_with_preserved_html_tables:tablePosts,image_elements:images,local_image_elements:localImages,failures};
fs.writeFileSync(path.join(root,'migration/verification.json'),JSON.stringify(report,null,2)+'\n');
await hexo.exit();
console.log(JSON.stringify(report,null,2));
if(failures.length)process.exitCode=1;
