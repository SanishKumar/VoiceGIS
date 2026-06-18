/**
 * CommandChain.js
 * Splits compound voice commands into a sequence of individual commands.
 * 
 * Example: "Zoom to Paris and show the satellite layer"
 * -> ["Zoom to Paris", "show the satellite layer"]
 */

import { parseCommand } from './CommandParser.js';

// Words used to split chained commands
const CONJUNCTIONS = [
  ' and then ',
  ' and ',
  ' then ',
  ' also ',
  ' after that ',
  ' next '
];

/**
 * Splits a compound command string into an array of sub-commands based on conjunctions.
 * @param {string} text 
 * @returns {string[]}
 */
export function splitCommandString(text) {
  if (!text) return [];
  
  let currentText = text.toLowerCase();
  
  // Replace all conjunctions with a unified delimiter
  const DELIM = '|||';
  for (const conj of CONJUNCTIONS) {
    // Escape for regex and split globally
    currentText = currentText.split(conj).join(DELIM);
  }
  
  return currentText.split(DELIM).map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Parses a potentially chained command into an array of actionable intents.
 * @param {string} text
 * @param {object} options
 * @returns {Promise<Array<{ intent: string, payload: object, raw: string, confidence: number }>>}
 */
export async function parseCommandChain(text, options = {}) {
  const parts = splitCommandString(text);
  
  if (parts.length === 0) {
    return [await parseCommand(text, options)];
  }

  const results = [];
  for (const part of parts) {
    const res = await parseCommand(part, options);
    // Ignore unknowns if they are part of a larger chain where other things worked,
    // or just return everything so the executor can decide.
    results.push(res);
  }
  
  return results;
}
