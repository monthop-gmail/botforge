"""Plugin loader for adkcode — loads knowledge-work plugins (skills, commands, MCP configs)."""

import json
import logging
import os
import re
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class Skill:
    name: str
    description: str
    content: str
    plugin_name: str


@dataclass
class Command:
    name: str
    description: str
    argument_hint: str
    content: str
    plugin_name: str


@dataclass
class Plugin:
    name: str
    version: str
    description: str
    author: str
    path: str
    skills: list[Skill] = field(default_factory=list)
    commands: list[Command] = field(default_factory=list)
    mcp_servers: dict = field(default_factory=dict)


# --- Skill routing: maps agent name to keywords that match skill names ---
SKILL_ROUTING = {
    "reviewer": ["review", "code-review", "security", "audit"],
    "tester": ["test", "testing", "coverage", "qa"],
    "coder": ["code", "implement", "refactor", "debug", "documentation", "tech-debt"],
}


def _parse_yaml_frontmatter(text: str) -> tuple[dict, str]:
    """Parse YAML frontmatter from markdown. Returns (metadata, body)."""
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)", text, re.DOTALL)
    if not match:
        return {}, text

    front = match.group(1)
    body = match.group(2).strip()

    meta = {}
    for line in front.strip().splitlines():
        if ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip().strip('"').strip("'")
    return meta, body


def _escape_braces(text: str) -> str:
    """Escape {var} patterns so ADK doesn't treat them as context variables.

    ADK regex {+[^{}]*}+ matches any number of braces, so {{ }} won't work.
    Replace with fullwidth Unicode equivalents that look identical but don't match.
    """
    return text.replace("{", "\uff5b").replace("}", "\uff5d")


def _load_plugin(plugin_dir: str) -> Plugin | None:
    """Load a single plugin from a directory."""
    pj_path = os.path.join(plugin_dir, ".claude-plugin", "plugin.json")
    if not os.path.isfile(pj_path):
        return None

    try:
        with open(pj_path, "r", encoding="utf-8") as f:
            pj = json.load(f)
    except Exception as e:
        logger.warning(f"Failed to read plugin.json in {plugin_dir}: {e}")
        return None

    author = pj.get("author", {})
    if isinstance(author, dict):
        author = author.get("name", "")

    plugin = Plugin(
        name=pj.get("name", os.path.basename(plugin_dir)),
        version=pj.get("version", "0.0.0"),
        description=pj.get("description", ""),
        author=author,
        path=plugin_dir,
    )

    # Load skills
    skills_dir = os.path.join(plugin_dir, "skills")
    if os.path.isdir(skills_dir):
        for skill_name in sorted(os.listdir(skills_dir)):
            skill_md = os.path.join(skills_dir, skill_name, "SKILL.md")
            if not os.path.isfile(skill_md):
                continue
            try:
                with open(skill_md, "r", encoding="utf-8") as f:
                    text = f.read()
                meta, body = _parse_yaml_frontmatter(text)
                plugin.skills.append(
                    Skill(
                        name=meta.get("name", skill_name),
                        description=meta.get("description", ""),
                        content=_escape_braces(body),
                        plugin_name=plugin.name,
                    )
                )
            except Exception as e:
                logger.warning(f"Failed to load skill {skill_name}: {e}")

    # Load commands
    cmds_dir = os.path.join(plugin_dir, "commands")
    if os.path.isdir(cmds_dir):
        for fname in sorted(os.listdir(cmds_dir)):
            if not fname.endswith(".md"):
                continue
            try:
                with open(os.path.join(cmds_dir, fname), "r", encoding="utf-8") as f:
                    text = f.read()
                meta, body = _parse_yaml_frontmatter(text)
                plugin.commands.append(
                    Command(
                        name=fname.removesuffix(".md"),
                        description=meta.get("description", ""),
                        argument_hint=meta.get("argument-hint", ""),
                        content=_escape_braces(body),
                        plugin_name=plugin.name,
                    )
                )
            except Exception as e:
                logger.warning(f"Failed to load command {fname}: {e}")

    # Load MCP config
    mcp_path = os.path.join(plugin_dir, ".mcp.json")
    if os.path.isfile(mcp_path):
        try:
            with open(mcp_path, "r", encoding="utf-8") as f:
                mcp_data = json.load(f)
            plugin.mcp_servers = mcp_data.get("mcpServers", {})
        except Exception as e:
            logger.warning(f"Failed to load .mcp.json for {plugin.name}: {e}")

    logger.info(
        f"Plugin [{plugin.name}]: {len(plugin.skills)} skills, "
        f"{len(plugin.commands)} commands, {len(plugin.mcp_servers)} MCP servers"
    )
    return plugin


