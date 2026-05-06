import { normalizeDirectiveColons } from './src/lib/directive-normalizer.js';

// Test case 1: All same colon count (should be normalized to :::: and :::)
const input1 = `:::exercise
Intro

:::task
Task content
:::
:::`;

console.log("TEST 1 - Input (all ::: ):");
console.log(JSON.stringify(input1));
const output1 = normalizeDirectiveColons(input1);
console.log("\nTEST 1 - Output:");
console.log(JSON.stringify(output1));
console.log("\nTEST 1 - Diff:");
console.log("Input lines:");
input1.split('\n').forEach((l, i) => console.log(`  ${i}: ${JSON.stringify(l)}`));
console.log("Output lines:");
output1.split('\n').forEach((l, i) => console.log(`  ${i}: ${JSON.stringify(l)}`));

// Test case 2
const input2 = `:::exercise
:::task
:::
:::`;

console.log("\n\n\nTEST 2 - Simple nested case:");
const output2 = normalizeDirectiveColons(input2);
console.log("Input:");
console.log(input2);
console.log("\nOutput:");
console.log(output2);
