"""Fetch assigned issues and their GitHub Projects fields."""

from __future__ import annotations

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from datetime import timedelta
from time import monotonic
from typing import TYPE_CHECKING, Literal, cast

import httpx
from pydantic import BaseModel, ConfigDict, TypeAdapter

from dashboard_api.issues.models import (
    ClosedIssueWindow,
    GitHubAssignedIssue,
    GitHubProjectFieldValue,
    GitHubProjectItem,
    GitHubPullRequest,
    ProjectFieldKind,
    PullRequestReviewDecision,
    PullRequestViewerRole,
    PullRequestWindow,
)
from dashboard_api.issues.service import (
    AssignedIssuesFetchResult,
    GitHubAuthenticationError,
    PullRequestFetchResult,
)
from dashboard_api.time_utils import normalize_utc_iso, subtract_months, utc_now

if TYPE_CHECKING:
    from dashboard_api.settings import AppSettings


LOGGER = logging.getLogger(__name__)
ISSUES_PAGE_SIZE = 100
PROJECT_QUERY_BATCH_SIZE = 100
PROJECT_CACHE_TTL_SECONDS = 300
PULL_REQUEST_CACHE_TTL_SECONDS = 120
PROJECT_FILTER_FIELD_NAMES = frozenset({"status", "sprint", "priority"})
PROJECT_FIELDS_WARNING = (
    "No se han podido leer los campos de GitHub Projects. "
    "El token debe tener el permiso read:project y acceso al proyecto."
)
PROJECT_RATE_LIMIT_WARNING = (
    "GitHub ha alcanzado temporalmente el límite de consultas de Projects. "
    "Se mantienen los datos guardados; vuelve a refrescar dentro de unos minutos."
)
PULL_REQUESTS_WARNING = (
    "No se ha podido cargar la actividad de Pull Requests de GitHub."
)
ISSUE_PROJECT_FIELDS_QUERY = """
query IssueProjectFields($ids: [ID!]!) {
  rateLimit { cost remaining resetAt }
  nodes(ids: $ids) {
    ... on Issue {
      id
      issueType { name }
      projectItems(first: 5) {
        nodes {
          project { id number title url }
          fieldValues(first: 20) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldIterationValue {
                title
                field { ...ProjectFieldIdentity }
              }
              ... on ProjectV2ItemFieldPullRequestValue {
                pullRequests(first: 5) {
                  nodes {
                    id
                    number
                    title
                    url
                    state
                    isDraft
                    mergedAt
                    updatedAt
                    author { login }
                    repository { nameWithOwner }
                  }
                }
              }
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field { ...ProjectFieldIdentity }
              }
            }
          }
        }
      }
    }
  }
}

fragment ProjectFieldIdentity on ProjectV2FieldConfiguration {
  ... on ProjectV2Field { id name }
  ... on ProjectV2IterationField { id name }
  ... on ProjectV2SingleSelectField { id name }
}
"""

PULL_REQUEST_DASHBOARD_QUERY = """
query PullRequestDashboard(
  $authoredQuery: String!
  $reviewRequestedQuery: String!
  $reviewedQuery: String!
) {
  rateLimit { cost remaining resetAt }
  authored: search(
    query: $authoredQuery
    type: ISSUE
    first: 100
  ) {
    nodes { ...PullRequestDashboardFields }
  }
  reviewRequested: search(
    query: $reviewRequestedQuery
    type: ISSUE
    first: 100
  ) {
    nodes { ...PullRequestDashboardFields }
  }
  reviewed: search(
    query: $reviewedQuery
    type: ISSUE
    first: 100
  ) {
    nodes { ...PullRequestDashboardFields }
  }
}

fragment PullRequestDashboardFields on PullRequest {
  id
  number
  title
  url
  state
  isDraft
  mergedAt
  updatedAt
  reviewDecision
  viewerLatestReview { state }
  viewerLatestReviewRequest { id }
  comments(first: 1) { totalCount }
  author { login }
  reviewRequests(first: 20) {
    nodes {
      requestedReviewer {
        ... on User { login }
        ... on Team { slug }
      }
    }
  }
  latestReviews(first: 20) {
    nodes { author { login } }
  }
  repository { nameWithOwner }
}
"""


