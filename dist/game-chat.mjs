import {profilePhotoURL} from './profile-photo.mjs';
import {icon} from "./icons.mjs";
import {readChat, sendChat} from "./multiplayer.mjs";
import {parseRollCommand, executeRoll, formatRollMessage, parseRollMessage, visibleMessageText} from "./chat-commands.mjs";

const timeFormat = new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"});

export function createGameChat(id, sender) {
  const panel = document.createElement("aside");
  panel.className = "game-chat";
  panel.setAttribute("aria-label","Party chat");
  panel.innerHTML = `
    <header class="chat-header">
      <h2>Chat &amp; activity</h2>
      <button id="game-chat-toggle" class="game-button chat-toggle" type="button" aria-controls="game-chat-content">
        ${icon("chat",16)}<span></span><small class="chat-unread" hidden></small>
      </button>
    </header>
    <div id="game-chat-content" class="chat-content" hidden>
      <label class="chat-activity-control"><input type="checkbox" class="chat-activity-toggle" checked> Show combat &amp; roll activity</label>
      <div class="chat-history" role="log" aria-label="Chat messages" tabindex="0">
        <p class="chat-empty">No messages yet.</p>
      </div>
      <form class="chat-form" autocomplete="off">
        <p class="chat-author"></p>
        <div class="chat-compose">
          <textarea id="game-chat-message" rows="2" maxlength="500" aria-label="Message" placeholder="Message the party (/roll d20)"></textarea>
          <button class="game-button chat-send" type="submit" disabled>Send</button>
        </div>
        <p class="chat-status" role="status"></p>
      </form>
    </div>`;
  const toggle = panel.querySelector(".chat-toggle");
  const label = toggle.querySelector("span");
  const badge = toggle.querySelector(".chat-unread");
  const title = panel.querySelector("h2");
  const content = panel.querySelector(".chat-content");
  const history = panel.querySelector(".chat-history");
  const empty = history.querySelector(".chat-empty");
  const form = panel.querySelector("form");
  const author = form.querySelector(".chat-author");
  const body = form.querySelector("textarea");
  const send = form.querySelector(".chat-send");
  const status = form.querySelector(".chat-status");
  const isLocal = id === "local";
  let localSeq = 0;
  const playedRolls = new Set();
  const seenKey = "wayfarer-chat-seen:" + id;
  let seen = 0;
  let open = false;
  let stopped = false;
  let reading = false;
  let submitting = false;
  let timer;
  let cursor;
  let draft;
  let slot;
  let scrollTop = 0;
  let following = true;

  const chatMessages=new Map(),activityMessages=new Map(),eventTimes=new Map();
  let includeActivity=Boolean(panel.querySelector('.chat-activity-toggle')?.checked),activitySource,lastActivity=0,timelineSignature='';
  const activityObserver=new MutationObserver(syncActivity);

  function syncActivity(){
    for(const line of activitySource?.querySelectorAll('[data-event]')??[]){
      const sequence=Number(line.dataset.event);if(!Number.isFinite(sequence))continue;
      const heading=line.querySelector('strong')?.textContent??'',detail=line.querySelector('span')?.textContent??'';
      activityMessages.set(sequence,{key:'activity:'+sequence,sequence,system:true,author:'Activity',body:[heading,detail].filter(Boolean).join('\n'),time:eventTimes.get(sequence)??0});
    }
    while(activityMessages.size>160)activityMessages.delete(activityMessages.keys().next().value);
    renderTimeline();
  }

  function renderTimeline(){
    const rows=[...chatMessages.values(),...(includeActivity?activityMessages.values():[])].sort((a,b)=>a.time-b.time||Number(a.system)-Number(b.system)||a.sequence-b.sequence);
    const signature=JSON.stringify([includeActivity,rows.map(r=>[r.key,r.body,r.time])]);if(signature===timelineSignature)return;
    rememberScroll();const anchor=[...history.children].find(e=>e.dataset.row&&e.getBoundingClientRect().bottom>history.getBoundingClientRect().top),anchorKey=anchor?.dataset.row,offset=anchor?anchor.getBoundingClientRect().top-history.getBoundingClientRect().top:0;
    timelineSignature=signature;const nodes=new Map([...history.children].map(e=>[e.dataset.row,e]));
    for(const row of rows){
      let item=nodes.get(row.key);if(!item){item=document.createElement('div');item.dataset.row=row.key;item.className='chat-line'+(row.system?' chat-system':'');if(row.system)item.dataset.activity=String(row.sequence);else item.dataset.message=String(row.sequence);const info=document.createElement('div'),speaker=document.createElement('strong'),time=document.createElement('time'),text=document.createElement('p');info.append(speaker,time);item.append(info,text);}
      const speaker=item.querySelector('strong');
      speaker.textContent=row.author;
      const photo=profilePhotoURL(row.profileId,row.photo);
      if(photo){
        const avatar=document.createElement('img');
        avatar.className='chat-profile-avatar';avatar.src=photo;avatar.alt='';avatar.loading='lazy';
        speaker.prepend(avatar);
      }
      const time=item.querySelector('time');time.hidden=!row.time;if(row.time){time.dateTime=new Date(row.time).toISOString();time.textContent=timeFormat.format(row.time);}
      const visText=visibleMessageText(row.body);item.querySelector('p').textContent=visText;
      item.classList.toggle('chat-roll',visText.startsWith('🎲'));
      history.append(item);nodes.delete(row.key);
    }
    for(const node of nodes.values())node.remove();
    if(!rows.length){empty.textContent=includeActivity?'No messages or activity yet.':'No messages yet.';history.append(empty);}
    if(open&&following)history.scrollTop=history.scrollHeight;
    else if(open&&anchorKey){const retained=[...history.children].find(e=>e.dataset.row===anchorKey);if(retained)history.scrollTop+=retained.getBoundingClientRect().top-history.getBoundingClientRect().top-offset;else history.scrollTop=scrollTop;}
    rememberScroll();if(open)markSeen();updateBadge();
  }

  try {seen = Number(sessionStorage.getItem(seenKey)) || 0;} catch {}

  function markSeen() {
    seen = Math.max(seen,cursor ?? 0);
    try {sessionStorage.setItem(seenKey,String(seen));} catch {}
  }

  function rememberScroll() {
    if (!open || !history.isConnected) return;
    scrollTop = history.scrollTop;
    following = history.scrollHeight - scrollTop - history.clientHeight < 24;
  }

  function updateBadge() {
    const unread = open ? 0 : Array.from(history.querySelectorAll("[data-message]"))
      .filter((entry) => Number(entry.dataset.message) > seen).length;
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    toggle.setAttribute("aria-label",open ? "Minimize chat" : unread ? `Chat, ${unread} unread` : "Chat");
  }

  function setOpen(next) {
    open = next;
    slot?.classList.toggle("chat-open",open);
    toggle.setAttribute("aria-expanded",String(open));
    label.textContent = open ? "Minimize" : "Chat";
    title.hidden = !open;
    content.hidden = !open;
    if (open) {
      history.scrollTop = history.scrollHeight;
      rememberScroll();
      markSeen();
    }
    updateBadge();
    document.dispatchEvent(new CustomEvent('wayfarer:chat-visibility',{detail:open}));
  }

  function appendMessages(messages) {
    if(!messages.length)return;
    for(const message of messages){
      chatMessages.set(message.id,{...message,key:'chat:'+message.id,sequence:message.id,system:false});
      if (message.body && !playedRolls.has(message.id)) {
        playedRolls.add(message.id);
        const parsed = parseRollMessage(message.body);
        if (parsed && (!message.time || Date.now() - message.time < 15000)) {
          document.dispatchEvent(new CustomEvent('wayfarer:chat-roll', { detail: {
            name: parsed.name || message.author,
            action: parsed.action,
            kind: "chat-roll",
            side: "party",
            rolls: parsed.rolls
          }}));
        }
      }
    }
    while(chatMessages.size>200)chatMessages.delete(chatMessages.keys().next().value);
    renderTimeline();
  }

  async function refresh() {
    if (isLocal || stopped || reading) return;
    clearTimeout(timer);
    reading = true;
    try {
      const response = await readChat(id,cursor);
      if (stopped || !response) return;
      const messages = response.messages;
      cursor = messages.at(-1)?.id ?? cursor ?? 0;
      empty.textContent = "No messages yet.";
      appendMessages(messages);
    } catch {
      if (!stopped && cursor == null) empty.textContent = "Connecting to chat…";
    } finally {
      reading = false;
      if (!stopped) timer = setTimeout(refresh,document.hidden ? 10000 : 2200);
    }
  }

  function updateSend() {
    send.disabled = submitting || !body.value.trim();
  }

  panel.querySelector('.chat-activity-toggle').addEventListener('change',event=>document.dispatchEvent(new CustomEvent('wayfarer:activity-placement',{detail:event.target.checked?'chat':'hidden'})));
  toggle.addEventListener("click",() => setOpen(!open));
  history.addEventListener("scroll",rememberScroll);
  body.addEventListener("input",updateSend);
  body.addEventListener("keydown",(event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!send.disabled) form.requestSubmit();
    }
  });
  form.addEventListener("submit",async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = body.value.trim();
    if (!text || submitting) return;

    if (text.startsWith("/")) {
      if (/^\/clear\b/i.test(text)) {
        chatMessages.clear();
        body.value = "";
        renderTimeline();
        updateSend();
        return;
      }
      if (/^\/help\b/i.test(text)) {
        const helpId = --localSeq;
        chatMessages.set(helpId, {
          key: "chat:" + helpId,
          id: helpId,
          sequence: helpId,
          system: true,
          author: "Chat Guide",
          body: "Roll commands:\n• /roll d20 + 3d6 + d7\n• /roll 2d20\n• /roll d20a (advantage)\n• /roll d20d (disadvantage)\n• /roll d20a + 5 Athletics\n• /roll 4d6kh3 (keep highest 3)\n• /clear (clear messages)",
          time: Date.now()
        });
        body.value = "";
        renderTimeline();
        updateSend();
        return;
      }
      const parsed = parseRollCommand(text);
      if (parsed) {
        if (parsed.error) {
          status.textContent = parsed.error;
          return;
        }
        let rollResult;
        try {
          rollResult = executeRoll(parsed, { name: sender });
        } catch (err) {
          status.textContent = err.message;
          return;
        }
        status.textContent = "";
        document.dispatchEvent(new CustomEvent('wayfarer:chat-roll', { detail: rollResult.event }));
        const formatted = formatRollMessage(rollResult);
        body.value = "";
        updateSend();

        if (isLocal) {
          const localId = ++localSeq;
          playedRolls.add(localId);
          appendMessages([{ id: localId, author: sender, body: formatted, time: Date.now() }]);
          return;
        }

        submitting = true;
        try {
          const draftMsg = { messageId: crypto.randomUUID(), sender, body: formatted };
          await sendChat(id, draftMsg);
          refresh();
        } catch {
          status.textContent = "Roll could not be sent to party. Try again.";
        } finally {
          submitting = false;
          updateSend();
        }
        return;
      }
    }

    if (isLocal) {
      const localId = ++localSeq;
      appendMessages([{ id: localId, author: sender, body: text, time: Date.now() }]);
      body.value = "";
      updateSend();
      return;
    }

    if (draft?.body !== text) draft = {messageId:crypto.randomUUID(),sender,body:text};
    submitting = true;
    updateSend();
    status.textContent = "";
    try {
      await sendChat(id,draft);
      if (stopped) return;
      if (body.value.trim() === text) body.value = "";
      draft = null;
      refresh();
    } catch {
      status.textContent = "Message could not be sent. Try again.";
    } finally {
      submitting = false;
      updateSend();
    }
  });

  setOpen(false);
  refresh();

  return {
    mount(container, name) {
      slot = container;
      slot.append(panel);
      slot.classList.toggle("chat-open",open);
      author.textContent = "Sending as " + name;
      sender = name;
      if (open) history.scrollTop = following ? history.scrollHeight : scrollTop;
    },
    get isOpen(){return open;},
    toggle:()=>setOpen(!open),
    show:()=>setOpen(true),
    setActivity(enabled,source,events=[]){
      includeActivity=enabled;
      panel.querySelector('.chat-activity-toggle').checked=enabled;
      const latest=events.at(-1)?.id??0;if(latest<lastActivity){activityMessages.clear();eventTimes.clear();}lastActivity=latest;
      for(const event of events)if(Number.isFinite(event.time)&&event.time>0)eventTimes.set(event.id,event.time);
      for(const key of eventTimes.keys())if(key<latest-160)eventTimes.delete(key);
      if(activitySource!==source){activityObserver.disconnect();activitySource=source;if(source)activityObserver.observe(source,{childList:true,subtree:true,characterData:true});}
      slot?.classList.toggle('chat-with-activity',enabled);
      syncActivity();
    },
    rememberScroll,
    refresh,
    destroy() {
      stopped = true;
      activityObserver.disconnect();
      clearTimeout(timer);
      panel.remove();
    },
  };
}
