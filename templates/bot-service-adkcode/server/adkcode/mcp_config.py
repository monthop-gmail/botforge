"""MCP server configuration loader for adkcode."""

import json
import os
from typing import Any


def load_mcp_config(extra_servers: dict | None = None) -> dict[str, Any]:
    """Load MCP server config from mcp.json in working directory or agent directory.

    Args:
        extra_servers: Additional MCP servers to merge (e.g. from plugins).

    Expected format (same as Claude Code / Cursor):
    {
        "mcpServers": {
            "filesystem": {
                "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
            },
            "remote-server": {
                "url": "https://my-mcp-server.com/sse",
                "headers": {
                    "Authorization": "Bearer xxx"
                }
            }
        }
    }
    """
    candidates = [
        os.path.join(os.getcwd(), "mcp.json"),
        os.path.join(os.path.dirname(__file__), "..", "mcp.json"),
    ]

    config = {"mcpServers": {}}
    for path in candidates:
        if os.path.isfile(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                if "mcpServers" in loaded:
                    config = loaded
                    break
            except Exception:
                pass

    if extra_servers:
        config["mcpServers"].update(extra_servers)

    return config