def _pull_request_cutoff(window: PullRequestWindow) -> str:
    """Return the GitHub search cutoff date for a Pull Request window."""
    if window.unit == "days":
        cutoff = utc_now() - timedelta(days=window.amount)
    else:
        months = window.amount * 12 if window.unit == "years" else window.amount
        cutoff = subtract_months(utc_now(), months)
    return cutoff.date().isoformat()


def _pull_request_search_variables(window: PullRequestWindow) -> dict[str, str]:
    """Build bounded GitHub search expressions for the PR dashboard."""
    updated_filter = f"updated:>={_pull_request_cutoff(window)}"
    return {
        "authoredQuery": (f"is:pr author:@me {updated_filter} sort:updated-desc"),
        "reviewRequestedQuery": (
            f"is:pr state:open review-requested:@me {updated_filter} sort:updated-desc"
        ),
        "reviewedQuery": (f"is:pr reviewed-by:@me {updated_filter} sort:updated-desc"),
    }


def _closed_issue_since(window: ClosedIssueWindow) -> str:
    """Return an ISO timestamp suitable for GitHub's closed issue request."""
    if window.unit == "days":
        cutoff = utc_now() - timedelta(days=window.amount)
    else:
        months = window.amount * 12 if window.unit == "years" else window.amount
        cutoff = subtract_months(utc_now(), months)
    return cutoff.isoformat(timespec="seconds").replace("+00:00", "Z")


class GitHubOwnerPayload(BaseModel):
    """Represent the owner payload returned by GitHub."""

    model_config = ConfigDict(extra="ignore")

    login: str = ""
    avatar_url: str = ""


class GitHubRepositoryPayload(BaseModel):
    """Represent the repository payload returned by GitHub."""

    model_config = ConfigDict(extra="ignore")

    full_name: str
    name: str
    owner: GitHubOwnerPayload


class GitHubIssuePayload(BaseModel):
    """Represent the assigned issue payload returned by GitHub."""

    model_config = ConfigDict(extra="ignore")

    id: int
    node_id: str = ""
    number: int
    state: Literal["open", "closed"]
    title: str = ""
    body: str | None = None
    html_url: str
    created_at: str | None = None
    updated_at: str | None = None
    closed_at: str | None = None
    repository: GitHubRepositoryPayload
    pull_request: dict[str, object] | None = None


GITHUB_ISSUES_ADAPTER = TypeAdapter(list[GitHubIssuePayload])


@dataclass(frozen=True, slots=True)
class ProjectEnrichmentResult:
    """Store Projects items indexed by the issue GraphQL node ID."""

    items_by_issue_node_id: Mapping[str, tuple[GitHubProjectItem, ...]]
    warning: str | None = None
    epic_issue_node_ids: frozenset[str] = frozenset()


def _as_mapping(value: object) -> Mapping[str, object] | None:
    """Return a typed mapping for a JSON object."""
    if not isinstance(value, Mapping):
        return None
    return cast("Mapping[str, object]", value)


def _as_list(value: object) -> list[object]:
    """Return a JSON array or an empty list."""
    return cast("list[object]", value) if isinstance(value, list) else []


def _read_text(payload: Mapping[str, object], key: str) -> str:
    """Read a stripped string from a JSON object."""
    value = payload.get(key)
    return value.strip() if isinstance(value, str) else ""


def _read_int(payload: Mapping[str, object], key: str) -> int:
    """Read an integer from a JSON object."""
    value = payload.get(key)
    return value if isinstance(value, int) else 0


def _read_bool(payload: Mapping[str, object], key: str) -> bool:
    """Read a boolean from a JSON object."""
    value = payload.get(key)
    return value if isinstance(value, bool) else False


def _connection_nodes(payload: Mapping[str, object], key: str) -> list[object]:
    """Read the nodes array from a GraphQL connection."""
    connection = _as_mapping(payload.get(key))
    return _as_list(connection.get("nodes")) if connection is not None else []


def _log_graphql_rate_limit(data: Mapping[str, object], operation: str) -> None:
    """Log GraphQL cost metadata without exposing request contents."""
    rate_limit = _as_mapping(data.get("rateLimit"))
    if rate_limit is None:
        return
    LOGGER.info(
        "GitHub GraphQL %s cost=%s remaining=%s reset_at=%s",
        operation,
        _read_int(rate_limit, "cost"),
        _read_int(rate_limit, "remaining"),
        _read_text(rate_limit, "resetAt"),
    )


def _iteration_values(payload: Mapping[str, object]) -> tuple[str, ...]:
    return (_read_text(payload, "title"),)


