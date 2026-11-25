import pytest
from app.core.tools.registry import tool_registry

@pytest.mark.asyncio
async def test_ast_parser_tool():
    code = "def hello(name: str) -> str:\n    return f'Hello {name}'\n"
    res = await tool_registry.execute_tool("ast_parser", caller_permissions=["read"], code=code)
    assert res.success is True
    assert "hello" in res.output["functions_defined"]

@pytest.mark.asyncio
async def test_code_sandbox_tool():
    code = "print(10 + 25)"
    res = await tool_registry.execute_tool("code_sandbox", caller_permissions=["execute_tool"], code=code)
    assert res.success is True
    assert res.output == "35"

@pytest.mark.asyncio
async def test_data_calculator_tool():
    res = await tool_registry.execute_tool("data_calculator", caller_permissions=["read"], expression="(50 * 2) - 15")
    assert res.success is True
    assert res.output == 85

@pytest.mark.asyncio
async def test_tool_permissions_enforcement():
    # Calling code_sandbox without execute_tool permission should be denied
    res = await tool_registry.execute_tool("code_sandbox", caller_permissions=["read_only"], code="print(1)")
    assert res.success is False
    assert "Permission denied" in res.error
