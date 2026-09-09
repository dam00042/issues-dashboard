"""Test GitHub issue and Projects metadata retrieval."""

from __future__ import annotations

import json
from unittest import TestCase

import httpx

from dashboard_api.github.client import GitHubAssignedIssuesClient
from dashboard_api.issues.models import ClosedIssueWindow
from dashboard_api.settings import AppSettings

HTTP_OK = 200
HTTP_FORBIDDEN = 403
LINKED_PULL_REQUEST_NUMBER = 9
REQUESTED_PULL_REQUEST_NUMBER = 2
SECOND_REQUEST_COUNT = 2


def _provide_test_token() -> str:
    """Return a non-secret token for the mocked GitHub transport."""
    return f"ghp_mocked_{HTTP_OK}"


def _assigned_issue_payload() -> list[dict[str, object]]:
    """Build one assigned issue as returned by GitHub REST."""
    return [
        {
            "body": "Issue body",
            "closed_at": None,
            "created_at": "2026-08-01T10:00:00Z",
            "html_url": "https://github.com/example/repo/issues/42",
            "id": 42,
            "node_id": "ISSUE_NODE_42",
            "number": 42,
            "repository": {
                "full_name": "example/repo",
                "name": "repo",
                "owner": {
                    "avatar_url": "https://example.test/avatar",
                    "login": "example",
                },
            },
            "state": "open",
            "title": "Project metadata",
            "updated_at": "2026-08-02T10:00:00Z",
        },
    ]


def _project_graphql_payload() -> dict[str, object]:
    """Build the relevant subset of one GitHub GraphQL response."""
    return {
        "data": {
            "nodes": [
                {
                    "id": "ISSUE_NODE_42",
                    "issueType": {"name": "Task"},
                    "projectItems": {
                        "nodes": [
                            {
                                "fieldValues": {
                                    "nodes": [
                                        {
                                            "__typename": (
                                                "ProjectV2ItemFieldSingleSelectValue"
                                            ),
                                            "field": {"id": "STATUS", "name": "Status"},
                                            "name": "In Review",
                                        },
                                        {
                                            "__typename": (
                                                "ProjectV2ItemFieldIterationValue"
                                            ),
                                            "field": {"id": "SPRINT", "name": "Sprint"},
                                            "title": "Sprint 8",
                                        },
                                        {
                                            "__typename": (
                                                "ProjectV2ItemFieldSingleSelectValue"
                                            ),
                                            "field": {
                                                "id": "PRIORITY",
                                                "name": "Priority",
                                            },
                                            "name": "High",
                                        },
                                        {
                                            "__typename": (
                                                "ProjectV2ItemFieldPullRequestValue"
                                            ),
                                            "pullRequests": {
                                                "nodes": [
                                                    {
                                                        "author": {"login": "octocat"},
                                                        "id": "PR_NODE_9",
                                                        "isDraft": False,
                                                        "mergedAt": None,
                                                        "number": 9,
                                                        "repository": {
                                                            "nameWithOwner": (
                                                                "example/repo"
                                                            )
                                                        },
                                                        "state": "OPEN",
                                                        "title": "Ship metadata",
                                                        "updatedAt": (
                                                            "2026-08-03T10:00:00Z"
                                                        ),
                                                        "url": (
                                                            "https://github.com/"
                                                            "example/repo/pull/9"
                                                        ),
                                                    }
                                                ]
                                            },
                                        },
                                    ],
                                },
                                "project": {
                                    "id": "PROJECT_3",
                                    "number": 3,
                                    "title": "Roadmap",
                                    "url": "https://github.com/orgs/example/projects/3",
                                },
                            },
                        ],
                    },
                },
            ],
        },
    }


