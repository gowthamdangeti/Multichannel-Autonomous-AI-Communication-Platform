"""Docker container monitor — reads DOCKER_HOSTS from env and returns
per-instance container stats filtered to this app's compose project.

DOCKER_HOSTS format: "label|url|compose_project,label|url|compose_project"
  - label           : display name shown in the UI
  - url             : Docker host URL (tcp://host:2375 or unix:///var/run/docker.sock)
  - compose_project : (optional) filter to containers in this compose project;
                      defaults to DOCKER_COMPOSE_PROJECTS env var

Examples:
  prod|tcp://host.docker.internal:2375|convozent,dev|tcp://host.docker.internal:2375|convozent-dev
  local|unix:///var/run/docker.sock|myapp
"""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError
from typing import Any

import docker
import docker.errors

_STATS_TIMEOUT_S = 8  # per-container stats timeout (seconds)


_DOCKER_HOSTS_RAW = os.getenv("DOCKER_HOSTS", "")
_DEFAULT_COMPOSE_PROJECT = os.getenv("DOCKER_COMPOSE_PROJECTS", "convozent")


def _parse_hosts() -> list[dict[str, str]]:
    if not _DOCKER_HOSTS_RAW.strip():
        return []
    hosts = []
    for entry in _DOCKER_HOSTS_RAW.split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = [p.strip() for p in entry.split("|")]
        if len(parts) < 2:
            continue
        label = parts[0]
        url = parts[1]
        compose_project = parts[2] if len(parts) >= 3 else _DEFAULT_COMPOSE_PROJECT
        hosts.append({"label": label, "url": url, "compose_project": compose_project})
    return hosts


def _client_for(url: str) -> docker.DockerClient:
    return docker.DockerClient(base_url=url, timeout=5)


def _container_stats(container) -> dict[str, Any]:
    labels = container.labels or {}
    base = {
        "id": container.short_id,
        "name": container.name,
        "service": labels.get("com.docker.compose.service", container.name),
        "status": container.status,
        "health": _health(container),
        "cpu_percent": None,
        "mem_used_mb": None,
        "mem_limit_mb": None,
        "started_at": container.attrs.get("State", {}).get("StartedAt"),
        # Read the image reference straight off the container's own attrs
        # (already fetched, no extra API call) instead of container.image,
        # which does a live GET /images/<id>/json — that 404s and crashes
        # this whole call if the image was since pruned/retagged (e.g. after
        # a redeploy moves the :latest tag to a new image).
        "image": container.attrs.get("Config", {}).get("Image", ""),
    }
    # Only fetch stats for running containers — stopped containers return no useful data.
    if container.status != "running":
        return base
    try:
        raw = container.stats(stream=False)
        cpu = _calc_cpu(raw)
        mem_used = raw["memory_stats"].get("usage", 0)
        mem_limit = raw["memory_stats"].get("limit", 1)
        base.update({
            "cpu_percent": cpu,
            "mem_used_mb": round(mem_used / 1024 / 1024, 1) if mem_used else None,
            "mem_limit_mb": round(mem_limit / 1024 / 1024, 1) if mem_limit else None,
        })
    except Exception:
        pass
    return base


def _calc_cpu(stats: dict) -> float | None:
    try:
        cpu_delta = stats["cpu_stats"]["cpu_usage"]["total_usage"] - \
                    stats["precpu_stats"]["cpu_usage"]["total_usage"]
        sys_delta = stats["cpu_stats"]["system_cpu_usage"] - \
                    stats["precpu_stats"]["system_cpu_usage"]
        num_cpus = stats["cpu_stats"].get("online_cpus") or \
                   len(stats["cpu_stats"]["cpu_usage"].get("percpu_usage", [1]))
        if sys_delta > 0:
            return round((cpu_delta / sys_delta) * num_cpus * 100, 2)
    except (KeyError, ZeroDivisionError):
        pass
    return None


def _health(container) -> str:
    health = container.attrs.get("State", {}).get("Health")
    if health:
        return health.get("Status", "none")
    return "none"


def _belongs_to_project(container, compose_project: str) -> bool:
    if not compose_project:
        return True
    project = (container.labels or {}).get("com.docker.compose.project", "")
    return project == compose_project


def _container_stats_safe(container) -> dict[str, Any]:
    """Wrapper so ThreadPoolExecutor can time out individual stats calls."""
    return _container_stats(container)


def get_all_instances() -> list[dict[str, Any]]:
    hosts = _parse_hosts()
    results = []
    for host in hosts:
        instance: dict[str, Any] = {
            "label": host["label"],
            "url": host["url"],
            "compose_project": host["compose_project"],
            "containers": [],
            "error": None,
        }
        try:
            client = _client_for(host["url"])
            containers = [
                c for c in client.containers.list(all=True)
                if _belongs_to_project(c, host["compose_project"])
            ]
            # Fetch stats for all containers concurrently to avoid sequential blocking.
            with ThreadPoolExecutor(max_workers=min(len(containers) or 1, 16)) as pool:
                future_to_container = {pool.submit(_container_stats_safe, c): c for c in containers}
                stats_by_id: dict[str, dict] = {}
                for future in as_completed(future_to_container, timeout=_STATS_TIMEOUT_S + 2):
                    c = future_to_container[future]
                    try:
                        stats_by_id[c.short_id] = future.result(timeout=_STATS_TIMEOUT_S)
                    except Exception:
                        # Return partial info on stats failure.
                        labels = c.labels or {}
                        stats_by_id[c.short_id] = {
                            "id": c.short_id,
                            "name": c.name,
                            "service": labels.get("com.docker.compose.service", c.name),
                            "status": c.status,
                            "health": _health(c),
                            "cpu_percent": None,
                            "mem_used_mb": None,
                            "mem_limit_mb": None,
                            "started_at": c.attrs.get("State", {}).get("StartedAt"),
                            "image": c.attrs.get("Config", {}).get("Image", ""),
                        }
            instance["containers"] = [stats_by_id[c.short_id] for c in containers if c.short_id in stats_by_id]
        except docker.errors.DockerException as exc:
            instance["error"] = str(exc)
        except Exception as exc:
            instance["error"] = f"Unexpected error: {exc}"
        results.append(instance)
    return results


def get_container_logs(instance_label: str, container_id: str, tail: int = 200) -> dict[str, Any]:
    hosts = {h["label"]: h for h in _parse_hosts()}
    if instance_label not in hosts:
        return {"error": f"Unknown instance: {instance_label}", "logs": ""}
    host = hosts[instance_label]
    try:
        client = _client_for(host["url"])
        container = client.containers.get(container_id)
        logs = container.logs(tail=tail, timestamps=True).decode("utf-8", errors="replace")
        return {"logs": logs, "error": None}
    except docker.errors.NotFound:
        return {"error": f"Container {container_id} not found", "logs": ""}
    except docker.errors.DockerException as exc:
        return {"error": str(exc), "logs": ""}
    except Exception as exc:
        return {"error": f"Unexpected error: {exc}", "logs": ""}