def _single_select_values(payload: Mapping[str, object]) -> tuple[str, ...]:
    return (_read_text(payload, "name"),)


FieldValueExtractor = Callable[[Mapping[str, object]], tuple[str, ...]]
PROJECT_FIELD_EXTRACTORS: Mapping[
    str,
    tuple[ProjectFieldKind, FieldValueExtractor],
] = {
    "ProjectV2ItemFieldIterationValue": ("iteration", _iteration_values),
    "ProjectV2ItemFieldSingleSelectValue": (
        "single_select",
        _single_select_values,
    ),
}


def _pull_request_from_node(
    payload: Mapping[str, object],
    viewer_role: PullRequestViewerRole | None = None,
) -> GitHubPullRequest | None:
    """Normalize the Pull Request fields used by Projects and the PR dashboard."""
    repository = _as_mapping(payload.get("repository"))
    author = _as_mapping(payload.get("author"))
    node_id = _read_text(payload, "id")
    repository_full_name = _read_text(repository, "nameWithOwner") if repository else ""
    number = _read_int(payload, "number")
    title = _read_text(payload, "title")
    html_url = _read_text(payload, "url")
    if not node_id or not repository_full_name or not number or not html_url:
        return None

    raw_state = _read_text(payload, "state").lower()
    merged_at = normalize_utc_iso(_read_text(payload, "mergedAt") or None)
    state = "merged" if raw_state == "merged" or merged_at else raw_state
    if state not in {"open", "closed", "merged"}:
        state = "open"

    raw_review_decision = _read_text(payload, "reviewDecision").lower()
    review_decision = (
        cast("PullRequestReviewDecision", raw_review_decision)
        if raw_review_decision in {"approved", "changes_requested", "review_required"}
        else None
    )
    latest_review = _as_mapping(payload.get("viewerLatestReview"))
    latest_review_request = _as_mapping(payload.get("viewerLatestReviewRequest"))
    comments = _as_mapping(payload.get("comments"))
    reviewer_logins: list[str] = []
    seen_reviewers: set[str] = set()
    for raw_review_request in _connection_nodes(payload, "reviewRequests"):
        review_request = _as_mapping(raw_review_request)
        requested_reviewer = (
            _as_mapping(review_request.get("requestedReviewer"))
            if review_request
            else None
        )
        if requested_reviewer is None:
            continue
        reviewer_login = _read_text(requested_reviewer, "login") or _read_text(
            requested_reviewer,
            "slug",
        )
        if reviewer_login and reviewer_login not in seen_reviewers:
            seen_reviewers.add(reviewer_login)
            reviewer_logins.append(reviewer_login)
    for raw_review in _connection_nodes(payload, "latestReviews"):
        review = _as_mapping(raw_review)
        review_author = _as_mapping(review.get("author")) if review else None
        reviewer_login = _read_text(review_author, "login") if review_author else ""
        if reviewer_login and reviewer_login not in seen_reviewers:
            seen_reviewers.add(reviewer_login)
            reviewer_logins.append(reviewer_login)

    return GitHubPullRequest(
        node_id=node_id,
        repository_full_name=repository_full_name,
        number=number,
        title=title,
        html_url=html_url,
        state=cast("Literal['open', 'closed', 'merged']", state),
        is_draft=_read_bool(payload, "isDraft"),
        author_login=_read_text(author, "login") if author else "",
        updated_at=normalize_utc_iso(_read_text(payload, "updatedAt") or None),
        reviewer_logins=tuple(reviewer_logins),
        merged_at=merged_at,
        review_decision=review_decision,
        viewer_review_state=(
            _read_text(latest_review, "state").lower() if latest_review else None
        ),
        review_requested_from_viewer=latest_review_request is not None,
        viewer_role=viewer_role,
        comments_count=_read_int(comments, "totalCount") if comments else 0,
    )


def _linked_pull_requests_from_field(
    payload: Mapping[str, object],
) -> tuple[GitHubPullRequest, ...]:
    """Return the Pull Requests stored in a Projects Linked pull requests field."""
    linked_pull_requests: list[GitHubPullRequest] = []
    for raw_pull_request in _connection_nodes(payload, "pullRequests"):
        pull_request_payload = _as_mapping(raw_pull_request)
        if pull_request_payload is None:
            continue
        pull_request = _pull_request_from_node(pull_request_payload)
        if pull_request is not None:
            linked_pull_requests.append(pull_request)
    return tuple(linked_pull_requests)


