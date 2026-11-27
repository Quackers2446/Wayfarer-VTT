#!/usr/bin/env node
/**
 * Offline LLM Feature Compiler (Layer 3.5)
 *
 * Walks 5etools adventure JSON, extracts interactive room features into the
 * Layer 1 schema, and writes data/compiled-features/<module>.json (also mirrored
 * under dist/compiled-features for the client bundle).
 *
 * Usage:
 *   node scripts/compile-features.mjs --module lmop --data /path/to/5etools/data
 *   node scripts/compile-features.mjs --module dotmm --data ./vendor/5etools/data --api-key $GEMINI_API_KEY
 *   node scripts/compile-features.mjs --module lmop --data ./data --dry-run
 *
 * Without an API key, falls back to the deterministic extractRegionFeatures parser
 * (same grounding rules; no invented content).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRegionFeatures } from "../dist/scene-data.mjs";
import { normalizeFeature, stripSourceExcerpts } from "../dist/room-features.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SYSTEM_PROMPT = `You are a D&D 5e adventure data compiler. Extract interactive room features from the provided 5etools room JSON into the target Layer 1 Feature Schema.

RULES:
1. STRICT GROUNDING: Only extract traps, secrets, hidden creatures, mechanisms, interactive lore, hazards, and non-obvious treasure explicitly present in the text. Include an exact "sourceExcerpt" quote from the text for every feature. Never invent rooms, DCs, items, or monsters.
2. SURFACE VS. TRUTH SPLIT:
   - "surfaceText": What players immediately perceive upon entering or looking at the object (player-safe, no spoilers).
   - "truthText": What is revealed upon a successful Search/Investigate check or interaction.
3. HIDDEN CREATURES: If a monster is disguised, clinging to a ceiling/statue, or waiting in ambush, emit it as kind "creature_hint" with state "hidden" and an onSuccess/onTrigger outcome of "spawn_creature" using the exact {@creature} name.
4. DCs & SKILLS: Use exact {@dc N} and {@skill X} values when present. If a secret/trap is described without an explicit DC, infer a standard 5e DC (10 easy, 13 moderate, 15 hard) and set "inferredDC": true.
5. SPARSE ROOMS: If a room has no interactive environmental elements, secrets, traps, or hidden threats, return an empty features array [].

Respond with JSON only: {"features":[...]} matching the schema.`;

const FEATURE_SCHEMA = {
  type: "object",
  properties: {
    features: {
      type: "array",
      items: {
        type: "object",
        required: ["kind", "name", "state", "surfaceText", "truthText", "sourceExcerpt"],
        properties: {
          id: { type: "string" },
          regionId: { type: "string" },
          kind: { type: "string", enum: ["trap", "secret", "hazard", "treasure", "mechanism", "lore", "creature_hint", "object"] },
          name: { type: "string" },
          state: { type: "string", enum: ["hidden", "hinted", "revealed", "resolved", "triggered"] },
          passivePerceptionDC: { type: "number" },
          surfaceText: { type: "string" },
          truthText: { type: "string" },
          sourceExcerpt: { type: "string" },
          inferredDC: { type: "boolean" },
          requiresItem: { type: "string" },
          check: {
            type: "object",
            properties: {
              skill: { type: "string" },
              dc: { type: "number" },
              inferredDC: { type: "boolean" },
            },
          },
          outcomes: { type: "array" },
        },
      },
    },
  },
  required: ["features"],
};

function parseArgs(argv) {
  const args = { modules: [], data: "", apiKey: process.env.GEMINI_API_KEY || process.env.WAYFARER_COMPILE_KEY || "", dryRun: false, model: "gemini-2.0-flash" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--module" || arg === "-m") args.modules.push(argv[++i]);
    else if (arg === "--data" || arg === "-d") args.data = argv[++i];
    else if (arg === "--api-key") args.apiKey = argv[++i];
    else if (arg === "--model") args.model = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  if (!args.modules.length) args.modules = ["lmop", "dotmm"];
  return args;
}

function hashEntry(entry) {
  return createHash("sha256").update(JSON.stringify(entry ?? null)).digest("hex");
}

function *walk(node) {
  if (Array.isArray(node)) for (const value of node) yield *walk(value);
  else if (node && typeof node === "object") {
    yield node;
    for (const value of Object.values(node)) yield *walk(value);
  }
}

function roomEntries(archive) {
  const chapters = archive?.data ?? archive?.adventureData?.[0]?.data ?? [];
  const rooms = new Map();
  for (const chapter of chapters) {
    for (const node of walk(chapter)) {
      if (!node?.id || node.href || node.type === "image") continue;
      if (!node.entries && !node.entry) continue;
      // Prefer numbered adventure areas (common 5etools ids).
      if (!/^[0-9a-z]+$/i.test(node.id)) continue;
      rooms.set(node.id, { id: node.id, name: node.name, entry: { name: node.name, entries: node.entries ?? node.entry } });
    }
  }
  return [...rooms.values()];
}

function grounded(features, plainText) {
  const text = String(plainText || "");
  return (features ?? []).filter((feature) => {
    const excerpt = String(feature.sourceExcerpt || "").trim();
    if (!excerpt) return false;
    // Allow minor whitespace differences.
    const needle = excerpt.replace(/\s+/g, " ").slice(0, 80);
    const hay = text.replace(/\s+/g, " ");
    return hay.includes(needle) || hay.toLowerCase().includes(needle.toLowerCase());
  });
}

function flattenText(node, parts = []) {
  if (typeof node === "string") parts.push(node);
  else if (Array.isArray(node)) node.forEach((entry) => flattenText(entry, parts));
  else if (node && typeof node === "object") {
    for (const key of ["entries", "entry", "items"]) flattenText(node[key], parts);
  }
  return parts.join("\n");
}

async function callGemini(apiKey, model, room, schema) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: "Room id: " + room.id + "\nName: " + (room.name || "") + "\nJSON:\n" + JSON.stringify(room.entry) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.1,
    },
  };
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("Gemini " + response.status + ": " + (await response.text()).slice(0, 400));
  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "{}";
  return JSON.parse(text);
}

function deterministicFeatures(room) {
  return extractRegionFeatures(room, new Set()).map((feature) => normalizeFeature({
    ...feature,
    regionId: room.id,
    sourceExcerpt: feature.sourceExcerpt || feature.truthText || feature.surfaceText,
  }, { regionId: room.id, moduleId: "compile" }));
}

async function compileModule(moduleId, dataDir, { apiKey, model, dryRun }) {
  const adventurePath = join(dataDir, "adventure", `adventure-${moduleId.toLowerCase()}.json`);
  await access(adventurePath);
  const archive = JSON.parse(await readFile(adventurePath, "utf8"));
  const outDir = join(root, "data", "compiled-features");
  const distDir = join(root, "dist", "compiled-features");
  await mkdir(outDir, { recursive: true });
  await mkdir(distDir, { recursive: true });
  const outPath = join(outDir, `${moduleId.toLowerCase()}.json`);
  let previous = { module: moduleId.toLowerCase(), regions: {} };
  try { previous = JSON.parse(await readFile(outPath, "utf8")); } catch { /* first run */ }

  const rooms = roomEntries(archive);
  const next = { module: moduleId.toLowerCase(), generatedAt: new Date().toISOString(), regions: { ...previous.regions } };
  let compiled = 0, skipped = 0, empty = 0;

  for (const room of rooms) {
    const hash = hashEntry(room.entry);
    const cached = previous.regions?.[room.id];
    if (cached?.hash === hash && Array.isArray(cached.features)) {
      next.regions[room.id] = cached;
      skipped++;
      continue;
    }
    let features = [];
    if (apiKey && !dryRun) {
      try {
        const result = await callGemini(apiKey, model, room, FEATURE_SCHEMA);
        const plain = flattenText(room.entry);
        features = grounded(result.features, plain).map((feature) => normalizeFeature({
          ...feature,
          regionId: room.id,
        }, { regionId: room.id, moduleId: moduleId }));
      } catch (error) {
        console.warn(`[${moduleId}/${room.id}] LLM failed (${error.message}); using deterministic extract.`);
        features = deterministicFeatures(room);
      }
    } else {
      features = deterministicFeatures(room);
    }
    // Keep sourceExcerpt in the on-disk cache for review; runtime strip happens at load.
    next.regions[room.id] = { hash, name: room.name, features };
    compiled++;
    if (!features.length) empty++;
    if (compiled % 25 === 0) console.log(`[${moduleId}] compiled ${compiled} rooms…`);
  }

  const shipped = {
    ...next,
    regions: Object.fromEntries(Object.entries(next.regions).map(([id, entry]) => [id, {
      ...entry,
      features: stripSourceExcerpts(entry.features ?? []),
    }])),
  };

  if (!dryRun) {
    await writeFile(outPath, JSON.stringify(next, null, 2));
    await writeFile(join(distDir, `${moduleId.toLowerCase()}.json`), JSON.stringify(shipped, null, 2));
  }
  console.log(`[${moduleId}] rooms=${rooms.length} compiled=${compiled} skipped=${skipped} empty=${empty}${dryRun ? " (dry-run)" : ""} → ${outPath}`);
  return next;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.data) {
  console.log(`Usage: node scripts/compile-features.mjs --data <5etools-data-dir> [--module lmop] [--api-key KEY] [--dry-run]
Modules default to lmop,dotmm. Without --api-key, uses deterministic extraction only.`);
  process.exit(args.help ? 0 : 1);
}

const dataDir = resolve(args.data);
for (const moduleId of args.modules) {
  await compileModule(moduleId, dataDir, args);
}
