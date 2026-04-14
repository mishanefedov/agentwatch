import { Box, Text } from "ink";
import type { AgentName } from "../schema.js";

interface Props {
  projectFilter: string | null;
  sessionFilter: string | null;
  sessionsForProject: string | null;
  subAgentScope: string | null;
  agentFilter: AgentName | null;
  searchQuery: string;
  view:
    | "timeline"
    | "projects"
    | "sessions"
    | "permissions"
    | "detail"
    | "help";
}

export function Breadcrumb(props: Props) {
  const parts: JSX.Element[] = [
    <Text key="root" color="cyan" bold>
      agentwatch
    </Text>,
  ];

  const push = (el: JSX.Element) => {
    parts.push(
      <Text key={`sep-${parts.length}`} dimColor>
        {" · "}
      </Text>,
    );
    parts.push(el);
  };

  if (props.view === "help") push(<Text key="v">help</Text>);
  if (props.view === "projects") push(<Text key="v">projects</Text>);
  if (props.view === "permissions") push(<Text key="v">permissions</Text>);

  if (props.sessionsForProject)
    push(
      <Text key="proj-list">
        <Text bold>{props.sessionsForProject}</Text>
        <Text dimColor> (sessions)</Text>
      </Text>,
    );

  if (props.projectFilter && !props.sessionsForProject)
    push(
      <Text key="proj">
        <Text dimColor>project </Text>
        <Text bold color="yellow">
          {props.projectFilter}
        </Text>
      </Text>,
    );

  if (props.sessionFilter)
    push(
      <Text key="sess">
        <Text dimColor>session </Text>
        <Text bold color="yellow">
          {props.sessionFilter.slice(0, 16)}
        </Text>
      </Text>,
    );

  if (props.subAgentScope)
    push(
      <Text key="sub">
        <Text dimColor>sub </Text>
        <Text bold color="yellow">
          {props.subAgentScope.slice(0, 12)}
        </Text>
      </Text>,
    );

  if (props.agentFilter)
    push(
      <Text key="agent">
        <Text dimColor>agent </Text>
        <Text bold color="yellow">
          {props.agentFilter}
        </Text>
      </Text>,
    );

  if (props.searchQuery)
    push(
      <Text key="q">
        <Text dimColor>search </Text>
        <Text bold color="yellow">
          "{props.searchQuery}"
        </Text>
      </Text>,
    );

  return (
    <Box>
      <Text>{parts}</Text>
    </Box>
  );
}