def _field_values_from_node(
    payload: Mapping[str, object],
) -> tuple[GitHubProjectFieldValue, ...]:
    """Normalize one Projects field value node into filterable strings."""
    field = _as_mapping(payload.get("field"))
    if field is None:
        return ()

    field_id = _read_text(field, "id")
    field_name = _read_text(field, "name")
    typename = _read_text(payload, "__typename")
    if (
        not field_id
        or not field_name
        or not typename
        or field_name.casefold() not in PROJECT_FILTER_FIELD_NAMES
    ):
        return ()

    extractor = PROJECT_FIELD_EXTRACTORS.get(typename)
    if extractor is None:
        return ()
    kind, extract_values = extractor
    values = extract_values(payload)

    return tuple(
        GitHubProjectFieldValue(
            field_id=field_id,
            field_name=field_name,
            kind=kind,
            value=value,
        )
        for value in values
        if value
    )


def _project_item_from_node(payload: Mapping[str, object]) -> GitHubProjectItem | None:
    """Normalize one GraphQL ProjectV2Item node."""
    project = _as_mapping(payload.get("project"))
    if project is None:
        return None

    project_id = _read_text(project, "id")
    project_title = _read_text(project, "title")
    if not project_id or not project_title:
        return None

    fields: list[GitHubProjectFieldValue] = []
    linked_pull_requests: list[GitHubPullRequest] = []
    for raw_field_value in _connection_nodes(payload, "fieldValues"):
        field_value = _as_mapping(raw_field_value)
        if field_value is not None:
            fields.extend(_field_values_from_node(field_value))
            if (
                _read_text(field_value, "__typename")
                == "ProjectV2ItemFieldPullRequestValue"
            ):
                linked_pull_requests.extend(
                    _linked_pull_requests_from_field(field_value),
                )

    return GitHubProjectItem(
        project_id=project_id,
        project_number=_read_int(project, "number"),
        project_title=project_title,
        project_url=_read_text(project, "url"),
        fields=tuple(fields),
        linked_pull_requests=tuple(linked_pull_requests),
    )


def _parse_project_items_by_issue(
    data: Mapping[str, object],
) -> ProjectEnrichmentResult:
    """Parse the issue nodes returned by one GraphQL batch."""
    parsed_items: dict[str, tuple[GitHubProjectItem, ...]] = {}
    epic_issue_node_ids: set[str] = set()
    for raw_issue_node in _as_list(data.get("nodes")):
        issue_node = _as_mapping(raw_issue_node)
        if issue_node is None:
            continue
        issue_node_id = _read_text(issue_node, "id")
        if not issue_node_id:
            continue
        issue_type = _as_mapping(issue_node.get("issueType"))
        if (
            issue_type is not None
            and _read_text(issue_type, "name").casefold() == "epic"
        ):
            epic_issue_node_ids.add(issue_node_id)

        project_items: list[GitHubProjectItem] = []
        for raw_project_item in _connection_nodes(issue_node, "projectItems"):
            project_item = _as_mapping(raw_project_item)
            if project_item is None:
                continue
            normalized_item = _project_item_from_node(project_item)
            if normalized_item is not None:
                project_items.append(normalized_item)
        parsed_items[issue_node_id] = tuple(project_items)

    return ProjectEnrichmentResult(
        parsed_items,
        epic_issue_node_ids=frozenset(epic_issue_node_ids),
    )


