import assert from "node:assert";
import {
  parseRollCommand,
  executeRoll,
  formatRollMessage,
  parseRollMessage,
  visibleMessageText
} from "../dist/chat-commands.mjs";

console.log("Testing Chat Commands and Dice Roller...");

// Test 1: /roll d20 + 3d6 + d7
{
  const parsed = parseRollCommand("/roll d20 + 3d6 + d7");
  assert.ok(parsed, "Should parse /roll d20 + 3d6 + d7");
  assert.strictEqual(parsed.diceFormula, "d20 + 3d6 + d7");
  assert.strictEqual(parsed.advantage, false);
  assert.strictEqual(parsed.disadvantage, false);

  const result = executeRoll(parsed, { name: "Tester" });
  assert.strictEqual(result.dice.length, 5, "Should have 1d20 + 3d6 + 1d7 = 5 dice");
  assert.strictEqual(result.dice.filter(d => d.faces === 20).length, 1);
  assert.strictEqual(result.dice.filter(d => d.faces === 6).length, 3);
  assert.strictEqual(result.dice.filter(d => d.faces === 7).length, 1);
  assert.ok(result.total > 0, "Total should be positive");
  assert.strictEqual(result.event.rolls[0].dice.length, 5);
  console.log("✓ /roll d20 + 3d6 + d7 passed:", result.breakdown);
}

// Test 2: /roll 2d20
{
  const parsed = parseRollCommand("/roll 2d20");
  assert.ok(parsed);
  assert.strictEqual(parsed.diceFormula, "2d20");
  assert.strictEqual(parsed.advantage, false);
  assert.strictEqual(parsed.disadvantage, false);

  const result = executeRoll(parsed, { name: "Tester" });
  assert.strictEqual(result.dice.length, 2, "Should have 2 dice");
  assert.strictEqual(result.dice[0].faces, 20);
  assert.strictEqual(result.dice[1].faces, 20);
  assert.strictEqual(result.dice[0].discarded, false);
  assert.strictEqual(result.dice[1].discarded, false);
  console.log("✓ /roll 2d20 passed:", result.breakdown);
}

// Test 3: /roll d20a (Advantage)
{
  const parsed = parseRollCommand("/roll d20a");
  assert.ok(parsed);
  assert.strictEqual(parsed.advantage, true);
  assert.strictEqual(parsed.disadvantage, false);

  const result = executeRoll(parsed, { name: "Tester" });
  assert.strictEqual(result.dice.length, 2, "Advantage should roll 2d20");
  const keptDice = result.dice.filter(d => !d.discarded);
  const discardedDice = result.dice.filter(d => d.discarded);
  assert.strictEqual(keptDice.length, 1, "Should keep 1 die");
  assert.strictEqual(discardedDice.length, 1, "Should discard 1 die");
  assert.ok(keptDice[0].value >= discardedDice[0].value, "Kept die should be >= discarded die");
  assert.strictEqual(result.total, keptDice[0].value);
  assert.ok(result.actionTitle.includes("Advantage"));
  console.log("✓ /roll d20a passed:", result.breakdown);
}

// Test 4: /roll d20d (Disadvantage)
{
  const parsed = parseRollCommand("/roll d20d");
  assert.ok(parsed);
  assert.strictEqual(parsed.advantage, false);
  assert.strictEqual(parsed.disadvantage, true);

  const result = executeRoll(parsed, { name: "Tester" });
  assert.strictEqual(result.dice.length, 2, "Disadvantage should roll 2d20");
  const keptDice = result.dice.filter(d => !d.discarded);
  const discardedDice = result.dice.filter(d => d.discarded);
  assert.strictEqual(keptDice.length, 1, "Should keep 1 die");
  assert.strictEqual(discardedDice.length, 1, "Should discard 1 die");
  assert.ok(keptDice[0].value <= discardedDice[0].value, "Kept die should be <= discarded die");
  assert.strictEqual(result.total, keptDice[0].value);
  assert.ok(result.actionTitle.includes("Disadvantage"));
  console.log("✓ /roll d20d passed:", result.breakdown);
}

// Test 5: /roll d20a + 5 Athletics (Advantage with modifier and label)
{
  const parsed = parseRollCommand("/roll d20a + 5 Athletics");
  assert.ok(parsed);
  assert.strictEqual(parsed.advantage, true);
  assert.strictEqual(parsed.label, "Athletics");

  const result = executeRoll(parsed, { name: "Garrick" });
  const keptDice = result.dice.filter(d => !d.discarded);
  assert.strictEqual(result.total, keptDice[0].value + 5);
  assert.ok(result.actionTitle.includes("Athletics"));
  console.log("✓ /roll d20a + 5 Athletics passed:", result.actionTitle, "->", result.breakdown);
}

// Test 6: Serialization & Deserialization
{
  const parsed = parseRollCommand("/roll 1d20 + 2d6 + 3");
  const result = executeRoll(parsed, { name: "Alice" });
  const messageBody = formatRollMessage(result);
  
  const visible = visibleMessageText(messageBody);
  assert.ok(visible.startsWith("🎲"), "Visible text should start with dice emoji");
  assert.ok(!visible.includes("\u200B"), "Visible text should not contain zero-width metadata");

  const parsedMsg = parseRollMessage(messageBody);
  assert.ok(parsedMsg, "Should deserialize message");
  assert.strictEqual(parsedMsg.name, "Alice");
  assert.strictEqual(parsedMsg.rolls[0].total, result.total);
  assert.strictEqual(parsedMsg.rolls[0].dice.length, result.dice.length);
  console.log("✓ Network serialization & replay passed");
}

console.log("\nAll Chat Command tests passed successfully!");
