// Shared, local-data suggestions. Providers supply only choices valid in the current view.
export const searchKey=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’‘']/g,'').replace(/[^a-z0-9]+/g,' ').trim();
export function rankSuggestions(options,query,limit=8){
 const q=searchKey(query),words=q.split(' ').filter(Boolean);
 return options.map((option,index)=>{const label=searchKey(option.label??option.value),all=searchKey([label,option.search,option.detail].filter(Boolean).join(' '));return {option,index,score:!q?4:label===q?0:label.startsWith(q)?1:words.every(word=>label.split(' ').some(part=>part.startsWith(word)))?2:words.every(word=>all.includes(word))?3:99};})
 .filter(item=>item.score<99).sort((a,b)=>a.score-b.score||a.index-b.index).slice(0,limit).map(item=>item.option);
}
const providers=[],bound=new WeakMap();let current,serial=0,timer,installed=false;
export function registerSuggestions(selector,options){providers.push({selector,...options});install();}
export function attachSuggestions(input,options){if(input)bound.set(input,options);install();}
function config(input){return bound.get(input)??providers.find(provider=>input.matches?.(provider.selector));}
function close(){serial++;clearTimeout(timer);timer=null;if(!current)return;current.input.setAttribute('aria-expanded','false');current.input.removeAttribute('aria-activedescendant');current.input.removeAttribute('aria-controls');current.menu.remove();current=null;}
function place(){if(!current)return;const {input,menu}=current;if(!input.isConnected||!menu.isConnected||input.closest('dialog')&&!input.closest('dialog').open){close();return;}const r=input.getBoundingClientRect(),height=Math.min(320,menu.scrollHeight),below=innerHeight-r.bottom-8,above=r.top-8,up=below<Math.min(height,180)&&above>below;Object.assign(menu.style,{left:Math.max(8,Math.min(r.left,innerWidth-Math.min(Math.max(r.width,260),innerWidth-16)-8))+'px',width:Math.min(Math.max(r.width,260),innerWidth-16)+'px',top:(up?Math.max(8,r.top-Math.min(height,above)-5):r.bottom+5)+'px',maxHeight:Math.max(60,Math.min(320,up?above-5:below-5))+'px'});}
function mark(index){if(!current)return;current.active=index;for(const [i,row]of [...current.menu.querySelectorAll('[role=option]')].entries()){row.setAttribute('aria-selected',String(i===index));if(i===index){current.input.setAttribute('aria-activedescendant',row.id);row.scrollIntoView({block:'nearest'});}}}
function select(index){if(!current)return;const {input,items,settings}=current,item=items[index];if(!item)return;close();input.value=item.value??item.label;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));settings.select?.(item,input);close();if(input.isConnected)input.focus({preventScroll:true});}
async function show(input){
 const settings=config(input);if(!settings)return;close();const request=++serial,query=input.value;
 input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');input.setAttribute('autocomplete','off');
 let options;try{options=await settings.options(input);}catch{options=[];}
 if(request!==serial||document.activeElement!==input||!input.isConnected)return;
 const items=rankSuggestions(options,query),menu=document.createElement('div'),id='wayfarer-suggestions-'+request;menu.id=id;menu.className='search-suggestions';menu.setAttribute('role','listbox');menu.setAttribute('aria-label','Search suggestions');menu.setAttribute('popover','manual');
 if(!items.length){const empty=document.createElement('p');empty.className='search-suggestions-empty';empty.textContent=query.trim()?'No matching suggestions. You can keep typing.':'Type to find a match.';empty.setAttribute('role','status');menu.append(empty);}
 for(const [index,item]of items.entries()){const row=document.createElement('div');row.id=id+'-'+index;row.setAttribute('role','option');row.setAttribute('aria-selected','false');const label=document.createElement('strong');label.textContent=item.label??item.value;row.append(label);if(item.detail){const detail=document.createElement('small');detail.textContent=item.detail;row.append(detail);}row.addEventListener('pointerdown',event=>event.preventDefault());row.addEventListener('click',()=>select(index));menu.append(row);}
 (input.closest('dialog[open]')??document.body).append(menu);current={input,menu,items,settings,active:-1};input.setAttribute('aria-controls',id);input.setAttribute('aria-expanded','true');if(menu.showPopover)menu.showPopover();place();
}
function install(){if(installed||typeof document==='undefined')return;installed=true;
 document.addEventListener('focusin',event=>{if(config(event.target)){if(!event.target.value.trim())void show(event.target);}else if(!current?.menu.contains(event.target))close();});
 document.addEventListener('input',event=>{if(!config(event.target))return;close();const input=event.target;timer=setTimeout(()=>{timer=null;void show(input);},70);});
 document.addEventListener('keydown',event=>{if(!config(event.target))return;if(event.key==='Escape'&&(current||timer)){event.preventDefault();event.stopImmediatePropagation();close();return;}if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();if(!current){void show(event.target).then(()=>{if(current?.input===event.target&&current.items.length)mark(event.key==='ArrowDown'?0:current.items.length-1);});return;}if(current.items.length)mark(current.active<0?(event.key==='ArrowDown'?0:current.items.length-1):(current.active+(event.key==='ArrowDown'?1:-1)+current.items.length)%current.items.length);return;}if(event.key==='Enter'&&current?.active>=0){event.preventDefault();event.stopImmediatePropagation();select(current.active);}if(event.key==='Tab')close();},true);
 document.addEventListener('pointerdown',event=>{if(config(event.target)){void show(event.target);return;}if(current&&event.target!==current.input&&!current.menu.contains(event.target))close();},true);
 document.addEventListener('focusout',event=>{if(current?.input===event.target)setTimeout(()=>{if(current&&document.activeElement!==current.input)close();},0);});
 document.addEventListener('close',event=>{if(current?.input.closest('dialog')===event.target)close();},true);window.addEventListener('hashchange',close);window.addEventListener('resize',place);document.addEventListener('scroll',place,true);
}