def _fetch_project_batch(
    client: httpx.Client,
    issue_node_ids: tuple[str, ...],
) -> ProjectEnrichmentResult:
    """Fetch and parse one GraphQL batch of Projects metadata."""
    try:
        response = client.post(
            "/graphql",
            json={
                "query": ISSUE_PROJECT_FIELDS_QUERY,
                "variables": {"ids": list(issue_node_ids)},
            },
        )
        if response.status_code in {
            httpx.codes.FORBIDDEN,
            httpx.codes.UNAUTHORIZED,
        }:
            if response.headers.get("x-ratelimit-remaining") == "0":
                return ProjectEnrichmentResult({}, PROJECT_RATE_LIMIT_WARNING)
            return ProjectEnrichmentResult({}, PROJECT_FIELDS_WARNING)
        response.raise_for_status()
        payload = _as_mapping(response.json())
    except (httpx.HTTPError, ValueError) as error:
        LOGGER.warning("GitHub Projects enrichment failed: %s", error)
        return ProjectEnrichmentResult({}, PROJECT_FIELDS_WARNING)

    if payload is None:
        return ProjectEnrichmentResult({}, PROJECT_FIELDS_WARNING)

    graphql_errors = _as_list(payload.get("errors"))
    if graphql_errors:
        LOGGER.warning("GitHub Projects GraphQL errors: %s", graphql_errors)
    is_rate_limited = any(
        (error_payload := _as_mapping(error)) is not None
        and _read_text(error_payload, "type") == "RATE_LIMITED"
        for error in graphql_errors
    )
    warning = (
        PROJECT_RATE_LIMIT_WARNING
        if is_rate_limited
        else PROJECT_FIELDS_WARNING
        if graphql_errors
        else None
    )
    data = _as_mapping(payload.get("data"))
    if data is None:
        return ProjectEnrichmentResult({}, warning or PROJECT_FIELDS_WARNING)

    _log_graphql_rate_limit(data, "issue-project-fields")

    parsed_enrichment = _parse_project_items_by_issue(data)
    return replace(parsed_enrichment, warning=warning)


def _parse_pull_request_dashboard(
    data: Mapping[str, object],
) -> tuple[GitHubPullRequest, ...]:
    """Merge authored, requested and already-reviewed Pull Requests."""
    pull_requests_by_id: dict[str, GitHubPullRequest] = {}

    def add_connection(
        connection_name: str,
        viewer_role: PullRequestViewerRole,
        *,
        replace_existing: bool = False,
    ) -> None:
        for raw_pull_request in _connection_nodes(data, connection_name):
            pull_request_payload = _as_mapping(raw_pull_request)
            if pull_request_payload is None:
                continue
            pull_request = _pull_request_from_node(
                pull_request_payload,
                viewer_role,
            )
            if pull_request is None:
                continue
            if replace_existing or pull_request.node_id not in pull_requests_by_id:
                pull_requests_by_id[pull_request.node_id] = pull_request

    add_connection("authored", "authored")
    add_connection("reviewed", "reviewed")
    add_connection("reviewRequested", "review_requested", replace_existing=True)

    return tuple(
        sorted(
            pull_requests_by_id.values(),
            key=lambda pull_request: pull_request.updated_at or "",
            reverse=True,
        ),
    )