def load_plugins(plugins_dir: str | None = None) -> list[Plugin]:
    """Scan plugins directory and load all valid plugins.

    Use ADKCODE_PLUGINS env var to control which plugins are loaded:
      - Not set or empty: load all plugins
      - Comma-separated names: load only listed plugins (e.g. "engineering,data")
      - "none": disable all plugins
    """
    # Check enabled filter
    enabled_env = os.environ.get("ADKCODE_PLUGINS", "").strip()
    if enabled_env.lower() == "none":
        logger.info("Plugins disabled (ADKCODE_PLUGINS=none)")
        return []
    enabled_filter = (
        {name.strip() for name in enabled_env.split(",") if name.strip()}
        if enabled_env
        else None  # None = load all
    )

    if plugins_dir is None:
        plugins_dir = os.environ.get("ADKCODE_PLUGINS_DIR")
        if not plugins_dir:
            candidates = [
                os.path.join(os.getcwd(), "plugins"),
                os.path.join(os.path.dirname(__file__), "plugins"),
            ]
            for c in candidates:
                if os.path.isdir(c):
                    plugins_dir = os.path.abspath(c)
                    break

    if not plugins_dir or not os.path.isdir(plugins_dir):
        return []

    plugins = []
    for entry in sorted(os.listdir(plugins_dir)):
        if enabled_filter is not None and entry not in enabled_filter:
            logger.debug(f"Plugin [{entry}]: skipped (not in ADKCODE_PLUGINS)")
            continue
        full = os.path.join(plugins_dir, entry)
        if os.path.isdir(full):
            plugin = _load_plugin(full)
            if plugin:
                plugins.append(plugin)

    logger.info(f"Loaded {len(plugins)} plugin(s) from {plugins_dir}")
    return plugins


def get_skills_for_agent(plugins: list[Plugin], agent_name: str) -> list[Skill]:
    """Return skills relevant to a specific sub-agent based on keyword matching."""
    keywords = SKILL_ROUTING.get(agent_name, [])
    if not keywords:
        return []
    matched = []
    for p in plugins:
        for skill in p.skills:
            skill_id = skill.name.lower()
            if any(kw in skill_id for kw in keywords):
                matched.append(skill)
    return matched


def get_all_skills(plugins: list[Plugin]) -> list[Skill]:
    """Return all skills from all plugins."""
    return [s for p in plugins for s in p.skills]


def get_all_commands(plugins: list[Plugin]) -> list[Command]:
    """Return all commands from all plugins."""
    return [c for p in plugins for c in p.commands]


def get_merged_mcp_servers(plugins: list[Plugin]) -> dict:
    """Merge MCP server configs from all plugins."""
    merged = {}
    for p in plugins:
        for name, config in p.mcp_servers.items():
            key = f"{p.name}_{name}" if name in merged else name
            merged[key] = config
    return merged


def format_skills_instruction(skills: list[Skill]) -> str:
    """Format skills as instruction text to append to agent prompts."""
    if not skills:
        return ""
    lines = ["\n\n# Plugin Skills\n"]
    lines.append(
        "Use the following domain knowledge when relevant:\n"
    )
    for skill in skills:
        lines.append(f"## {skill.name} ({skill.plugin_name})\n")
        lines.append(skill.content)
        lines.append("")
    return "\n".join(lines)


def format_commands_instruction(commands: list[Command]) -> str:
    """Format commands as instruction for orchestrator."""
    if not commands:
        return ""
    lines = ["\n\n# Available Plugin Commands\n"]
    lines.append(
        "When a user invokes a command (e.g. /review, /debug), follow its workflow:\n"
    )
    for cmd in commands:
        hint = f" {cmd.argument_hint}" if cmd.argument_hint else ""
        lines.append(f"- **/{cmd.name}**{hint} — {cmd.description}")
    lines.append("\n## Command Details\n")
    for cmd in commands:
        lines.append(f"### /{cmd.name}\n")
        lines.append(cmd.content)
        lines.append("")
    return "\n".join(lines)