class GitHubAssignedIssuesClientTests(TestCase):
    """Verify REST issues are enriched through GitHub GraphQL."""

    def test_bounds_closed_issue_requests_to_the_selected_window(self) -> None:
        """Avoid downloading closed history that the dashboard will not show."""
        request_params: list[dict[str, str]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            request_params.append(dict(request.url.params))
            return httpx.Response(HTTP_OK, json=[], request=request)

        client = GitHubAssignedIssuesClient(
            AppSettings(),
            token_provider=_provide_test_token,
            transport=httpx.MockTransport(handler),
        )
        client.fetch_assigned_issues(ClosedIssueWindow(amount=1, unit="months"))

        if [params["state"] for params in request_params] != ["open", "closed"]:
            message = "Expected separate open and bounded closed issue requests."
            raise AssertionError(message)
        if "since" in request_params[0] or not request_params[1].get("since"):
            message = "Expected only the closed request to include a cutoff."
            raise AssertionError(message)

    def test_reuses_rest_issue_page_when_github_returns_not_modified(self) -> None:
        """Use ETags to avoid downloading and reparsing an unchanged issue page."""
        issue_requests: list[httpx.Request] = []
        graphql_requests = 0

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal graphql_requests
            if request.url.path == "/issues":
                issue_requests.append(request)
                if len(issue_requests) == SECOND_REQUEST_COUNT:
                    return httpx.Response(
                        httpx.codes.NOT_MODIFIED,
                        request=request,
                    )
                return httpx.Response(
                    HTTP_OK,
                    headers={"ETag": '"issues-v1"'},
                    json=_assigned_issue_payload(),
                    request=request,
                )
            if request.url.path == "/graphql":
                graphql_requests += 1
                return httpx.Response(
                    HTTP_OK,
                    json=_project_graphql_payload(),
                    request=request,
                )
            message = f"Unexpected GitHub path: {request.url.path}"
            raise AssertionError(message)

        client = GitHubAssignedIssuesClient(
            AppSettings(),
            token_provider=_provide_test_token,
            transport=httpx.MockTransport(handler),
        )

        first_result = client.fetch_assigned_issues()
        second_result = client.fetch_assigned_issues()

        if len(first_result.issues) != 1 or len(second_result.issues) != 1:
            message = "Expected the cached REST page to preserve its issue."
            raise AssertionError(message)
        if issue_requests[1].headers.get("if-none-match") != '"issues-v1"':
            message = "Expected the second REST request to send the cached ETag."
            raise AssertionError(message)
        if graphql_requests != 1:
            message = "Expected unchanged Projects metadata to use its TTL cache."
            raise AssertionError(message)

    def test_fetches_project_status_sprint_and_priority(self) -> None:
        """Normalize the Projects fields needed by the dashboard filters."""

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/issues":
                return httpx.Response(
                    HTTP_OK,
                    json=_assigned_issue_payload(),
                    request=request,
                )
            if request.url.path == "/graphql":
                return httpx.Response(
                    HTTP_OK,
                    json=_project_graphql_payload(),
                    request=request,
                )
            message = f"Unexpected GitHub path: {request.url.path}"
            raise AssertionError(message)

        client = GitHubAssignedIssuesClient(
            AppSettings(),
            token_provider=_provide_test_token,
            transport=httpx.MockTransport(handler),
        )

        result = client.fetch_assigned_issues()
        if result.project_fields_warning is not None:
            message = "Expected Projects enrichment to complete without a warning."
            raise AssertionError(message)
        if len(result.issues) != 1:
            message = "Expected the assigned issue to be returned."
            raise AssertionError(message)

        project_item = result.issues[0].project_items[0]
        returned_fields = {
            field.field_name: field.value for field in project_item.fields
        }
        expected_fields = {
            "Priority": "High",
            "Sprint": "Sprint 8",
            "Status": "In Review",
        }
        if project_item.project_title != "Roadmap":
            message = "Expected the GitHub Project title to be normalized."
            raise AssertionError(message)
        if returned_fields != expected_fields:
            message = "Expected Status, Sprint and Priority project values."
            raise AssertionError(message)
        linked_pull_requests = project_item.linked_pull_requests
        if (
            len(linked_pull_requests) != 1
            or linked_pull_requests[0].number != LINKED_PULL_REQUEST_NUMBER
        ):
            message = "Expected the Linked pull requests field to be normalized."
            raise AssertionError(message)

    def test_excludes_epics_using_the_github_issue_type(self) -> None:
        """Keep parent Epics out of the issue dashboard."""
        task_payload = _assigned_issue_payload()[0]
        epic_payload = {
            **task_payload,
            "html_url": "https://github.com/example/repo/issues/1154",
            "id": 1154,
            "node_id": "ISSUE_NODE_EPIC",
            "number": 1154,
            "title": "Parent Epic",
        }

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/issues":
                return httpx.Response(
                    HTTP_OK,
                    json=[task_payload, epic_payload],
                    request=request,
                )
            if request.url.path == "/graphql":
                return httpx.Response(
                    HTTP_OK,
                    json={
                        "data": {
                            "nodes": [
                                {
                                    "id": "ISSUE_NODE_42",
                                    "issueType": {"name": "Task"},
                                    "projectItems": {"nodes": []},
                                },
                                {
                                    "id": "ISSUE_NODE_EPIC",
                                    "issueType": {"name": "Epic"},
                                    "projectItems": {"nodes": []},
                                },
                            ]
                        }
                    },
                    request=request,
                )
            message = f"Unexpected GitHub path: {request.url.path}"
            raise AssertionError(message)

        client = GitHubAssignedIssuesClient(
            AppSettings(),
            token_provider=_provide_test_token,
            transport=httpx.MockTransport(handler),
        )

        result = client.fetch_assigned_issues()

        if [issue.issue_number for issue in result.issues] != [42]:
            message = "Expected Epic issues to be excluded from the dashboard."
            raise AssertionError(message)

    def test_fetches_pull_request_dashboard_on_demand(self) -> None:
        """Classify authored and requested Pull Requests without refreshing issues."""

        def pull_request_node(node_id: str, number: int) -> dict[str, object]:
            return {
                "author": {"login": "octocat"},
                "comments": {"totalCount": 2},
                "id": node_id,
                "isDraft": False,
                "mergedAt": None,
                "number": number,
                "repository": {"nameWithOwner": "example/repo"},
                "reviewDecision": "REVIEW_REQUIRED",
                "reviewRequests": {
                    "nodes": [
                        {"requestedReviewer": {"login": "pending-reviewer"}},
                    ],
                },
                "latestReviews": {
                    "nodes": [{"author": {"login": "previous-reviewer"}}],
                },
                "state": "OPEN",
                "title": f"Pull Request {number}",
                "updatedAt": "2026-08-03T10:00:00Z",
                "url": f"https://github.com/example/repo/pull/{number}",
                "viewerDidAuthor": number == 1,
                "viewerLatestReview": None,
                "viewerLatestReviewRequest": (
                    {"id": "REQUEST_2"}
                    if number == REQUESTED_PULL_REQUEST_NUMBER
                    else None
                ),
            }

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path != "/graphql":
                message = f"Unexpected GitHub path: {request.url.path}"
                raise AssertionError(message)
            request_payload = json.loads(request.content)
            search_variables = request_payload.get("variables", {})
            if not all(
                "updated:>=" in str(search_query)
                for search_query in search_variables.values()
            ):
                message = "Expected every Pull Request query to have a date cutoff."
                raise AssertionError(message)
            return httpx.Response(
                HTTP_OK,
                json={
                    "data": {
                        "authored": {"nodes": [pull_request_node("PR_1", 1)]},
                        "reviewRequested": {"nodes": [pull_request_node("PR_2", 2)]},
                        "reviewed": {"nodes": []},
                    }
                },
                request=request,
            )

        client = GitHubAssignedIssuesClient(
            AppSettings(),
            token_provider=_provide_test_token,
            transport=httpx.MockTransport(handler),
        )
        dashboard = client.fetch_pull_requests()

        roles_by_number = {
            pull_request.number: pull_request.viewer_role
            for pull_request in dashboard.pull_requests
        }
        if roles_by_number != {1: "authored", 2: "review_requested"}:
            message = "Expected authored and review-requested PR classifications."
            raise AssertionError(message)
        authored_pull_request = next(
            pull_request
            for pull_request in dashboard.pull_requests
            if pull_request.number == 1
        )
        if authored_pull_request.reviewer_logins != (
            "pending-reviewer",
            "previous-reviewer",
        ):
            message = "Expected current and previous reviewers to be normalized."
            raise AssertionError(message)

    def test_preserves_issues_when_projects_permission_is_missing(self) -> None:
        """Keep REST issue data and report the missing Projects permission."""

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/issues":
                return httpx.Response(
                    HTTP_OK,
                    json=_assigned_issue_payload(),
                    request=request,
                )
            return httpx.Response(
                HTTP_FORBIDDEN,
                json={"message": "Resource not accessible"},
                request=request,
            )

        client = GitHubAssignedIssuesClient(
            AppSettings(),
            token_provider=_provide_test_token,
            transport=httpx.MockTransport(handler),
        )

        result = client.fetch_assigned_issues()
        if len(result.issues) != 1:
            message = "Expected issue retrieval to survive Projects denial."
            raise AssertionError(message)
        if not result.project_fields_warning:
            message = "Expected a warning that explains the Projects permission."
            raise AssertionError(message)

    def test_reports_projects_rate_limit_without_claiming_missing_permission(
        self,
    ) -> None:
        """Explain GraphQL exhaustion as temporary while preserving REST issues."""

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/issues":
                return httpx.Response(
                    HTTP_OK,
                    json=_assigned_issue_payload(),
                    request=request,
                )
            return httpx.Response(
                HTTP_OK,
                json={
                    "data": {"nodes": None},
                    "errors": [
                        {
                            "message": "API rate limit exceeded",
                            "type": "RATE_LIMITED",
                        }
                    ],
                },
                request=request,
            )

        client = GitHubAssignedIssuesClient(
            AppSettings(),
            token_provider=_provide_test_token,
            transport=httpx.MockTransport(handler),
        )

        result = client.fetch_assigned_issues()
        warning = result.project_fields_warning or ""
        if len(result.issues) != 1:
            message = "Expected issue retrieval to survive the GraphQL rate limit."
            raise AssertionError(message)
        if "temporalmente" not in warning or "permiso" in warning:
            message = (
                "Expected a temporary rate-limit warning, not a permission warning."
            )
            raise AssertionError(message)

    def test_batches_project_queries_below_github_node_limit(self) -> None:
        """Keep nested Projects queries within GitHub's node cost limit."""
        issue_count = 21
        base_issue = _assigned_issue_payload()[0]
        assigned_issues = [
            {
                **base_issue,
                "html_url": f"https://github.com/example/repo/issues/{number}",
                "id": number,
                "node_id": f"ISSUE_NODE_{number}",
                "number": number,
            }
            for number in range(1, issue_count + 1)
        ]
        graphql_batch_sizes: list[int] = []

        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == "/issues":
                return httpx.Response(HTTP_OK, json=assigned_issues, request=request)
            if request.url.path == "/graphql":
                request_payload = json.loads(request.content)
                query = request_payload["query"]
                for unnecessary_type in (
                    "ProjectV2ItemFieldLabelValue",
                    "ProjectV2ItemFieldReviewerValue",
                    "ProjectV2ItemFieldUserValue",
                ):
                    if unnecessary_type in query:
                        message = "Expected the Projects query to omit unused fields."
                        raise AssertionError(message)
                node_ids = request_payload["variables"]["ids"]
                graphql_batch_sizes.append(len(node_ids))
                return httpx.Response(
                    HTTP_OK,
                    json={
                        "data": {
                            "nodes": [
                                {
                                    "id": node_id,
                                    "projectItems": {"nodes": []},
                                }
                                for node_id in node_ids
                            ]
                        }
                    },
                    request=request,
                )
            message = f"Unexpected GitHub path: {request.url.path}"
            raise AssertionError(message)

        client = GitHubAssignedIssuesClient(
            AppSettings(),
            token_provider=_provide_test_token,
            transport=httpx.MockTransport(handler),
        )

        result = client.fetch_assigned_issues()
        cached_result = client.fetch_assigned_issues()

        if len(result.issues) != issue_count:
            message = "Expected all assigned issues to survive Projects batching."
            raise AssertionError(message)
        if len(cached_result.issues) != issue_count:
            message = "Expected the cached Projects refresh to preserve every issue."
            raise AssertionError(message)
        if graphql_batch_sizes != [issue_count]:
            message = (
                "Expected one safe batch followed by the in-memory Projects cache."
            )
            raise AssertionError(message)
