import json
import os
from typing import Any, Dict, List, Optional
from abc import ABC, abstractmethod

import yaml
from openai import OpenAI, OpenAIError
try:
    from anthropic import Anthropic
except ImportError:
    Anthropic = None
try:
    import google.generativeai as genai
except ImportError:
    genai = None

from src.knowledge_store import format_prd_context_for_prompt, retrieve_similar_prds


class AIClient(ABC):
    """Abstract base class for AI API clients."""

    @abstractmethod
    def generate_response(self, messages: List[Dict[str, str]], config: Dict[str, Any]) -> str:
        """Generate a response from the AI model."""
        pass


class OpenAIClient(AIClient):
    """OpenAI API client."""

    def __init__(self, api_key: str):
        self.client = OpenAI(api_key=api_key)

    def generate_response(self, messages: List[Dict[str, str]], config: Dict[str, Any]) -> str:
        response = self.client.chat.completions.create(
            model=config["model"],
            temperature=float(config.get("temperature", 0.2)),
            max_tokens=int(config.get("max_tokens", 2000)),
            messages=messages,
        )
        return response.choices[0].message.content


class AnthropicClient(AIClient):
    """Anthropic API client."""

    def __init__(self, api_key: str):
        if Anthropic is None:
            raise ImportError("anthropic package is not installed")
        self.client = Anthropic(api_key=api_key)

    def generate_response(self, messages: List[Dict[str, str]], config: Dict[str, Any]) -> str:
        # Convert messages to Anthropic format
        system_message = ""
        user_messages = []

        for msg in messages:
            if msg["role"] == "system":
                system_message = msg["content"]
            else:
                user_messages.append(msg)

        response = self.client.messages.create(
            model=config["model"],
            max_tokens=int(config.get("max_tokens", 2000)),
            temperature=float(config.get("temperature", 0.2)),
            system=system_message,
            messages=user_messages,
        )
        return response.content[0].text


class GoogleClient(AIClient):
    """Google Generative AI client."""

    def __init__(self, api_key: str):
        if genai is None:
            raise ImportError("google-generativeai package is not installed")
        genai.configure(api_key=api_key)

    def generate_response(self, messages: List[Dict[str, str]], config: Dict[str, Any]) -> str:
        model = genai.GenerativeModel(config["model"])

        # Convert messages to Google format
        # For simplicity, combine system message with user message
        system_content = ""
        user_content = ""

        for msg in messages:
            if msg["role"] == "system":
                system_content = msg["content"]
            elif msg["role"] == "user":
                user_content = msg["content"]

        # Combine system and user content
        full_prompt = system_content + "\n\n" + user_content if system_content else user_content

        # Configure generation parameters
        generation_config = genai.types.GenerationConfig(
            temperature=float(config.get("temperature", 0.2)),
            max_output_tokens=int(config.get("max_tokens", 2000)),
        )

        response = model.generate_content(
            full_prompt,
            generation_config=generation_config
        )
        return response.text


def _load_llm_config(config_path: str = "config/llm_config.yaml") -> Dict[str, Any]:
    defaults: Dict[str, Any] = {
        "provider": os.getenv("AI_PROVIDER", "openai"),
        "model": os.getenv("AI_MODEL", "gpt-4.1-mini"),
        "api_key": "",
        "temperature": 0.2,
        "max_tokens": 2000,
    }

    try:
        with open(config_path, "r") as f:
            data = yaml.safe_load(f) or {}
            if isinstance(data, dict):
                return {**defaults, **data}
    except FileNotFoundError:
        pass

    return defaults


def _create_client(config: Dict[str, Any]) -> AIClient:
    """Factory function to create the appropriate AI client."""
    provider = config.get("provider", "openai").lower()
    api_key = (config.get("api_key") or "").strip()

    # Get API key from environment if not provided in config
    if not api_key:
        env_vars = {
            "openai": "OPENAI_API_KEY",
            "anthropic": "ANTHROPIC_API_KEY",
            "google": "GOOGLE_API_KEY"
        }
        env_var = env_vars.get(provider)
        if env_var:
            api_key = os.getenv(env_var, "")

    if not api_key:
        raise ValueError(f"No API key provided for {provider} provider")

    if provider == "openai":
        return OpenAIClient(api_key)
    elif provider == "anthropic":
        return AnthropicClient(api_key)
    elif provider == "google":
        return GoogleClient(api_key)
    else:
        raise ValueError(f"Unsupported AI provider: {provider}")


