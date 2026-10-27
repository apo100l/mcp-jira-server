import { JiraIssue, JiraProject } from './jira-client.js';

interface JiraUserRef {
  name?: string;
  displayName?: string;
}

function compactUser(user?: JiraUserRef | null): { name?: string; displayName?: string } | null {
  if (!user) {
    return null;
  }
  return { name: user.name, displayName: user.displayName };
}

export function compactIssue(issue: JiraIssue, includeDescription = false): Record<string, unknown> {
  const fields = issue.fields || ({} as JiraIssue['fields']);
  const result: Record<string, unknown> = {
    key: issue.key,
    summary: fields.summary,
    type: fields.issuetype?.name,
    status: fields.status?.name,
    priority: fields.priority?.name,
    assignee: compactUser(fields.assignee as JiraUserRef | undefined),
    reporter: compactUser(fields.reporter as JiraUserRef | undefined),
    created: fields.created,
    updated: fields.updated,
  };
  if (includeDescription) {
    result.description = fields.description ?? null;
  }
  return result;
}

export function compactProject(project: JiraProject): Record<string, unknown> {
  return {
    key: project.key,
    name: project.name,
    id: project.id,
    type: project.projectTypeKey,
  };
}