class GitHubAssignedIssuesClient:
    """Read assigned issues and their Projects metadata for the active user."""

    def __init__(
        self,
        settings: AppSettings,
        token_provider: Callable[[], str] | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        """Store the settings and optional HTTP transport."""
        self._settings = settings
        self._token_provider = token_provider
        self._transport = transport
        self._cache_token = ""
        self._project_cache_issue_ids: tuple[str, ...] = ()
        self._project_cache_result: ProjectEnrichmentResult | None = None
        self._project_cache_expires_at = 0.0
        self._pull_request_cache: PullRequestFetchResult | None = None
        self._pull_request_cache_window: PullRequestWindow | None = None
        self._pull_request_cache_expires_at = 0.0
        self._client: httpx.Client | None = None
        self._client_token = ""
        self._issue_page_cache: dict[
            tuple[str, str | None, int],
            tuple[str, tuple[GitHubIssuePayload, ...]],
        ] = {}

    def can_refresh(self) -> bool:
        """Return whether the configured token can refresh GitHub data."""
        return bool(self._resolve_token())

    def fetch_assigned_issues(
        self,
        closed_window: ClosedIssueWindow | None = None,
    ) -> AssignedIssuesFetchResult:
        """Fetch assigned issues, then enrich them with Projects fields."""
        github_token = self._resolve_token()
        if not github_token:
            return AssignedIssuesFetchResult(issues=())
        self._reset_caches_for_new_token(github_token)

        collected_payloads: list[GitHubIssuePayload] = []
        client = self._get_client(github_token)
        request_ranges: tuple[tuple[Literal["open", "closed", "all"], str | None], ...]
        if closed_window is None:
            request_ranges = (("all", None),)
        else:
            request_ranges = (
                ("open", None),
                ("closed", _closed_issue_since(closed_window)),
            )

        for remote_state, since in request_ranges:
            for page in range(1, self._settings.github_max_pages + 1):
                raw_issues = self._fetch_page(
                    client=client,
                    page=page,
                    remote_state=remote_state,
                    since=since,
                )
                collected_payloads.extend(
                    issue for issue in raw_issues if issue.pull_request is None
                )
                if len(raw_issues) < ISSUES_PAGE_SIZE:
                    break

        enrichment = self._fetch_project_items(
            client,
            tuple(issue.node_id for issue in collected_payloads if issue.node_id),
        )

        issues = tuple(
            replace(
                self._to_domain(issue_payload),
                project_items=enrichment.items_by_issue_node_id.get(
                    issue_payload.node_id,
                    (),
                ),
            )
            for issue_payload in collected_payloads
            if issue_payload.node_id not in enrichment.epic_issue_node_ids
        )
        return AssignedIssuesFetchResult(
            issues=issues,
            project_fields_warning=enrichment.warning,
        )

    def fetch_pull_requests(  # noqa: PLR0911
        self,
        window: PullRequestWindow | None = None,
        *,
        force: bool = False,
    ) -> PullRequestFetchResult:
        """Fetch the current user's authored and requested Pull Requests."""
        resolved_window = window or PullRequestWindow(amount=1, unit="months")
        github_token = self._resolve_token()
        if not github_token:
            return PullRequestFetchResult(())
        self._reset_caches_for_new_token(github_token)

        if (
            not force
            and self._pull_request_cache is not None
            and self._pull_request_cache_window == resolved_window
            and monotonic() < self._pull_request_cache_expires_at
        ):
            return self._pull_request_cache

        try:
            client = self._get_client(github_token)
            response = client.post(
                "/graphql",
                json={
                    "query": PULL_REQUEST_DASHBOARD_QUERY,
                    "variables": _pull_request_search_variables(
                        resolved_window,
                    ),
                },
            )
            if response.status_code == httpx.codes.UNAUTHORIZED:
                self._raise_authentication_error(response)
            if response.status_code == httpx.codes.FORBIDDEN:
                return PullRequestFetchResult((), PULL_REQUESTS_WARNING)
            response.raise_for_status()
            payload = _as_mapping(response.json())
        except GitHubAuthenticationError:
            raise
        except (httpx.HTTPError, ValueError) as error:
            LOGGER.warning("GitHub Pull Request refresh failed: %s", error)
            return PullRequestFetchResult((), PULL_REQUESTS_WARNING)

        if payload is None or _as_list(payload.get("errors")):
            return PullRequestFetchResult((), PULL_REQUESTS_WARNING)
        data = _as_mapping(payload.get("data"))
        if data is None:
            return PullRequestFetchResult((), PULL_REQUESTS_WARNING)

        _log_graphql_rate_limit(data, "pull-request-dashboard")

        result = PullRequestFetchResult(_parse_pull_request_dashboard(data))
        self._pull_request_cache = result
        self._pull_request_cache_window = resolved_window
        self._pull_request_cache_expires_at = (
            monotonic() + PULL_REQUEST_CACHE_TTL_SECONDS
        )
        return result

    def _fetch_page(
        self,
        client: httpx.Client,
        page: int,
        remote_state: Literal["open", "closed", "all"],
        since: str | None,
    ) -> tuple[GitHubIssuePayload, ...]:
        """Fetch and validate one GitHub assigned-issues page."""
        params: dict[str, int | str] = {
            "direction": "desc",
            "filter": "assigned",
            "page": page,
            "per_page": ISSUES_PAGE_SIZE,
            "sort": "updated",
            "state": remote_state,
        }
        if since is not None:
            params["since"] = since
        cache_key = (remote_state, since, page)
        cached_page = self._issue_page_cache.get(cache_key)
        conditional_headers = {"If-None-Match": cached_page[0]} if cached_page else None
        response = client.get(
            "/issues",
            headers=conditional_headers,
            params=params,
        )
        if response.status_code == httpx.codes.NOT_MODIFIED and cached_page:
            return cached_page[1]
        if response.status_code in {
            httpx.codes.FORBIDDEN,
            httpx.codes.UNAUTHORIZED,
        }:
            raise GitHubAuthenticationError(
                message=self._build_auth_error_message(response),
                status_code=response.status_code,
            )

        response.raise_for_status()
        payload = tuple(GITHUB_ISSUES_ADAPTER.validate_python(response.json()))
        etag = response.headers.get("etag")
        if etag:
            self._issue_page_cache[cache_key] = (etag, payload)
        return payload

    def _fetch_project_items(
        self,
        client: httpx.Client,
        issue_node_ids: tuple[str, ...],
    ) -> ProjectEnrichmentResult:
        """Fetch Projects items for issues in bounded GraphQL batches."""
        if (
            self._project_cache_result is not None
            and issue_node_ids == self._project_cache_issue_ids
            and monotonic() < self._project_cache_expires_at
        ):
            return self._project_cache_result

        items_by_issue: dict[str, tuple[GitHubProjectItem, ...]] = {}
        epic_issue_node_ids: set[str] = set()
        warning: str | None = None

        for offset in range(0, len(issue_node_ids), PROJECT_QUERY_BATCH_SIZE):
            batch = issue_node_ids[offset : offset + PROJECT_QUERY_BATCH_SIZE]
            batch_result = _fetch_project_batch(client, batch)
            items_by_issue.update(batch_result.items_by_issue_node_id)
            epic_issue_node_ids.update(batch_result.epic_issue_node_ids)
            warning = batch_result.warning
            if warning:
                break

        result = ProjectEnrichmentResult(
            items_by_issue,
            warning,
            frozenset(epic_issue_node_ids),
        )
        if warning is None:
            self._project_cache_issue_ids = issue_node_ids
            self._project_cache_result = result
            self._project_cache_expires_at = monotonic() + PROJECT_CACHE_TTL_SECONDS
        return result

    def _reset_caches_for_new_token(self, github_token: str) -> None:
        """Avoid carrying data across local GitHub session changes."""
        if self._cache_token == github_token:
            return
        self._cache_token = github_token
        self._project_cache_issue_ids = ()
        self._project_cache_result = None
        self._project_cache_expires_at = 0.0
        self._pull_request_cache = None
        self._pull_request_cache_window = None
        self._pull_request_cache_expires_at = 0.0
        self._issue_page_cache = {}
        if self._client is not None:
            self._client.close()
            self._client = None
        self._client_token = ""

    def _get_client(self, github_token: str) -> httpx.Client:
        """Return one connection-pooled GitHub client for the active token."""
        if self._client is not None and self._client_token == github_token:
            return self._client
        if self._client is not None:
            self._client.close()
        self._client = httpx.Client(
            base_url=self._settings.github_api_base_url,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {github_token}",
                "User-Agent": "github-issues-dashboard-v3",
            },
            timeout=self._settings.github_request_timeout_seconds,
            transport=self._transport,
        )
        self._client_token = github_token
        return self._client

    def close(self) -> None:
        """Close pooled network resources during application shutdown."""
        if self._client is not None:
            self._client.close()
            self._client = None
        self._client_token = ""

    def _resolve_token(self) -> str:
        """Return the active GitHub token for the current runtime."""
        if self._token_provider is None:
            return self._settings.github_token.strip()

        return self._token_provider().strip()

    @staticmethod
    def _raise_authentication_error(response: httpx.Response) -> None:
        """Raise the typed authentication error used by API routes."""
        raise GitHubAuthenticationError(
            GitHubAssignedIssuesClient._build_auth_error_message(response),
            response.status_code,
        )

    @staticmethod
    def _build_auth_error_message(response: httpx.Response) -> str:
        """Return a human-friendly GitHub authentication error message."""
        default_message = (
            "GitHub no ha aceptado las credenciales configuradas. "
            "Revisa el usuario y el token."
        )

        try:
            payload = response.json()
        except ValueError:
            return default_message

        if not isinstance(payload, dict):
            return default_message

        raw_message = payload.get("message")
        if not isinstance(raw_message, str) or not raw_message.strip():
            return default_message

        return f"{default_message} GitHub respondió: {raw_message.strip()}."

    @staticmethod
    def _to_domain(issue_payload: GitHubIssuePayload) -> GitHubAssignedIssue:
        """Map a validated GitHub payload into a domain issue."""
        repository = issue_payload.repository
        return GitHubAssignedIssue(
            github_id=issue_payload.id,
            repository_full_name=repository.full_name,
            repository_name=repository.name,
            repository_owner_login=repository.owner.login,
            repository_owner_avatar_url=repository.owner.avatar_url,
            issue_number=issue_payload.number,
            remote_state=issue_payload.state,
            title=issue_payload.title,
            body_markdown=issue_payload.body or "",
            html_url=issue_payload.html_url,
            created_at=normalize_utc_iso(issue_payload.created_at),
            updated_at=normalize_utc_iso(issue_payload.updated_at),
            closed_at=normalize_utc_iso(issue_payload.closed_at),
        )


__all__ = ["GitHubAssignedIssuesClient"]
