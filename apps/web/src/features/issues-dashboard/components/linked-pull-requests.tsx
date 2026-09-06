"use client";

import { Disclosure } from "@heroui/react";
import { ExternalLink, GitMerge, GitPullRequest } from "lucide-react";

import type {
  DashboardIssue,
  GitHubPullRequest,
} from "@/features/issues-dashboard/types";

function getLinkedPullRequests(issue: DashboardIssue): GitHubPullRequest[] {
  const linkedById = new Map<string, GitHubPullRequest>();
  for (const projectItem of issue.projectItems ?? []) {
    for (const pullRequest of projectItem.linkedPullRequests ?? []) {
      linkedById.set(pullRequest.nodeId, pullRequest);
    }
  }
  return [...linkedById.values()];
}

function getStateLabel(pullRequest: GitHubPullRequest): string {
  if (pullRequest.isDraft) return "Draft";
  if (pullRequest.state === "merged") return "Merged";
  if (pullRequest.state === "closed") return "Cerrada";
  return "Abierta";
}

export function LinkedPullRequests({
  defaultCollapsed = true,
  issue,
}: {
  defaultCollapsed?: boolean;
  issue: DashboardIssue;
}) {
  const linkedPullRequests = getLinkedPullRequests(issue);

  return (
    <section className="border-b border-[rgb(var(--app-border))]/55 px-3 py-2.5">
      <Disclosure
        key={issue.issueKey}
        className="w-full bg-transparent"
        defaultExpanded={!defaultCollapsed}
      >
        <Disclosure.Heading className="m-0">
          <Disclosure.Trigger className="flex w-full items-center justify-between gap-2 rounded-[0.65rem] px-1 py-1 text-left outline-none transition hover:bg-[rgb(var(--app-surface-strong))]/65 focus-visible:ring-2 focus-visible:ring-[rgb(var(--app-accent))]/45">
            <span className="inline-flex min-w-0 items-center gap-2">
              <GitPullRequest
                size={14}
                className="shrink-0 text-[rgb(var(--app-accent-strong))]"
              />
              <span className="truncate text-[0.7rem] font-semibold uppercase tracking-[0.13em] text-[rgb(var(--app-muted))]">
                Pull requests enlazadas
              </span>
              <span className="rounded-full bg-[rgb(var(--app-surface-strong))] px-1.5 py-0.5 text-[10px] font-bold text-[rgb(var(--app-muted))]">
                {linkedPullRequests.length}
              </span>
            </span>
            <Disclosure.Indicator className="size-4 shrink-0 text-[rgb(var(--app-muted))]" />
          </Disclosure.Trigger>
        </Disclosure.Heading>

        <Disclosure.Content className="pt-2">
          {linkedPullRequests.length ? (
            <div className="space-y-1.5">
              {linkedPullRequests.map((pullRequest) => {
                const StateIcon =
                  pullRequest.state === "merged" ? GitMerge : GitPullRequest;
                return (
                  <button
                    type="button"
                    key={pullRequest.nodeId}
                    className="flex w-full items-center gap-2 rounded-[0.75rem] border border-[rgb(var(--app-border))]/60 bg-[rgb(var(--app-surface-strong))]/72 px-2.5 py-2 text-left transition hover:border-[rgb(var(--app-accent))]/35"
                    onClick={() =>
                      window.open(
                        pullRequest.htmlUrl,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    <StateIcon
                      size={13}
                      className={
                        pullRequest.state === "merged"
                          ? "shrink-0 text-[#a855f7]"
                          : "shrink-0 text-[#22c55e]"
                      }
                    />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-[rgb(var(--app-foreground))]">
                      {pullRequest.repositoryFullName} #{pullRequest.number} ·{" "}
                      {pullRequest.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-[rgb(var(--app-muted))]">
                      {getStateLabel(pullRequest)}
                    </span>
                    <ExternalLink
                      size={11}
                      className="shrink-0 text-[rgb(var(--app-muted))]"
                    />
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-[rgb(var(--app-muted))]">
              Esta issue no tiene ninguna PR enlazada en Projects.
            </p>
          )}
        </Disclosure.Content>
      </Disclosure>
    </section>
  );
}
