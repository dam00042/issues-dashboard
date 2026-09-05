"use client";

import { Button, Dropdown } from "@heroui/react";
import {
  CircleCheckBig,
  CircleDot,
  CircleX,
  ExternalLink,
  FilePenLine,
  GitMerge,
  GitPullRequest,
  ListFilter,
  MessageSquare,
  UserCheck,
  Users,
} from "lucide-react";
import { useState } from "react";

import type {
  GitHubPullRequest,
  PullRequestStateFilter,
} from "@/features/issues-dashboard/types";
import { formatRelativeTimestamp } from "@/features/issues-dashboard/utils/dashboard-helpers";

type SelectablePullRequestStateFilter = Exclude<
  PullRequestStateFilter,
  "custom"
>;

const PULL_REQUEST_FILTERS: readonly SelectablePullRequestStateFilter[] = [
  "all",
  "open",
  "draft",
  "merged",
  "closed",
];

function getFilterLabel(filter: PullRequestStateFilter): string {
  if (filter === "open") return "Abiertas";
  if (filter === "draft") return "Draft";
  if (filter === "merged") return "Merged";
  if (filter === "closed") return "Cerradas";
  if (filter === "custom") return "Estado personalizado";
  return "Todas · Estado";
}

function PullRequestFilterIcon({ filter }: { filter: PullRequestStateFilter }) {
  const Icon =
    filter === "open"
      ? CircleDot
      : filter === "draft"
        ? FilePenLine
        : filter === "merged"
          ? GitMerge
          : filter === "closed"
            ? CircleX
            : ListFilter;
  const className =
    filter === "open"
      ? "text-[#22c55e]"
      : filter === "merged"
        ? "text-[#a855f7]"
        : filter === "closed"
          ? "text-[#f85149]"
          : "text-[rgb(var(--app-muted))]";
  return <Icon size={13} className={`shrink-0 ${className}`} />;
}

function matchesPullRequestFilter(
  pullRequest: GitHubPullRequest,
  filter: SelectablePullRequestStateFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "draft") return pullRequest.isDraft;
  if (filter === "open") {
    return pullRequest.state === "open" && !pullRequest.isDraft;
  }
  return pullRequest.state === filter;
}

