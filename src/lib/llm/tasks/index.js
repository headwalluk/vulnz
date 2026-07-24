const releaseUrgency = require('./releaseUrgency');

/**
 * Registry of LLM tasks.
 *
 * A task is a plain object describing one unit of work the model does:
 *
 *   slug            registry key, used by runTask()
 *   description     one line, shown by `vulnz llm:status`
 *   modelEnvVar     optional env var naming a per-task model override, so a
 *                   demanding task can use a stronger model than the default
 *   maxTokens       response ceiling
 *   systemPrompt    the instruction
 *   buildUserPrompt (input) => string — throws if the input is unusable
 *   parseResult     (parsedJson) => result — throws if the shape is wrong
 *
 * Adding a task means adding a file here and one line below. No changes to
 * the client, the CLI, or anything else are needed.
 */
const TASKS = [releaseUrgency];

const TASKS_BY_SLUG = new Map(TASKS.map((task) => [task.slug, task]));

/**
 * @param {string} slug
 * @returns {object|undefined} the task, or undefined if unregistered
 */
function getTask(slug) {
  return TASKS_BY_SLUG.get(slug);
}

/**
 * @returns {Array<{slug:string, description:string}>} every registered task
 */
function listTasks() {
  return TASKS.map((task) => ({ slug: task.slug, description: task.description }));
}

module.exports = { getTask, listTasks };
