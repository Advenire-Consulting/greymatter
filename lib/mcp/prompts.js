'use strict';

const path = require('path');
const errors = require('./errors');

// spec L332-L336
function orientProject({ project }) {
  if (!project) throw new errors.BadRequestError('project required');
  return `Call get_project_overview("${project}") and get_status() in parallel. ` +
    `Then summarize: what is in the project, where work was last left off, and what the label coverage is. ` +
    `Be concise — three to five sentences.`;
}

// spec L338-L342
function safeToDelete({ project, file }) {
  if (!project) throw new errors.BadRequestError('project required');
  if (!file) throw new errors.BadRequestError('file required');
  const basename = path.basename(file);
  return `To determine whether "${file}" in project "${project}" is safe to delete:\n` +
    `1. Call query_blast_radius("${project}", "${file}") to find code consumers.\n` +
    `2. Call grep_project("${project}", "${basename}") to find textual contracts ` +
    `(markdown commands, README mentions, plan documents) that the code graph does not track.\n` +
    `Synthesize a yes-or-no recommendation with the specific reasons that block or permit deletion.`;
}

// spec L344-L348
function understandFlow({ project, file, name }) {
  if (!project) throw new errors.BadRequestError('project required');
  if (!file) throw new errors.BadRequestError('file required');
  if (!name) throw new errors.BadRequestError('name required');
  return `To understand the flow starting at "${name}" in "${file}" (project "${project}"):\n` +
    `1. Call walk_flow("${project}", "${file}", "${name}") to get the path skeleton.\n` +
    `2. Identify the 2-3 steps that carry the most explanatory weight (typically the entry, ` +
    `a middle decision point, and the exit).\n` +
    `3. Call get_node_bundle on each of those steps.\n` +
    `Weave the results into a narrative explanation of the flow.`;
}

const PROMPTS = [
  {
    name: 'orient_project',
    description: 'Orient in a project: call get_project_overview + get_status, then summarize state, recent activity, and label coverage.',
    arguments: [
      { name: 'project', description: 'Project name as returned by get_status', required: true },
    ],
    handler: orientProject,
  },
  {
    name: 'safe_to_delete',
    description: 'Determine whether a file is safe to delete: checks code consumers via query_blast_radius and textual contracts via grep_project.',
    arguments: [
      { name: 'project', description: 'Project name', required: true },
      { name: 'file', description: 'Relative file path to evaluate', required: true },
    ],
    handler: safeToDelete,
  },
  {
    name: 'understand_flow',
    description: 'Understand the flow through a named symbol: walks the path skeleton, identifies key steps, and drills into them with get_node_bundle.',
    arguments: [
      { name: 'project', description: 'Project name', required: true },
      { name: 'file', description: 'Relative file path containing the symbol', required: true },
      { name: 'name', description: 'Symbol name to trace', required: true },
    ],
    handler: understandFlow,
  },
];

module.exports = { PROMPTS };