def generate_test_cases(
    prd_text: str,
    api_design: Optional[Dict[str, Any]],
    platform_data: Dict[str, Any],
    impacted_screens: Optional[List[str]] = None,
    api_key_override: Optional[str] = None,
    provider_override: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Generate structured test cases using AI (OpenAI, Anthropic, or Google), guided by platform knowledge.
    Falls back to deterministic mock cases when the AI call fails
    (e.g. insufficient quota), so the app remains usable.
    """
    prd_snippet = prd_text[:6000] if prd_text else ""
    api_design_str = json.dumps(api_design or {}, indent=2)
    devices_str = json.dumps(platform_data.get("devices", {}), indent=2)
    workflows_str = json.dumps(platform_data.get("workflows", []), indent=2)
    impacted_screens_list = impacted_screens or []
    impacted_screens_str = ", ".join(impacted_screens_list) or "Not specified"

    # Retrieve similar past PRDs (if any have been ingested).
    similar_prds = retrieve_similar_prds(prd_snippet, impacted_screens_list, top_k=3)
    similar_context = format_prd_context_for_prompt(similar_prds)

    system_message = (
        "You are a senior QA engineer for this specific product platform. "
        "You design high-quality, practical end-to-end test cases that can be imported into a test case management tool."
    )

    user_message = f"""
You are given:
- Product Requirements Document (PRD)
- Optional API design
- Platform implementation knowledge (devices, workflows, existing automation coverage)
- A list of impacted screens/modules

PRD (may be truncated):
{prd_snippet}

API design (JSON):
{api_design_str}

Platform data:
devices = {devices_str}
workflows = {workflows_str}

Impacted screens/modules:
{impacted_screens_str}

Generate 15–30 end-to-end focused test cases that:
- Are aligned with the impacted screens and workflows.
- Cover smoke, regression, end-to-end journeys, security, and edge cases.
- Are realistic for this specific platform.

Here are similar past PRDs and example test cases from our knowledge base.
Use their style, coverage and naming conventions as guidance (but do not copy them verbatim):

{similar_context}

VERY IMPORTANT OUTPUT FORMAT:
Return ONLY valid JSON (no markdown, no commentary) in the form of a list of objects:
[
  {{
    "ID": "TC-001",
    "Title": "Clear, concise test title",
    "Type": "smoke | regression | e2e | security | edge",
    "Priority": "High | Medium | Low",
    "Preconditions": "Key setup and assumptions",
    "Steps": ["Step 1 ...", "Step 2 ...", "Step 3 ..."],
    "ExpectedResult": "Main expected outcome",
    "Screen": "Name of impacted screen or flow",
    "Tags": ["tag1", "tag2"]
  }}
]

Restrictions:
- Do NOT include any explanation outside the JSON.
- Ensure the JSON parses without errors.
"""

    # Try real AI call first
    try:
        config = _load_llm_config()
        if api_key_override and api_key_override.strip():
            config["api_key"] = api_key_override.strip()
        if provider_override and provider_override.strip():
            config["provider"] = provider_override.strip()
        client = _create_client(config)

        content = client.generate_response(
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message},
            ],
            config=config
        )

        try:
            test_cases = json.loads(content)
        except json.JSONDecodeError:
            # Best-effort recovery: try to extract JSON substring
            start = content.find("[")
            end = content.rfind("]")
            if start != -1 and end != -1 and end > start:
                test_cases = json.loads(content[start : end + 1])
            else:
                raise

        if not isinstance(test_cases, list):
            raise ValueError("Model output is not a list of test cases.")

        return {"test_cases": test_cases, "used_mock": False, "error": None}

    except Exception as exc:
        # Fallback: deterministic mock cases so the app keeps working.
        screens = impacted_screens_list or ["Primary flow"]
        mock_cases: List[Dict[str, Any]] = []
        idx = 1

        for screen in screens:
            base_id = f"{screen[:3].upper()}".replace(" ", "") or "TC"
            # Smoke / main happy path
            mock_cases.append(
                {
                    "ID": f"{base_id}-{idx:03d}",
                    "Title": f"[{screen}] basic happy path works",
                    "Type": "smoke",
                    "Priority": "High",
                    "Preconditions": "Environment is up; user has valid test account.",
                    "Steps": [
                        f"Navigate to {screen}.",
                        "Perform the main intended action.",
                        "Observe the result.",
                    ],
                    "ExpectedResult": "Main flow completes successfully without errors.",
                    "Screen": screen,
                    "Tags": ["mock", "smoke", "happy-path"],
                }
            )
            idx += 1

            # Negative / validation
            mock_cases.append(
                {
                    "ID": f"{base_id}-{idx:03d}",
                    "Title": f"[{screen}] validation and error handling",
                    "Type": "regression",
                    "Priority": "Medium",
                    "Preconditions": "Environment is up.",
                    "Steps": [
                        f"Navigate to {screen}.",
                        "Provide invalid or missing mandatory data.",
                        "Submit or continue.",
                    ],
                    "ExpectedResult": "User sees clear validation messages; no crash or undefined state.",
                    "Screen": screen,
                    "Tags": ["mock", "validation"],
                }
            )
            idx += 1

        # A couple of generic cross-screen E2E / edge cases
        mock_cases.append(
            {
                "ID": f"GEN-{idx:03d}",
                "Title": "End-to-end journey across key impacted screens",
                "Type": "e2e",
                "Priority": "High",
                "Preconditions": "Test data prepared for end-to-end flow.",
                "Steps": [
                    "Start from the first impacted screen.",
                    "Follow the standard user journey through all relevant screens.",
                    "Complete the flow and reach the final state (e.g. confirmation).",
                ],
                "ExpectedResult": "User can complete the core journey without functional or UI issues.",
                "Screen": ", ".join(screens),
                "Tags": ["mock", "e2e"],
            }
        )
        idx += 1

        mock_cases.append(
            {
                "ID": f"GEN-{idx:03d}",
                "Title": "Basic resilience under slow or flaky network",
                "Type": "edge",
                "Priority": "Medium",
                "Preconditions": "Network throttling tool is available for the test environment.",
                "Steps": [
                    "Simulate slow or intermittent network.",
                    "Perform main actions on each impacted screen.",
                    "Observe loading indicators, retries, and error states.",
                ],
                "ExpectedResult": "The app degrades gracefully with clear feedback; no hard crashes.",
                "Screen": ", ".join(screens),
                "Tags": ["mock", "edge", "resilience"],
            }
        )

        return {
            "test_cases": mock_cases,
            "used_mock": True,
            "error": f"Generation failed, returning mock cases instead: {type(exc).__name__}: {exc}",
        }