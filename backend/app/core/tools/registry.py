import logging
from typing import Dict, Any, List, Optional
from app.core.tools.base import BaseTool, ToolResult
from app.core.tools.builtin import (
    ASTParserTool,
    CodeSandboxTool,
    WebSearchTool,
    DataCalculatorTool,
    DocumentParserTool
)

logger = logging.getLogger(__name__)

class ToolRegistry:
    """Enterprise Tool Registry with permission enforcement."""

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}
        self._register_default_tools()

    def _register_default_tools(self):
        defaults = [
            ASTParserTool(),
            CodeSandboxTool(),
            WebSearchTool(),
            DataCalculatorTool(),
            DocumentParserTool()
        ]
        for t in defaults:
            self.register(t)

    def register(self, tool: BaseTool):
        self._tools[tool.name] = tool
        logger.debug(f"Registered tool [{tool.name}]")

    def get(self, name: str) -> Optional[BaseTool]:
        return self._tools.get(name)

    def list_all(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": t.name,
                "description": t.description,
                "required_permissions": t.required_permissions
            }
            for t in self._tools.values()
        ]

    async def execute_tool(
        self,
        tool_name: str,
        caller_permissions: List[str],
        **kwargs
    ) -> ToolResult:
        tool = self.get(tool_name)
        if not tool:
            return ToolResult(success=False, output=None, error=f"Tool '{tool_name}' is not registered.")

        # Permission check
        for perm in tool.required_permissions:
            if perm not in caller_permissions and "*" not in caller_permissions:
                return ToolResult(
                    success=False,
                    output=None,
                    error=f"Permission denied: Calling agent lacks required permission '{perm}'."
                )

        return await tool.execute(**kwargs)

tool_registry = ToolRegistry()