function PullRequestFilter({
  ariaLabel,
  value,
  onChange,
}: {
  ariaLabel: string;
  value: PullRequestStateFilter;
  onChange: (filter: SelectablePullRequestStateFilter) => void;
}) {
  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label={ariaLabel}
        className="button button--sm button--outline max-w-[12rem] rounded-[0.75rem] px-2.5"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <PullRequestFilterIcon filter={value} />
          <span className="truncate">{getFilterLabel(value)}</span>
        </span>
      </Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu aria-label={ariaLabel}>
          {PULL_REQUEST_FILTERS.map((filter) => (
            <Dropdown.Item
              id={`pull-request-state:${ariaLabel}:${filter}`}
              key={filter}
              onPress={() => onChange(filter)}
            >
              <span className="flex items-center gap-2">
                <PullRequestFilterIcon filter={filter} />
                <span>{getFilterLabel(filter)}</span>
              </span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

function getStateLabel(pullRequest: GitHubPullRequest): string {
  if (pullRequest.isDraft) return "Draft";
  if (pullRequest.state === "merged") return "Merged";
  if (pullRequest.state === "closed") return "Cerrada";
  return "Abierta";
}

function getStateClassName(pullRequest: GitHubPullRequest): string {
  if (pullRequest.isDraft)
    return "border-slate-500/40 bg-slate-500/12 text-slate-400";
  if (pullRequest.state === "merged") {
    return "border-[#a855f7]/40 bg-[#a855f7]/12 text-[#a855f7]";
  }
  if (pullRequest.state === "closed") {
    return "border-[#f85149]/40 bg-[#f85149]/12 text-[#f85149]";
  }
  return "border-[#22c55e]/40 bg-[#22c55e]/12 text-[#22c55e]";
}

function getReviewLabel(pullRequest: GitHubPullRequest): string {
  if (pullRequest.isDraft) return "Aún no está lista para revisar";
  if (pullRequest.state !== "open") {
    return pullRequest.state === "merged" ? "Integrada" : "Finalizada";
  }
  if (pullRequest.viewerRole === "review_requested") {
    return "Requiere tu revisión";
  }
  if (pullRequest.viewerRole === "reviewed") {
    if (pullRequest.viewerReviewState === "approved") return "Aprobada por ti";
    if (pullRequest.viewerReviewState === "changes_requested") {
      return "Has solicitado cambios";
    }
    return "Ya la has revisado";
  }
  if (pullRequest.reviewDecision === "approved") return "Revisión aprobada";
  if (pullRequest.reviewDecision === "changes_requested") {
    return "Te han solicitado cambios";
  }
  if (pullRequest.reviewDecision === "review_required") {
    return "Esperando revisión";
  }
  return "Sin revisión requerida";
}

function getReviewClassName(pullRequest: GitHubPullRequest): string {
  if (
    pullRequest.viewerRole === "review_requested" ||
    pullRequest.reviewDecision === "changes_requested"
  ) {
    return "text-[#d97706]";
  }
  if (
    pullRequest.reviewDecision === "approved" ||
    pullRequest.viewerReviewState === "approved"
  ) {
    return "text-[#22c55e]";
  }
  return "text-[rgb(var(--app-muted))]";
}

function getReviewParticipantLabel(pullRequest: GitHubPullRequest): string {
  if (pullRequest.viewerRole !== "authored") {
    return pullRequest.authorLogin
      ? `Solicitada por @${pullRequest.authorLogin}`
      : "Solicitante no disponible";
  }
  if (!pullRequest.reviewerLogins.length) return "Sin reviewer asignado";
  const reviewers = pullRequest.reviewerLogins
    .map((reviewer) => `@${reviewer}`)
    .join(", ");
  return `${pullRequest.reviewerLogins.length === 1 ? "Reviewer" : "Reviewers"}: ${reviewers}`;
}

function PullRequestCard({ pullRequest }: { pullRequest: GitHubPullRequest }) {
  const StateIcon = pullRequest.state === "merged" ? GitMerge : GitPullRequest;

  return (
    <article className="rounded-[1rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/86 p-3 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[rgb(var(--app-muted))]">
            <span className="truncate font-semibold text-[rgb(var(--app-foreground))]">
              {pullRequest.repositoryFullName}
            </span>
            <span>#{pullRequest.number}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${getStateClassName(pullRequest)}`}
            >
              <StateIcon size={11} />
              {getStateLabel(pullRequest)}
            </span>
          </div>

          <h3 className="mt-2 text-sm font-semibold leading-5 text-[rgb(var(--app-foreground))]">
            {pullRequest.title}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            <span
              className={`inline-flex items-center gap-1 ${getReviewClassName(pullRequest)}`}
            >
              {pullRequest.viewerRole === "review_requested" ? (
                <UserCheck size={12} />
              ) : (
                <CircleCheckBig size={12} />
              )}
              {getReviewLabel(pullRequest)}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1 text-[rgb(var(--app-muted))]">
              <Users size={12} className="shrink-0" />
              <span className="truncate">
                {getReviewParticipantLabel(pullRequest)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-[rgb(var(--app-muted))]">
              <MessageSquare size={11} />
              {pullRequest.commentsCount}
            </span>
            <span className="text-[rgb(var(--app-muted))]">
              Actualizada {formatRelativeTimestamp(pullRequest.updatedAt)}
            </span>
          </div>
        </div>

        <Button
          isIconOnly
          aria-label={`Abrir Pull Request #${String(pullRequest.number)} en GitHub`}
          size="sm"
          variant="outline"
          onPress={() =>
            window.open(pullRequest.htmlUrl, "_blank", "noopener,noreferrer")
          }
        >
          <ExternalLink size={14} />
        </Button>
      </div>
    </article>
  );
}

function PullRequestQuadrant({
  emptyMessage,
  filter,
  icon: Icon,
  pullRequests,
  title,
  onFilterChange,
}: {
  emptyMessage: string;
  filter: SelectablePullRequestStateFilter;
  icon: typeof GitPullRequest;
  pullRequests: GitHubPullRequest[];
  title: string;
  onFilterChange: (filter: SelectablePullRequestStateFilter) => void;
}) {
  const filteredPullRequests = pullRequests.filter((pullRequest) =>
    matchesPullRequestFilter(pullRequest, filter),
  );

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96">
      <header className="flex items-center justify-between gap-3 border-b border-[rgb(var(--app-border))]/55 px-3.5 py-3">
        <div className="inline-flex items-center gap-2">
          <Icon size={16} className="text-[rgb(var(--app-accent-strong))]" />
          <h2 className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
            {title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <PullRequestFilter
            ariaLabel={`Filtrar ${title}`}
            value={filter}
            onChange={onFilterChange}
          />
          <span className="rounded-full bg-[rgb(var(--app-surface-strong))] px-2 py-0.5 text-[11px] font-bold text-[rgb(var(--app-muted))]">
            {filteredPullRequests.length}
            {filteredPullRequests.length !== pullRequests.length
              ? `/${String(pullRequests.length)}`
              : ""}
          </span>
        </div>
      </header>
      <div className="app-scrollbar min-h-0 flex-1 overflow-auto p-2.5">
        {filteredPullRequests.length ? (
          <div className="space-y-2">
            {filteredPullRequests.map((pullRequest) => (
              <PullRequestCard
                key={pullRequest.nodeId}
                pullRequest={pullRequest}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-[1rem] border border-dashed border-[rgb(var(--app-border))]/70 px-4 py-10 text-center text-sm text-[rgb(var(--app-muted))]">
            {pullRequests.length
              ? "No hay Pull Requests con este estado."
              : emptyMessage}
          </div>
        )}
      </div>
    </section>
  );
}

export function PullRequestsBoard({
  pullRequests,
  warning,
}: {
  pullRequests: GitHubPullRequest[];
  warning: string;
}) {
  const [authoredFilter, setAuthoredFilter] =
    useState<SelectablePullRequestStateFilter>("open");
  const [requestedFilter, setRequestedFilter] =
    useState<SelectablePullRequestStateFilter>("open");
  const authored = pullRequests.filter(
    (pullRequest) => pullRequest.viewerRole === "authored",
  );
  const requested = pullRequests.filter(
    (pullRequest) => pullRequest.viewerRole !== "authored",
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {warning ? (
        <div className="px-1">
          <p className="text-xs text-[rgb(var(--app-muted))]">{warning}</p>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-2">
        <PullRequestQuadrant
          emptyMessage="No hay Pull Requests creadas por ti en esta vista."
          filter={authoredFilter}
          icon={GitPullRequest}
          pullRequests={authored}
          title="PRs solicitadas por mí"
          onFilterChange={setAuthoredFilter}
        />
        <PullRequestQuadrant
          emptyMessage="No tienes revisiones solicitadas ni PRs revisadas recientemente."
          filter={requestedFilter}
          icon={UserCheck}
          pullRequests={requested}
          title="PRs que me solicitan"
          onFilterChange={setRequestedFilter}
        />
      </div>
    </div>
  );
}
