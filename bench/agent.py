"""Harbor agent wrapper for Blush (Terminal-Bench evaluation)."""

import os
import shlex

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class Blush(BaseInstalledAgent):
    """Blush CLI agent -- team-native terminal coding agent from ap.haus."""

    @staticmethod
    def name() -> str:
        return "blush"

    def get_version_command(self) -> str | None:
        return 'node /opt/blush/packages/cli/dist/bin.js --version 2>/dev/null || echo "dev"'

    def parse_version(self, stdout: str) -> str:
        return stdout.strip()

    async def install(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(
            environment,
            command=(
                "apt-get update && apt-get install -y curl git && "
                "curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && "
                "apt-get install -y nodejs && "
                "npm install -g pnpm"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )
        await self.exec_as_agent(
            environment,
            command=(
                "git clone https://github.com/baahaus/blush.git /opt/blush && "
                "cd /opt/blush && "
                "pnpm install --frozen-lockfile && "
                "pnpm build"
            ),
        )

    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        escaped = shlex.quote(instruction)
        oauth_token = os.environ.get("BLUSH_OAUTH_TOKEN", "")
        model = self.model_name or "claude-sonnet-4-20250514"
        if "/" in model:
            model = model.split("/", 1)[-1]

        await self.exec_as_agent(
            environment,
            command=(
                f"export BLUSH_OAUTH_TOKEN={shlex.quote(oauth_token)}; "
                f"cd /app && "
                f"node /opt/blush/packages/cli/dist/bin.js "
                f"-m {shlex.quote(model)} "
                f"-p {escaped} 2>&1 | tee /logs/agent/blush.txt"
            ),
        )

    def populate_context_post_run(self, context: AgentContext) -> None:
        pass
