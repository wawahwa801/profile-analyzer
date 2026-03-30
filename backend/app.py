import json
import os
import re
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS

load_dotenv()

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

SYSTEM_PROMPT = """You are a thoughtful coach helping someone understand their dating profile through an authenticity lens.
You are not here to shame or optimize for matches at any cost—you help them notice where the profile feels grounded vs. performative,
what messages it may send (intended or not), and how to express realness with more clarity and warmth.

Respond ONLY with valid JSON matching this schema (no markdown, no code fences):
{
  "authenticity_score": <integer 0-100>,
  "authenticity_label": "<short label like 'Strongly grounded' or 'Mixed signals'>",
  "summary": "<2-4 sentences on what the profile communicates overall>",
  "performing_vs_real": "<2-5 sentences comparing performance cues vs authentic cues>",
  "signals": ["<bullet>", "<bullet>"],
  "tips": ["<actionable tip>", "<actionable tip>", ...]
}

Scoring guidance:
- Higher when voice, photos, and answers feel consistent, specific, and vulnerable in a grounded way.
- Lower when copy is generic, heavily curated to impress, or disconnected from the behavioral answers.
- Images: note vibe, staging, variety, and alignment with stated values (if images are missing, say so briefly)."""


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if "```" in text:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
        if m:
            text = m.group(1).strip()
    return json.loads(text)


def _mock_analysis(payload: dict[str, Any]) -> dict[str, Any]:
    bio = (payload.get("bio") or "").strip()
    word_count = len(bio.split())
    base = 42 + min(38, word_count // 3)
    return {
        "authenticity_score": min(88, base),
        "authenticity_label": "Demo mode — add GROQ_API_KEY",
        "summary": (
            "Without a live model, this is a placeholder read: your bio length and structure suggest room to sharpen voice and specificity. "
            "Connect prompts to stories only you could tell."
        ),
        "performing_vs_real": (
            "Demo analysis cannot score photos or nuance. When you enable the API, we compare what you say you value "
            "with how you describe yourself and what your images suggest—spotting both alignment and polish."
        ),
        "signals": [
            f"Bio length (~{word_count} words): {'some texture' if word_count > 40 else 'quite short — specificity may help'}",
            "Set GROQ_API_KEY in backend/.env for full model analysis.",
        ],
        "tips": [
            "Swap one generic line for a concrete moment (place, feeling, small detail).",
            "Ask: would a close friend recognize this as me, or as 'dating-app me'?",
            "Align one photo with a story you tell in the bio or answers.",
        ],
    }


def _build_user_content(payload: dict[str, Any], include_images: bool = True) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []

    stats = payload.get("stats") or {}
    stats_block = json.dumps(stats, ensure_ascii=False, indent=2)
    qa = payload.get("question_answers") or []
    qa_block = json.dumps(qa, ensure_ascii=False, indent=2)

    text_intro = (
        "Analyze this dating profile for authenticity.\n\n"
        f"BIO:\n{payload.get('bio', '')}\n\n"
        f"STATS (JSON):\n{stats_block}\n\n"
        f"QUESTIONS_AND_ANSWERS (JSON):\n{qa_block}\n"
    )
    parts.append({"type": "text", "text": text_intro})

    if include_images:
        images = payload.get("images") or []
        for data_url in images[:6]:
            if not isinstance(data_url, str) or not data_url.startswith("data:image"):
                continue
            try:
                header, b64 = data_url.split(",", 1)
                mime = "image/jpeg"
                if "image/png" in header:
                    mime = "image/png"
                elif "image/webp" in header:
                    mime = "image/webp"
                elif "image/gif" in header:
                    mime = "image/gif"
                parts.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    }
                )
            except ValueError:
                continue

    return [{"role": "user", "content": parts}]


def _llm_analyze(payload: dict[str, Any]) -> dict[str, Any]:
    from openai import OpenAI

    groq_api_key = os.environ.get("GROQ_API_KEY")
    openai_api_key = os.environ.get("OPENAI_API_KEY")
    using_groq = bool(groq_api_key)
    if using_groq:
        client = OpenAI(api_key=groq_api_key, base_url="https://api.groq.com/openai/v1")
        model = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    elif openai_api_key:
        client = OpenAI(api_key=openai_api_key)
        model = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    else:
        raise RuntimeError("No LLM API key set. Add GROQ_API_KEY or OPENAI_API_KEY.")

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *_build_user_content(payload, include_images=not using_groq),
    ]

    resp = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=0.45,
        max_tokens=1200,
    )
    raw = (resp.choices[0].message.content or "").strip()
    data = _extract_json(raw)

    score = int(data.get("authenticity_score", 50))
    score = max(0, min(100, score))

    result = {
        "authenticity_score": score,
        "authenticity_label": str(data.get("authenticity_label", ""))[:120],
        "summary": str(data.get("summary", "")),
        "performing_vs_real": str(data.get("performing_vs_real", "")),
        "signals": list(data.get("signals") or [])[:12],
        "tips": list(data.get("tips") or [])[:12],
    }
    if using_groq and (payload.get("images") or []):
        result["signals"] = [
            "Images were uploaded, but current Groq model is text-only; photo analysis was skipped.",
            *result["signals"],
        ][:12]
    return result


@app.post("/api/analyze")
def analyze():
    if not request.is_json:
        return jsonify({"error": "Expected JSON body"}), 400

    payload = request.get_json(silent=True) or {}
    bio = (payload.get("bio") or "").strip()
    if not bio:
        return jsonify({"error": "Bio is required"}), 400

    images = payload.get("images") or []
    if not isinstance(images, list):
        return jsonify({"error": "images must be a list"}), 400
    if len(images) > 6:
        return jsonify({"error": "At most 6 images"}), 400

    try:
        if os.environ.get("GROQ_API_KEY") or os.environ.get("OPENAI_API_KEY"):
            result = _llm_analyze(payload)
        else:
            result = _mock_analysis(payload)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
