import test from "node:test";
import assert from "node:assert/strict";
import {drawTokenFrame, renderTokenToCanvas} from "../dist/token-maker.mjs";
import {characterPage} from "../dist/character-view.mjs";

test("drawTokenFrame supports all frame styles without errors", () => {
  const operations = [];
  const fakeCtx = {
    save() { operations.push("save"); },
    restore() { operations.push("restore"); },
    beginPath() { operations.push("beginPath"); },
    arc(...args) { operations.push(["arc", ...args]); },
    stroke() { operations.push("stroke"); },
    createLinearGradient() {
      return {
        addColorStop(offset, color) { operations.push(["gradient", offset, color]); }
      };
    },
    lineWidth: 1,
    strokeStyle: "#000"
  };

  for (const style of ["none", "gold", "silver", "iron", "arcane", "ruby"]) {
    operations.length = 0;
    drawTokenFrame(fakeCtx, 256, 256, 256, style);
    if (style === "none") {
      assert.equal(operations.length, 0, "No operations for style 'none'");
    } else {
      assert.ok(operations.includes("save"), `Style ${style} called save`);
      assert.ok(operations.includes("restore"), `Style ${style} called restore`);
      assert.ok(operations.some((op) => Array.isArray(op) && op[0] === "arc"), `Style ${style} drew circle arc`);
    }
  }
});

test("renderTokenToCanvas clips circle, respects transparency and background color", () => {
  const calls = [];
  const fakeCanvas = {
    width: 512,
    height: 512,
    getContext(type) {
      assert.equal(type, "2d");
      return {
        save() { calls.push("save"); },
        restore() { calls.push("restore"); },
        clearRect(x, y, w, h) { calls.push(["clearRect", x, y, w, h]); },
        beginPath() { calls.push("beginPath"); },
        arc(cx, cy, r, sa, ea) { calls.push(["arc", cx, cy, r, sa, ea]); },
        clip() { calls.push("clip"); },
        fillRect(x, y, w, h) { calls.push(["fillRect", x, y, w, h, this.fillStyle]); },
        drawImage(...args) { calls.push(["drawImage", ...args]); },
        createLinearGradient() {
          return { addColorStop() {} };
        },
        stroke() {},
        fillStyle: "#000"
      };
    }
  };

  const fakeImg = {
    naturalWidth: 800,
    naturalHeight: 600
  };

  // Test with transparency = true
  calls.length = 0;
  renderTokenToCanvas(fakeCanvas, fakeImg, {
    panX: 10,
    panY: -5,
    zoom: 1.2,
    transparent: true,
    bgColor: "#192720",
    frame: "gold"
  });

  assert.ok(calls.some(c => c[0] === "clearRect"), "Cleared canvas");
  assert.ok(calls.some(c => c[0] === "arc" && c[1] === 256 && c[2] === 256), "Clipped to circle");
  assert.ok(!calls.some(c => c[0] === "fillRect"), "Did not draw solid background when transparent = true");
  assert.ok(calls.some(c => c[0] === "drawImage"), "Drew image onto canvas");

  // Test with transparency = false
  calls.length = 0;
  renderTokenToCanvas(fakeCanvas, fakeImg, {
    panX: 0,
    panY: 0,
    zoom: 1.0,
    transparent: false,
    bgColor: "#3b1414",
    frame: "ruby"
  });

  assert.ok(calls.some(c => c[0] === "fillRect" && c[5] === "#3b1414"), "Drew solid background with selected color");
});

test("characterPage renders Upload token when no token exists, and Replace/Edit/Remove when token exists", () => {
  const characterWithoutToken = {
    id: "char-1",
    name: "Aramil",
    species: "Elf",
    characterClass: "Wizard",
    level: 3,
    abilities: [],
    attacks: [],
    skills: [],
    items: [],
    spells: []
  };

  const htmlWithout = characterPage(characterWithoutToken, "overview", {tokenEditable: true});
  assert.ok(htmlWithout.includes("Upload token"), "Shows Upload token when no tokenImage");
  assert.ok(!htmlWithout.includes("Edit token"), "Does not show Edit token when no tokenImage");
  assert.ok(!htmlWithout.includes("Remove token"), "Does not show Remove token when no tokenImage");

  const characterWithToken = {
    ...characterWithoutToken,
    tokenImage: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  };

  const htmlWith = characterPage(characterWithToken, "overview", {tokenEditable: true});
  assert.ok(htmlWith.includes("Replace token"), "Shows Replace token when tokenImage exists");
  assert.ok(htmlWith.includes("data-action=\"edit-token\""), "Shows Edit token button when tokenImage exists");
  assert.ok(htmlWith.includes("data-action=\"clear-token\""), "Shows Remove token button when tokenImage exists");
});
