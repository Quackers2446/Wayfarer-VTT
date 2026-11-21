import {icon} from "./icons.mjs";
import {readChat, sendChat} from "./multiplayer.mjs";

const timeFormat = new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"});
const aliasKey = "wayfarer-chat-name-v1";

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
      <div class="chat-history" role="log" aria-label="Chat messages" tabindex="0">
        <p class="chat-empty">No messages yet.</p>
      </div>
      <form class="chat-form" autocomplete="off">
        <label class="chat-name">Name <input id="game-chat-name" type="text" maxlength="40"></label>
        <p class="chat-author" hidden></p>
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
  const name = form.querySelector("input");
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

  name.placeholder = "Guest " + sender.slice(0,4).toUpperCase();
  try {
    name.value = localStorage.getItem(aliasKey) ?? "";
    seen = Number(sessionStorage.getItem(seenKey)) || 0;
  } catch {}

  function markSeen() {
    seen = Math.max(seen,cursor ?? 0);
    try {sessionStorage.setItem(seenKey,String(seen));} catch {}
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
      markSeen();
    }
    updateBadge();
  }

  function appendMessages(messages) {
    if (!messages.length) return;
    const atBottom = history.scrollHeight - history.scrollTop - history.clientHeight < 24;
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
    if (open && atBottom) history.scrollTop = history.scrollHeight;
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

  toggle.addEventListener("click",() => setOpen(!open));
  name.addEventListener("input",() => {
    try {localStorage.setItem(aliasKey,name.value);} catch {}
  });
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
    const alias = name.value.trim();
    if (draft?.body !== text || draft.alias !== alias) draft = {messageId:crypto.randomUUID(),sender,alias,body:text};
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
    mount(container, character) {
      const scroll = history.scrollTop;
      slot = container;
      slot.append(panel);
      slot.classList.toggle("chat-open",open);
      name.parentElement.hidden = Boolean(character);
      author.hidden = !character;
      author.textContent = character ? "Sending as " + character.name : "";
      if (open) history.scrollTop = scroll;
    },
    refresh,
    destroy() {
      stopped = true;
      clearTimeout(timer);
      panel.remove();
    },
  };
}
