import {icon} from "./icons.mjs";
import {readChat, sendChat} from "./multiplayer.mjs";

const timeFormat = new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"});

export function createGameChat(id, sender) {
  const panel = document.createElement("aside");
  panel.className = "game-chat";
  panel.setAttribute("aria-label","Party chat");
  panel.innerHTML = `
    <header class="chat-header">
      <h2>Party chat</h2>
      <button id="game-chat-toggle" class="game-button chat-toggle" type="button" aria-controls="game-chat-content">
        ${icon("chat",16)}<span></span><small class="chat-unread" hidden></small>
      </button>
    </header>
    <div id="game-chat-content" class="chat-content" hidden>
      <label class="chat-activity-control"><input type="checkbox" class="chat-activity-toggle"> Include activity log</label>
      <div class="chat-activity-slot" hidden></div>
      <div class="chat-history" role="log" aria-label="Chat messages" tabindex="0">
        <p class="chat-empty">No messages yet.</p>
      </div>
      <form class="chat-form" autocomplete="off">
        <p class="chat-author"></p>
        <div class="chat-compose">
          <textarea id="game-chat-message" rows="2" maxlength="500" aria-label="Message" placeholder="Message the party"></textarea>
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
    if (!messages.length) return;
    rememberScroll();
    empty.remove();
    for (const message of messages) {
      const item = document.createElement("div");
      item.className = "chat-line";
      item.dataset.message = message.id;
      const info = document.createElement("div");
      const speaker = document.createElement("strong");
      const time = document.createElement("time");
      const text = document.createElement("p");
      speaker.textContent = message.author;
      time.dateTime = new Date(message.time).toISOString();
      time.textContent = timeFormat.format(message.time);
      text.textContent = message.body;
      info.append(speaker,time);
      item.append(info,text);
      history.append(item);
    }
    while (history.childElementCount > 200) history.firstElementChild.remove();
    if (open && following) history.scrollTop = history.scrollHeight;
    rememberScroll();
    if (open) markSeen();
    updateBadge();
  }

  async function refresh() {
    if (stopped || reading) return;
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
      if (open) history.scrollTop = following ? history.scrollHeight : scrollTop;
    },
    get isOpen(){return open;},
    toggle:()=>setOpen(!open),
    show:()=>setOpen(true),
    setActivity(enabled,log){
      enabled=enabled && log?.dataset.logMode!=='collapsed';
      panel.querySelector('.chat-activity-toggle').checked=enabled;
      const activity=panel.querySelector('.chat-activity-slot');activity.hidden=!enabled;
      if(enabled && log)activity.replaceChildren(log);else activity.replaceChildren();
      slot?.classList.toggle('chat-with-activity',enabled);
    },
    rememberScroll,
    refresh,
    destroy() {
      stopped = true;
      clearTimeout(timer);
      panel.remove();
    },
  };
}
